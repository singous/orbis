package postgres

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/table"
)

const writeBatch = 250

func ensureKinds(ctx context.Context, tx *gorm.DB, id string, definition table.Definition) error {
	fields := table.FieldMap(definition)
	ids := make([]string, 0, len(fields))
	rows := make([]kindRow, 0, len(fields))
	for _, field := range definition.Fields {
		ids = append(ids, field.ID)
		rows = append(rows, kindRow{TableID: id, FieldID: field.ID, Kind: field.Kind})
	}
	var previous []kindRow
	if err := tx.WithContext(ctx).Where("table_id=? AND field_id IN ?", id, ids).Find(&previous).Error; err != nil {
		return err
	}
	for _, row := range previous {
		if fields[row.FieldID].Kind != row.Kind {
			return table.Invalid("已有字段 ID 的类型不可更改，请新建字段")
		}
	}
	return tx.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(rows, writeBatch).Error
}
func revision(ctx context.Context, tx *gorm.DB, id string, version int64, base *int64, definition table.Definition, now int64) error {
	data, err := json.Marshal(definition)
	if err != nil {
		return err
	}
	return tx.WithContext(ctx).Create(&revisionRow{TableID: id, Version: version, BaseVersion: base, Definition: data, CreatedAtMS: now}).Error
}
func insertRecords(ctx context.Context, tx *gorm.DB, id string, version int64, records []table.Record, now int64) error {
	if len(records) == 0 {
		return nil
	}
	identities := make([]identityRow, 0, len(records))
	rows := make([]recordRow, 0, len(records))
	for _, record := range records {
		data, err := json.Marshal(record.Values)
		if err != nil {
			return err
		}
		identities = append(identities, identityRow{TableID: id, RecordID: record.ID, CreatedAtMS: now})
		rows = append(rows, recordRow{TableID: id, RecordID: record.ID, ValidFrom: version, Values: data, UpdatedAtMS: now})
	}
	if err := tx.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(identities, writeBatch).Error; err != nil {
		return err
	}
	return tx.WithContext(ctx).CreateInBatches(rows, writeBatch).Error
}
func Create(ctx context.Context, tx *gorm.DB, scope table.Scope, block string, definition table.Definition, records []table.Record, now int64) (Header, error) {
	header := Header{
		ID:          uuid.NewString(),
		WorkspaceID: scope.WorkspaceID,
		DocumentID:  scope.DocumentID,
		BlockID:     block,
		HeadVersion: 1,
		CreatedAtMS: now,
		UpdatedAtMS: now,
	}
	if err := tx.WithContext(ctx).Create(&header).Error; err != nil {
		return Header{}, err
	}
	if err := ensureKinds(ctx, tx, header.ID, definition); err != nil {
		return Header{}, err
	}
	if err := revision(
		ctx,
		tx,
		header.ID,
		1,
		nil,
		definition,
		now,
	); err != nil {
		return Header{}, err
	}
	if err := insertRecords(
		ctx,
		tx,
		header.ID,
		1,
		records,
		now,
	); err != nil {
		return Header{}, err
	}
	return header, nil
}
func atVersion(tx *gorm.DB, id string, version int64) *gorm.DB {
	return tx.Model(&recordRow{}).Where("table_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)", id, version, version)
}
func targets(ctx context.Context, tx *gorm.DB, id string, version int64, ids []string) (map[string]map[string]any, error) {
	result := map[string]map[string]any{}
	if len(ids) == 0 {
		return result, nil
	}
	var rows []recordRow
	if err := atVersion(tx.WithContext(ctx), id, version).Where("record_id IN ?", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		var values map[string]any
		if err := json.Unmarshal(row.Values, &values); err != nil {
			return nil, err
		}
		result[row.RecordID] = values
	}
	return result, nil
}

