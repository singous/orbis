package table

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"html"
	"strconv"
	"strings"
	"time"

	"orbis.local/orbis/internal/platform/fault"
)

func TransferLimit(kind string) error {
	if kind == "copy" {
		return fault.New(fault.Validation, "TABLE_COPY_TOO_LARGE", "复制超过 50,000 条记录或 16 MiB 限制")
	}
	return fault.New(fault.Validation, "TABLE_EXPORT_TOO_LARGE", "导出超过 50,000 条记录或 16 MiB 限制，请收窄视图筛选")
}
func Display(field Field, value any) string {
	if value == nil {
		return ""
	}
	label := func(id string) string {
		for _, option := range field.Options {
			if option.ID == id {
				return option.Label
			}
		}
		return ""
	}
	switch field.Kind {
	case "select":
		return label(value.(string))
	case "multi_select":
		labels := []string{}
		for _, id := range value.([]any) {
			labels = append(labels, label(id.(string)))
		}
		return strings.Join(labels, ", ")
	case "checkbox":
		if value.(bool) {
			return "是"
		}
		return "否"
	case "datetime":
		return time.UnixMilli(int64(value.(float64))).In(time.FixedZone("UTC+8", 8*60*60)).Format("2006-01-02T15:04-07:00")
	case "number":
		return strconv.FormatFloat(value.(float64), 'g', -1, 64)
	default:
		return value.(string)
	}
}

type exportBuffer struct{ bytes.Buffer }

func (b *exportBuffer) Write(value []byte) (int, error) {
	if b.Len()+len(value) > MaxTransferBytes {
		return 0, TransferLimit("export")
	}
	return b.Buffer.Write(value)
}
func (b *exportBuffer) WriteString(value string) (int, error) { return b.Write([]byte(value)) }
func markdownText(value string) string {
	value = html.EscapeString(value)
	value = strings.ReplaceAll(value, "\\", "\\\\")
	for _, symbol := range []string{"|", "*", "_", "[", "]", "`", "#"} {
		value = strings.ReplaceAll(value, symbol, "\\"+symbol)
	}
	value = strings.ReplaceAll(strings.ReplaceAll(value, "\r\n", "\n"), "\r", "\n")
	return strings.ReplaceAll(value, "\n", "<br>")
}
func RenderExport(data Projection, format string) ([]byte, error) {
	var output exportBuffer
	if format == "csv" {
		if _, err := output.Write([]byte("\xef\xbb\xbf")); err != nil {
			return nil, err
		}
		writer := csv.NewWriter(&output)
		writer.UseCRLF = true
		safe := func(row []string) []string {
			result := make([]string, len(row))
			for index, value := range row {
				trimmed := strings.TrimSpace(value)
				if trimmed != "" && strings.ContainsRune("=+-@", rune(trimmed[0])) {
					value = "'" + value
				}
				result[index] = value
			}
			return result
		}
		if err := writer.Write(safe(data.Columns)); err != nil {
			return nil, err
		}
		for _, row := range data.Rows {
			if err := writer.Write(safe(row)); err != nil {
				return nil, err
			}
		}
		writer.Flush()
		if err := writer.Error(); err != nil {
			return nil, err
		}
	} else {
		heading := fmt.Sprintf("### %s\n\n视图：%s；快照版本：%d\n\n", markdownText(data.Title), markdownText(data.View), data.Version)
		if _, err := output.Write([]byte(heading)); err != nil {
			return nil, err
		}
		write := func(row []string) error {
			escaped := make([]string, len(row))
			for i, text := range row {
				escaped[i] = markdownText(text)
			}
			_, err := output.Write([]byte("| " + strings.Join(escaped, " | ") + " |\n"))
			return err
		}
		if err := write(data.Columns); err != nil {
			return nil, err
		}
		separators := make([]string, len(data.Columns))
		for i := range separators {
			separators[i] = "---"
		}
		if err := write(separators); err != nil {
			return nil, err
		}
		for _, row := range data.Rows {
			if err := write(row); err != nil {
				return nil, err
			}
		}
	}
	return output.Bytes(), nil
}
