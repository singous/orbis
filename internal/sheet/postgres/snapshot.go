package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"orbis.local/orbis/internal/sheet"
	"orbis.local/orbis/internal/table"
)

// Embedded snapshots have an explicit budget independent from the interactive table.
const MaxEmbeddedRecords = 1000
const MaxEmbeddedBytes = 8 << 20

func Snapshot(ctx context.Context, tx *gorm.DB, workspace, id, viewID string) (table.PublicData, error) {
	t, err := get(ctx, tx, sheet.Scope{WorkspaceID: workspace, SheetID: id}, "")
	if err != nil {
		return table.PublicData{}, err
	}
	p, err := queryPlan(t, sheet.Query{ViewID: viewID})
	if err != nil {
		return table.PublicData{}, err
	}
	order := []string{}
	for _, o := range p.order {
		direction := " ASC"
		if o.desc {
			direction = " DESC"
		}
		order = append(order, o.expr+direction+" NULLS LAST")
	}
	args := append(append([]any{}, p.joinArgs...), p.args...)
	args = append(args, MaxEmbeddedRecords+1)
	var rows []recordRow
	if err := tx.WithContext(ctx).Raw("SELECT r.* FROM sheet_records r"+p.joins+" WHERE "+p.where+" ORDER BY "+strings.Join(order, ",")+" LIMIT ?", args...).Scan(&rows).Error; err != nil {
		return table.PublicData{}, err
	}
	if len(rows) > MaxEmbeddedRecords {
		return table.PublicData{}, sheet.Invalid("嵌入表格公开快照最多 1000 条记录，请选择筛选后的视图")
	}
	fields := sheet.Fields(t.Definition)
	data := table.PublicData{Title: t.Title, Fields: []table.Field{}, Records: []table.PublicRecord{}, Groups: []table.Group{}, View: table.PublicView{Name: p.view.Name, Kind: "grid", Widths: p.view.Widths}}
	for _, id := range p.view.FieldIDs {
		f := fields[id]
		data.Fields = append(data.Fields, table.Field{ID: id, Name: f.Name, Kind: "text", Options: []table.Option{}})
	}
	used := 0
	names := map[string]string{}
	var members []struct{ ID, DisplayName string }
	if err := tx.WithContext(ctx).Table("users u").Select("u.id,u.display_name").Joins("JOIN workspace_members m ON m.user_id=u.id").Where("m.workspace_id=?", workspace).Scan(&members).Error; err != nil {
		return data, err
	}
	for _, m := range members {
		names[m.ID] = m.DisplayName
	}
	for _, row := range rows {
		used += len(row.Values)
		if used > MaxEmbeddedBytes {
			return data, sheet.Invalid("嵌入表格快照超过 8 MiB，请缩小视图范围")
		}
		record := row.domain(t.Definition)
		values := map[string]any{}
		for _, id := range p.view.FieldIDs {
			f := fields[id]
			v := record.Values[id]
			value := sheet.Display(f, v)
			switch f.Kind {
			case "datetime", "created_at", "updated_at":
				if v != nil {
					var n int64
					switch number := v.(type) {
					case int64:
						n = number
					case float64:
						n = int64(number)
					}
					value = time.UnixMilli(n).In(time.FixedZone("UTC+8", 8*3600)).Format("2006-01-02 15:04")
				}
			case "created_by", "updated_by":
				if ptr, ok := v.(*string); ok && ptr != nil {
					value = names[*ptr]
				} else {
					value = ""
				}
			case "person":
				items := []string{}
				if ids, ok := v.([]any); ok {
					for _, person := range ids {
						items = append(items, names[fmt.Sprint(person)])
					}
				}
				value = strings.Join(items, "、")
			case "attachment", "image":
				count := 0
				if a, ok := v.([]any); ok {
					count = len(a)
				}
				if count > 0 {
					value = fmt.Sprintf("%d 个附件（在工作空间查看）", count)
				} else {
					value = ""
				}
			}
			values[id] = value
		}
		data.Records = append(data.Records, table.PublicRecord{ID: row.ID, Values: values})
	}
	return data, nil
}

// SnapshotRevision changes with projected content, including the selected view.
func SnapshotRevision(data table.PublicData) int64 {
	raw, _ := json.Marshal(data)
	hash := sha256.Sum256(raw)
	return int64(binary.BigEndian.Uint64(hash[:8])&((1<<52)-1)) + 1
}