// validateOptions checks unchanged records in one query; changed records are validated after their patches are merged.
func validateOptions(ctx context.Context, tx *gorm.DB, id string, base int64, definition table.Definition, changed []string) error {
	conditions := []string{}
	args := []any{}
	for _, field := range definition.Fields {
		if field.Kind != "select" && field.Kind != "multi_select" {
			continue
		}
		options := make([]string, 0, len(field.Options))
		for _, option := range field.Options {
			options = append(options, option.ID)
		}
		if field.Kind == "select" {
			condition := "jsonb_extract_path_text(values, ?) IS NOT NULL"
			args = append(args, field.ID)
			if len(options) > 0 {
				condition += " AND jsonb_extract_path_text(values, ?) NOT IN ?"
				args = append(args, field.ID, options)
			}
			conditions = append(conditions, "("+condition+")")
		} else {
			condition := `EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(nullif(jsonb_extract_path(values, ?),'null'::jsonb),'[]'::jsonb)) AS option(value)`
			args = append(args, field.ID)
			if len(options) > 0 {
				condition += " WHERE option.value NOT IN ?"
				args = append(args, options)
			}
			conditions = append(conditions, condition+")")
		}
	}
	if len(conditions) == 0 {
		return nil
	}
	query := atVersion(tx.WithContext(ctx), id, base)
	if len(changed) > 0 {
		query = query.Where("record_id NOT IN ?", changed)
	}
	var rows []recordRow
	if err := query.Select("record_id").Where("("+strings.Join(conditions, " OR ")+")", args...).Limit(1).Find(&rows).Error; err != nil {
		return err
	}
	if len(rows) > 0 {
		return table.Invalid("仍有记录使用被移除的选项，请在同一操作中更新或删除这些记录")
	}
	return nil
}
func inverseChanges(base table.Metadata, input table.Changes, before map[string]map[string]any) table.Changes {
	inverse := table.Changes{Upserts: []table.Upsert{}, Deletes: []string{}, Restores: []table.RecordRestore{}}
	if input.Definition != nil {
		previous := base.Definition
		inverse.Definition = &previous
	}
	replace := func(id string) {
		if _, exists := before[id]; exists {
			inverse.Restores = append(inverse.Restores, table.RecordRestore{ID: id, TableVersion: base.TableVersion})
		} else {
			inverse.Deletes = append(inverse.Deletes, id)
		}
	}
	for _, patch := range input.Upserts {
		replace(patch.ID)
	}
	for _, restore := range input.Restores {
		replace(restore.ID)
	}
	for _, id := range input.Deletes {
		if _, exists := before[id]; exists {
			inverse.Restores = append(inverse.Restores, table.RecordRestore{ID: id, TableVersion: base.TableVersion})
		}
	}
	return inverse
}

// restoredRecords reads only existing immutable snapshots in the current table, including their hidden historical cells.
func restoredRecords(ctx context.Context, tx *gorm.DB, id string, restores []table.RecordRestore, definition table.Definition) ([]table.Record, error) {
	result := []table.Record{}
	if len(restores) == 0 {
		return result, nil
	}
	values := make([]string, 0, len(restores))
	args := []any{}
	for _, restore := range restores {
		values = append(values, "(CAST(? AS UUID),CAST(? AS BIGINT))")
		args = append(args, restore.ID, restore.TableVersion)
	}
	args = append(args, id)
	query := `WITH requested (record_id,version) AS (VALUES ` + strings.Join(values, ",") + `)
SELECT r.record_id,r.values FROM requested q
JOIN data_table_revisions v ON v.table_id=? AND v.version=q.version
JOIN data_table_record_versions r ON r.table_id=v.table_id AND r.record_id=q.record_id
    AND r.valid_from<=v.version AND (r.valid_to IS NULL OR r.valid_to>v.version)`
	var rows []recordRow
	if err := tx.WithContext(ctx).Raw(query, args...).Scan(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) != len(restores) {
		return nil, fault.New(fault.NotFound, "TABLE_RECORD_SNAPSHOT_NOT_FOUND", "历史快照中不存在所需记录")
	}
	for _, row := range rows {
		var stored map[string]any
		if err := json.Unmarshal(row.Values, &stored); err != nil {
			return nil, err
		}
		encoded, err := json.Marshal(stored)
		if err != nil {
			return nil, err
		}
		if len(encoded) > table.MaxRecordBytes {
			return nil, fault.Field("body.restores", "历史记录超过 64 KiB 限制")
		}
		for _, field := range definition.Fields {
			if value, exists := stored[field.ID]; exists {
				if err := table.ValidateValue(field, value); err != nil {
					return nil, err
				}
			}
		}
		result = append(result, table.Record{ID: row.RecordID, Values: stored})
	}
	return result, nil
}

