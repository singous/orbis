package document

import "orbis.local/orbis/internal/platform/fault"

const MaxGridRows = 1000
const MaxGridColumns = 64
const MaxGridCells = 10000
const MaxDocumentGridCells = 50000
const MaxGridColumnWidth = 2000

type GridCell struct {
	RowSpan         int       `json:"row_span"`
	ColumnSpan      int       `json:"column_span"`
	TextColor       *string   `json:"text_color"`
	Content         []TextRun `json:"content"`
	Alignment       string    `json:"alignment"`
	BackgroundColor *string   `json:"background_color"`
}
type Grid struct {
	Rows          [][]GridCell `json:"rows"`
	ColumnWidths  []*int       `json:"column_widths"`
	HeaderRows    int          `json:"header_rows"`
	HeaderColumns int          `json:"header_columns"`
}

func normalizeGrid(grid *Grid, totalCells *int) error {
	if grid == nil {
		return fault.Field("body.blocks", "普通表格必须提供 table 数据")
	}
	if len(grid.Rows) > MaxGridRows || len(grid.ColumnWidths) > MaxGridColumns {
		return fault.Field("body.blocks", "普通表格尺寸超出限制")
	}
	columns := len(grid.ColumnWidths)
	occupied := make([][MaxGridColumns]bool, len(grid.Rows))
	anchors := make([][MaxGridColumns]*GridCell, len(grid.Rows))
	for rowIndex, row := range grid.Rows {
		column := 0
		for cellIndex := range row {
			cell := &grid.Rows[rowIndex][cellIndex]
			if cell.RowSpan == 0 {
				cell.RowSpan = 1
			}
			if cell.ColumnSpan == 0 {
				cell.ColumnSpan = 1
			}
			if cell.RowSpan < 1 || cell.RowSpan > len(grid.Rows)-rowIndex || cell.ColumnSpan < 1 || cell.ColumnSpan > MaxGridColumns {
				return fault.Field("body.blocks", "单元格合并范围不正确")
			}
			for column < MaxGridColumns && occupied[rowIndex][column] {
				column++
			}
			if column+cell.ColumnSpan > MaxGridColumns {
				return fault.Field("body.blocks", "普通表格列数超出限制")
			}
			for y := rowIndex; y < rowIndex+cell.RowSpan; y++ {
				for x := column; x < column+cell.ColumnSpan; x++ {
					if occupied[y][x] {
						return fault.Field("body.blocks", "合并单元格范围发生重叠")
					}
					occupied[y][x] = true
				}
			}
			anchors[rowIndex][column] = cell
			column += cell.ColumnSpan
			columns = max(columns, column)
		}
	}
	if len(grid.Rows)*columns > MaxGridCells {
		return fault.Field("body.blocks", "普通表格单元格数量超出限制")
	}
	*totalCells += len(grid.Rows) * columns
	if *totalCells > MaxDocumentGridCells {
		return fault.Field("body.blocks", "文档普通表格单元格总数超出限制")
	}
	if grid.HeaderRows < 0 || grid.HeaderRows > len(grid.Rows) || grid.HeaderColumns < 0 || grid.HeaderColumns > columns {
		return fault.Field("body.blocks", "普通表格表头范围不正确")
	}
	if grid.Rows == nil {
		grid.Rows = [][]GridCell{}
	}
	if grid.ColumnWidths == nil {
		grid.ColumnWidths = []*int{}
	}
	for len(grid.ColumnWidths) < columns {
		grid.ColumnWidths = append(grid.ColumnWidths, nil)
	}
	for _, width := range grid.ColumnWidths {
		if width != nil && (*width < 1 || *width > MaxGridColumnWidth) {
			return fault.Field("body.blocks", "普通表格列宽超出范围")
		}
	}
	normalized := make([][]GridCell, len(grid.Rows))
	for rowIndex := range grid.Rows {
		normalized[rowIndex] = []GridCell{}
		for column := 0; column < columns; {
			cell := anchors[rowIndex][column]
			if cell == nil && occupied[rowIndex][column] {
				column++
				continue
			}
			if cell == nil {
				cell = &GridCell{RowSpan: 1, ColumnSpan: 1}
			}
			if cell.Content == nil {
				cell.Content = []TextRun{}
			}
			if err := normalizeRuns(cell.Content); err != nil {
				return err
			}
			if cell.Alignment == "" {
				cell.Alignment = "left"
			}
			if cell.Alignment != "left" && cell.Alignment != "center" && cell.Alignment != "right" && cell.Alignment != "justify" {
				return fault.Field("body.blocks", "单元格对齐方式不正确")
			}
			for _, color := range []*string{cell.TextColor, cell.BackgroundColor} {
				if color != nil && !validColor(*color) {
					return fault.Field("body.blocks", "单元格颜色不正确")
				}
			}
			normalized[rowIndex] = append(normalized[rowIndex], *cell)
			column += cell.ColumnSpan
		}
	}
	grid.Rows = normalized
	return nil
}
