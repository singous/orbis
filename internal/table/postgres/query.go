package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"gorm.io/gorm"

	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/table"
)

const recordsFrom = ` FROM data_table_record_versions r
JOIN data_table_record_ids i ON i.table_id=r.table_id AND i.record_id=r.record_id `

type querySQL struct {
	where, order    string
	args, orderArgs []any
}

func scalar(field table.Field) string {
	switch field.Kind {
	case "number", "datetime":
		return "CAST(jsonb_extract_path_text(r.values, ?) AS NUMERIC)"
	case "checkbox":
		return "CAST(jsonb_extract_path_text(r.values, ?) AS BOOLEAN)"
	default:
		return "jsonb_extract_path_text(r.values, ?)"
	}
}
func whereSQL(id string, version int64, definition table.Definition, view table.View) querySQL {
	result := querySQL{where: "r.table_id=? AND r.valid_from<=? AND (r.valid_to IS NULL OR r.valid_to>?)", args: []any{id, version, version}}
	fields := table.FieldMap(definition)
	for _, filter := range view.Filters {
		field := fields[filter.FieldID]
		value := scalar(field)
		condition := ""
		args := []any{field.ID}
		switch filter.Operator {
		case "empty", "not_empty":
			condition = value + " IS NULL"
			if field.Kind == "text" || field.Kind == "url" || field.Kind == "select" || field.Kind == "multi_select" {
				empty := ""
				if field.Kind == "multi_select" {
					empty = "[]"
				}
				condition += " OR " + value + "=?"
				args = append(args, field.ID, empty)
			}
			condition = "(" + condition + ")"
			if filter.Operator == "not_empty" {
				condition = "NOT " + condition
			}
		case "contains":
			if field.Kind == "multi_select" {
				condition = "jsonb_exists(jsonb_extract_path(r.values, ?), ?)"
				args = append(args, filter.Value)
			} else {
				condition = "strpos(" + value + ", ?) > 0"
				args = append(args, filter.Value)
			}
		default:
			operator := map[string]string{"eq": "=", "ne": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[filter.Operator]
			if filter.Value == nil {
				condition = value + " IS NULL"
				if filter.Operator == "ne" {
					condition = value + " IS NOT NULL"
				}
			} else {
				condition = value + " " + operator + " ?"
				args = append(args, filter.Value)
			}
		}
		result.where += " AND (" + condition + ")"
		result.args = append(result.args, args...)
	}
	ordering := []string{}
	if view.Kind == "grid" && view.GroupFieldID != nil {
		field := fields[*view.GroupFieldID]
		ordering = append(ordering, scalar(field)+" ASC NULLS LAST")
		result.orderArgs = append(result.orderArgs, field.ID)
	}
	for _, sort := range view.Sorts {
		direction := "ASC"
		if sort.Descending {
			direction = "DESC"
		}
		ordering = append(ordering, scalar(fields[sort.FieldID])+" "+direction+" NULLS LAST")
		result.orderArgs = append(result.orderArgs, sort.FieldID)
	}
	if len(view.Sorts) == 0 {
		ordering = append(ordering, "i.position ASC")
	}
	ordering = append(ordering, "r.record_id ASC")
	result.order = strings.Join(ordering, ", ")
	return result
}
func groupFilter(query *querySQL, definition table.Definition, view table.View, input table.Query) error {
	if !input.GroupSet {
		return nil
	}
	if view.GroupFieldID == nil {
		return fault.Field("query.group_id", "所选视图没有分组字段")
	}
	value := scalar(table.FieldMap(definition)[*view.GroupFieldID])
	query.args = append(query.args, *view.GroupFieldID)
	if input.GroupID == nil {
		query.where += " AND " + value + " IS NULL"
		return nil
	}
	valid := false
	for _, option := range table.FieldMap(definition)[*view.GroupFieldID].Options {
		if option.ID == *input.GroupID {
			valid = true
		}
	}
	if !valid {
		return fault.Field("query.group_id", "分组值不存在")
	}
	query.where += " AND " + value + "=?"
	query.args = append(query.args, *input.GroupID)
	return nil
}
func groupCounts(ctx context.Context, tx *gorm.DB, metadata table.Metadata, view table.View, query querySQL) ([]table.Group, error) {
	result := []table.Group{}
	if view.GroupFieldID == nil {
		return result, nil
	}
	field := table.FieldMap(metadata.Definition)[*view.GroupFieldID]
	var rows []struct {
		OptionID *string
		Count    int64
	}
	args := append([]any{field.ID}, query.args...)
	if err := tx.WithContext(ctx).Raw("SELECT "+scalar(field)+" AS option_id,count(*) AS count"+recordsFrom+"WHERE "+query.where+" GROUP BY 1", args...).Scan(&rows).Error; err != nil {
		return nil, err
	}
	counts := map[string]int64{}
	for _, row := range rows {
		id := ""
		if row.OptionID != nil {
			id = *row.OptionID
		}
		counts[id] = row.Count
	}
	result = append(result, table.Group{Name: "未分组", Count: counts[""]})
	for _, option := range field.Options {
		id := option.ID
		result = append(result, table.Group{OptionID: &id, Name: option.Label, Count: counts[id]})
	}
	return result, nil
}

type selectedRecord struct {
	RecordID    string
	Values      json.RawMessage
	CreatedAtMS int64 `gorm:"column:created_at_ms"`
	UpdatedAtMS int64 `gorm:"column:updated_at_ms"`
}

func (r selectedRecord) domain(def table.Definition) (table.Record, error) {
	var values map[string]any
	if err := json.Unmarshal(r.Values, &values); err != nil {
		return table.Record{}, err
	}
	return table.Record{ID: r.RecordID, Values: table.ProjectValues(values, def), CreatedAtMS: r.CreatedAtMS, UpdatedAtMS: r.UpdatedAtMS}, nil
}
func Records(ctx context.Context, tx *gorm.DB, metadata table.Metadata, input table.Query) (table.Page, error) {
	view, err := table.SelectView(metadata.Definition, input.ViewID)
	if err != nil {
		return table.Page{}, err
	}
	query := whereSQL(metadata.TableID, metadata.TableVersion, metadata.Definition, view)
	groups, err := groupCounts(ctx, tx, metadata, view, query)
	if err != nil {
		return table.Page{}, err
	}
	if err := groupFilter(&query, metadata.Definition, view, input); err != nil {
		return table.Page{}, err
	}
	result := table.Page{Metadata: metadata, ViewID: view.ID, Items: []table.Record{}, Groups: groups}
	if err := tx.WithContext(ctx).Raw("SELECT count(*)"+recordsFrom+"WHERE "+query.where, query.args...).Scan(&result.Total).Error; err != nil {
		return result, err
	}
	args := append(append(append([]any{}, query.args...), query.orderArgs...), input.Page.Size, input.Page.Offset())
	var rows []selectedRecord
	if err := tx.WithContext(ctx).Raw("SELECT r.record_id,r.values,i.created_at_ms,r.updated_at_ms"+recordsFrom+"WHERE "+query.where+" ORDER BY "+query.order+" LIMIT ? OFFSET ?", args...).Scan(
		&rows,
	).Error; err != nil {
		return result, err
	}
	for _, row := range rows {
		record, err := row.domain(metadata.Definition)
		if err != nil {
			return result, err
		}
		result.Items = append(result.Items, record)
	}
	return result, nil
}

// eachRecord streams a bounded snapshot for copies and exports without loading unrelated versions.
func eachRecord(ctx context.Context, tx *gorm.DB, metadata table.Metadata, query querySQL, kind string, budget *CopyBudget, visit func(table.Record) error) error {
	args := append(append([]any{}, query.args...), query.orderArgs...)
	args = append(args, table.MaxTransferRecords+1)
	rows, err := tx.WithContext(ctx).Raw("SELECT r.record_id,r.values,i.created_at_ms,r.updated_at_ms"+recordsFrom+"WHERE "+query.where+" ORDER BY "+query.order+" LIMIT ?", args...).Rows()
	if err != nil {
		return err
	}
	defer rows.Close()
	count, size := 0, 0
	for rows.Next() {
		var row selectedRecord
		if err := rows.Scan(&row.RecordID, &row.Values, &row.CreatedAtMS, &row.UpdatedAtMS); err != nil {
			return err
		}
		count++
		size += len(row.Values)
		if budget != nil {
			budget.records++
			budget.bytes += len(row.Values)
			if budget.records > table.MaxTransferRecords || budget.bytes > table.MaxTransferBytes {
				return table.TransferLimit("copy")
			}
		}
		if count > table.MaxTransferRecords || (kind == "copy" && size > table.MaxTransferBytes) {
			return table.TransferLimit(kind)
		}
		record, err := row.domain(metadata.Definition)
		if err != nil {
			return err
		}
		if err := visit(record); err != nil {
			return err
		}
	}
	return rows.Err()
}

// CopyBudget bounds the combined source work and data of one atomic copy action.
type CopyBudget struct{ records, bytes int }

func copyRecords(ctx context.Context, tx *gorm.DB, metadata table.Metadata, budget *CopyBudget, visit func(table.Record) error) error {
	definition, err := json.Marshal(metadata.Definition)
	if err != nil {
		return err
	}
	budget.bytes += len(definition)
	if budget.bytes > table.MaxTransferBytes {
		return table.TransferLimit("copy")
	}
	query := querySQL{where: "r.table_id=? AND r.valid_from<=? AND (r.valid_to IS NULL OR r.valid_to>?)", args: []any{metadata.TableID, metadata.TableVersion, metadata.TableVersion}, order: "i.position, r.record_id"}
	return eachRecord(ctx, tx, metadata, query, "copy", budget, visit)
}
func CopyRecords(ctx context.Context, tx *gorm.DB, metadata table.Metadata) ([]table.Record, error) {
	return CopyRecordsWithinBudget(ctx, tx, metadata, &CopyBudget{})
}
func CopyRecordsWithinBudget(ctx context.Context, tx *gorm.DB, metadata table.Metadata, budget *CopyBudget) ([]table.Record, error) {
	result := []table.Record{}
	err := copyRecords(ctx, tx, metadata, budget, func(row table.Record) error { result = append(result, row); return nil })
	return result, err
}
func CheckCopyRecords(ctx context.Context, tx *gorm.DB, metadata table.Metadata, budget *CopyBudget) error {
	return copyRecords(ctx, tx, metadata, budget, func(table.Record) error { return nil })
}

func Export(ctx context.Context, tx *gorm.DB, metadata table.Metadata, input table.Query) (table.Projection, error) {
	view, err := table.SelectView(metadata.Definition, input.ViewID)
	if err != nil {
		return table.Projection{}, err
	}
	fields := table.FieldMap(metadata.Definition)
	ids := view.FieldIDs
	if len(ids) == 0 {
		for _, field := range metadata.Definition.Fields {
			ids = append(ids, field.ID)
		}
	}
	result := table.Projection{Title: metadata.Definition.Title, View: view.Name, Version: metadata.TableVersion, Columns: []string{}, Rows: [][]string{}}
	for _, id := range ids {
		result.Columns = append(result.Columns, fields[id].Name)
	}
	query := whereSQL(metadata.TableID, metadata.TableVersion, metadata.Definition, view)
	if err := groupFilter(&query, metadata.Definition, view, input); err != nil {
		return result, err
	}
	size := 0
	err = eachRecord(
		ctx,
		tx,
		metadata,
		query,
		"export",
		nil,
		func(row table.Record) error {
			cells := make([]string, 0, len(ids))
			for _, id := range ids {
				cell := table.Display(fields[id], row.Values[id])
				size += len(cell)
				if size > table.MaxTransferBytes {
					return table.TransferLimit("export")
				}
				cells = append(cells, cell)
			}
			result.Rows = append(result.Rows, cells)
			return nil
		},
	)
	if err != nil {
		return result, fmt.Errorf("project table export: %w", err)
	}
	return result, nil
}

// PublicSnapshot applies private view predicates in SQL and discards every non-public field before persistence.
func PublicSnapshot(ctx context.Context, tx *gorm.DB, metadata table.Metadata) (table.PublicData, error) {
	result, view := table.PublicDefinition(metadata.Definition)
	query := whereSQL(metadata.TableID, metadata.TableVersion, metadata.Definition, view)
	size := 0
	err := eachRecord(ctx, tx, metadata, query, "public", nil, func(row table.Record) error {
		values := map[string]any{}
		for _, field := range result.Fields {
			if value, exists := row.Values[field.ID]; exists {
				values[field.ID] = value
			}
		}
		encoded, err := json.Marshal(values)
		if err != nil {
			return err
		}
		size += len(encoded)
		if size > table.MaxTransferBytes {
			return table.TransferLimit("export")
		}
		result.Records = append(result.Records, table.PublicRecord{ID: row.ID, Values: values})
		return nil
	})
	result.Groups = table.PublicGroups(result)
	return result, err
}

// PublicRecords reads a bounded preview page with the same projection used for immutable publication.
func PublicRecords(ctx context.Context, tx *gorm.DB, metadata table.Metadata, input table.Query) (table.PublicPage, error) {
	data, view := table.PublicDefinition(metadata.Definition)
	query := whereSQL(metadata.TableID, metadata.TableVersion, metadata.Definition, view)
	result := table.PublicPage{Data: data, ContentVersion: metadata.ContentVersion, TableVersion: metadata.TableVersion}
	if err := tx.WithContext(ctx).Raw("SELECT count(*)"+recordsFrom+"WHERE "+query.where, query.args...).Scan(&result.Total).Error; err != nil {
		return result, err
	}
	args := append(append([]any{}, query.args...), query.orderArgs...)
	args = append(args, input.Page.Size, input.Page.Offset())
	var rows []selectedRecord
	if err := tx.WithContext(ctx).Raw("SELECT r.record_id,r.values,i.created_at_ms,r.updated_at_ms"+recordsFrom+"WHERE "+query.where+" ORDER BY "+query.order+" LIMIT ? OFFSET ?", args...).Scan(&rows).Error; err != nil {
		return result, err
	}
	for _, row := range rows {
		record, err := row.domain(metadata.Definition)
		if err != nil {
			return result, err
		}
		values := map[string]any{}
		for _, field := range data.Fields {
			if value, exists := record.Values[field.ID]; exists {
				values[field.ID] = value
			}
		}
		result.Data.Records = append(result.Data.Records, table.PublicRecord{ID: record.ID, Values: values})
	}
	if result.Data.View.GroupFieldID != nil {
		groups, err := groupCounts(ctx, tx, metadata, view, query)
		if err != nil {
			return result, err
		}
		result.Data.Groups = groups
	}
	return result, nil
}