func Mutate(ctx context.Context, tx *gorm.DB, header Header, base table.Metadata, input table.Changes, now int64) (int64, table.Changes, error) {
	if header.HeadVersion >= table.MaxVersion {
		return 0, table.Changes{}, fault.New(fault.Conflict, "TABLE_VERSION_EXHAUSTED", "表格版本号已达到上限")
	}
	definition := base.Definition
	if input.Definition != nil {
		definition = *input.Definition
	}
	if err := ensureKinds(ctx, tx, header.ID, definition); err != nil {
		return 0, table.Changes{}, err
	}
	ids := make([]string, 0, len(input.Upserts)+len(input.Deletes))
	for _, patch := range input.Upserts {
		ids = append(ids, patch.ID)
	}
	ids = append(ids, input.Deletes...)
	for _, restore := range input.Restores {
		ids = append(ids, restore.ID)
	}
	before, err := targets(ctx, tx, header.ID, base.TableVersion, ids)
	if err != nil {
		return 0, table.Changes{}, err
	}
	replacements := make([]table.Record, 0, len(input.Upserts))
	for _, patch := range input.Upserts {
		values, err := table.MergeValues(before[patch.ID], patch.Values, definition)
		if err != nil {
			return 0, table.Changes{}, err
		}
		replacements = append(replacements, table.Record{ID: patch.ID, Values: values})
	}
	restored, err := restoredRecords(ctx, tx, header.ID, input.Restores, definition)
	if err != nil {
		return 0, table.Changes{}, err
	}
	replacements = append(replacements, restored...)
	if input.Definition != nil {
		if err := validateOptions(
			ctx,
			tx,
			header.ID,
			base.TableVersion,
			definition,
			ids,
		); err != nil {
			return 0, table.Changes{}, err
		}
	}
	next := header.HeadVersion + 1
	if err := revision(
		ctx,
		tx,
		header.ID,
		next,
		&base.TableVersion,
		definition,
		now,
	); err != nil {
		return 0, table.Changes{}, err
	}
	if base.TableVersion != header.HeadVersion {
		if err := tx.WithContext(ctx).Model(&recordRow{}).Where("table_id=? AND valid_to IS NULL", header.ID).Update("valid_to", next).Error; err != nil {
			return 0, table.Changes{}, err
		}
		sql := `INSERT INTO data_table_record_versions (table_id,record_id,valid_from,values,updated_at_ms)
SELECT table_id,record_id,?,values,updated_at_ms FROM data_table_record_versions
WHERE table_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)`
		args := []any{next, header.ID, base.TableVersion, base.TableVersion}
		if len(ids) > 0 {
			sql += " AND record_id NOT IN ?"
			args = append(args, ids)
		}
		if err := tx.WithContext(ctx).Exec(sql, args...).Error; err != nil {
			return 0, table.Changes{}, err
		}
	} else if len(ids) > 0 {
		if err := tx.WithContext(ctx).Model(&recordRow{}).Where("table_id=? AND record_id IN ? AND valid_to IS NULL", header.ID, ids).Update("valid_to", next).Error; err != nil {
			return 0, table.Changes{}, err
		}
	}
	if err := insertRecords(
		ctx,
		tx,
		header.ID,
		next,
		replacements,
		now,
	); err != nil {
		return 0, table.Changes{}, err
	}
	if err := tx.WithContext(ctx).Model(&Header{}).Where("id=?", header.ID).Updates(map[string]any{"head_version": next, "updated_at_ms": now}).Error; err != nil {
		return 0, table.Changes{}, err
	}
	return next, inverseChanges(base, input, before), nil
}
