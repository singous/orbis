package postgres

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	"gorm.io/gorm"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

func readSnapshot(ctx context.Context, tx *gorm.DB, q document.ReadQuery) (document.Document, int64, error) {
	role, err := wsstore.New(tx).Role(ctx, q.Scope.WorkspaceID, q.Scope.ActorID)
	if err != nil {
		return document.Document{}, 0, err
	}
	if !workspace.Allowed(role, workspace.Read) {
		return document.Document{}, 0, fault.Denied()
	}
	doc, err := New(tx).Get(ctx, q.Scope.WorkspaceID, q.Scope.DocumentID)
	if err != nil {
		return doc, 0, err
	}
	version := q.Version
	if version == 0 {
		version = doc.ContentVersion
	}
	var count int64
	if err := tx.Model(&revisionRow{}).Where("document_id=? AND version=?", doc.ID, version).Count(&count).Error; err != nil {
		return doc, 0, err
	}
	if count != 1 {
		return doc, 0, fault.Missing()
	}
	return doc, version, nil
}
func childCounts(ctx context.Context, tx *gorm.DB, did string, version int64, items []document.BlockRecord) ([]document.BlockRecord, error) {
	if len(items) == 0 {
		return items, nil
	}
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	var rows []struct {
		ParentID string
		Count    int
	}
	if err := tx.WithContext(ctx).Table("document_block_versions").Select("parent_id,count(*) AS count").Where("document_id=? AND parent_id IN ? AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)", did, ids, version, version).Group("parent_id").Scan(&rows).Error; err != nil {
		return nil, err
	}
	counts := map[string]int{}
	for _, row := range rows {
		counts[row.ParentID] = row.Count
	}
	for i := range items {
		items[i].ChildCount = counts[items[i].ID]
	}
	return items, nil
}
func (r *Repository) ChildrenBlocks(ctx context.Context, q document.ReadQuery) ([]document.BlockRecord, int64, error) {
	result := []document.BlockRecord{}
	var version int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		_, resolved, err := readSnapshot(ctx, tx, q)
		if err != nil {
			return err
		}
		version = resolved
		q.Version = resolved
		result, err = ChildrenAt(ctx, tx, q)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, version, err
}
func (r *Repository) ReadBlock(ctx context.Context, q document.ReadQuery) (document.BlockRecord, int64, error) {
	var result document.BlockRecord
	var version int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		doc, resolved, err := readSnapshot(ctx, tx, q)
		if err != nil {
			return err
		}
		version = resolved
		var row blockRow
		if err := tx.Where("document_id=? AND block_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)", doc.ID, q.BlockID, version, version).Take(&row).Error; err != nil {
			return missing(err)
		}
		items, err := childCounts(ctx, tx, doc.ID, version, []document.BlockRecord{row.domain()})
		if err != nil {
			return err
		}
		result = items[0]
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, version, err
}

const outlineSQL = `WITH RECURSIVE walk AS (
 SELECT block_id,parent_id,valid_from,payload->>'type' AS kind,
   CASE WHEN payload->>'type'='heading' THEN (payload->'props'->>'level')::integer ELSE 0 END AS level,
   CASE WHEN payload->>'type'='heading' THEN left(plain_text,240) ELSE '' END AS text,ARRAY[position] AS path
 FROM document_block_versions WHERE document_id=@document AND parent_id IS NULL AND valid_from<=@version AND (valid_to IS NULL OR valid_to>@version)
 UNION ALL
 SELECT b.block_id,b.parent_id,b.valid_from,b.payload->>'type',
   CASE WHEN b.payload->>'type'='heading' THEN (b.payload->'props'->>'level')::integer ELSE 0 END,
   CASE WHEN b.payload->>'type'='heading' THEN left(b.plain_text,240) ELSE '' END,w.path || b.position
 FROM document_block_versions b JOIN walk w ON b.parent_id=w.block_id
 WHERE b.document_id=@document AND b.valid_from<=@version AND (b.valid_to IS NULL OR b.valid_to>@version) AND cardinality(w.path)<@depth
) `

func pathArray(path []int) string {
	values := make([]string, len(path))
	for i, value := range path {
		values[i] = strconv.Itoa(value)
	}
	return "{" + strings.Join(values, ",") + "}"
}
func parsePath(value string) ([]int, error) {
	result := []int{}
	for _, item := range strings.Split(strings.Trim(value, "{}"), ",") {
		if item == "" {
			continue
		}
		parsed, err := strconv.Atoi(item)
		if err != nil {
			return nil, fmt.Errorf("decode outline path: %w", err)
		}
		result = append(result, parsed)
	}
	return result, nil
}
func (r *Repository) Outline(ctx context.Context, q document.ReadQuery) ([]document.Heading, int64, error) {
	result := []document.Heading{}
	var version int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		doc, resolved, err := readSnapshot(ctx, tx, q)
		if err != nil {
			return err
		}
		version = resolved
		args := []any{sql.Named("document", doc.ID), sql.Named("version", version), sql.Named("depth", document.MaxDepth), sql.Named("limit", q.Limit), sql.Named("after", q.AfterID), sql.Named("path", pathArray(q.AfterPath))}
		where := "kind='heading'"
		if q.AfterID != "" {
			where += " AND (path>CAST(@path AS INTEGER[]) OR (path=CAST(@path AS INTEGER[]) AND block_id>CAST(@after AS UUID)))"
		}
		var rows []struct {
			ID            string
			ParentID      *string
			Level         int
			Text          string
			BlockRevision int64
			PathText      string
		}
		if err := tx.Raw(outlineSQL+"SELECT block_id AS id,parent_id,level,text,valid_from AS block_revision,path::text AS path_text FROM walk WHERE "+where+" ORDER BY path,block_id LIMIT @limit", args...).Scan(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			path, err := parsePath(row.PathText)
			if err != nil {
				return err
			}
			if len(path) == 0 {
				return fmt.Errorf("heading path has no root position")
			}
			result = append(result, document.Heading{RootPosition: path[0], ID: row.ID, ParentID: row.ParentID, Level: row.Level, Text: row.Text, BlockRevision: row.BlockRevision, Path: path})
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, version, err
}
func (r *Repository) Changes(ctx context.Context, q document.ReadQuery) ([]document.BlockChange, int64, error) {
	result := []document.BlockChange{}
	var version int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		doc, resolved, err := readSnapshot(ctx, tx, q)
		if err != nil {
			return err
		}
		version = resolved
		if q.SinceVersion > version {
			return fault.Field("query.since_version", "来源版本不能高于目标版本")
		}
		var count int64
		if err := tx.Model(&revisionRow{}).Where("document_id=? AND version=?", doc.ID, q.SinceVersion).Count(&count).Error; err != nil {
			return err
		}
		if count != 1 {
			return fault.Missing()
		}
		query := `WITH before AS (SELECT * FROM document_block_versions WHERE document_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)),
          after AS (SELECT * FROM document_block_versions WHERE document_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>?))
          SELECT coalesce(a.block_id,b.block_id) AS id,CASE WHEN a.block_id IS NULL THEN 'deleted' ELSE 'upsert' END AS change,a.valid_from AS block_revision,a.parent_id,b.parent_id AS previous_parent_id,a.position,b.position AS previous_position
          FROM before b FULL OUTER JOIN after a ON a.block_id=b.block_id
          WHERE (a.block_id IS NULL OR b.block_id IS NULL OR a.parent_id IS DISTINCT FROM b.parent_id OR a.position<>b.position OR a.payload IS DISTINCT FROM b.payload)`
		args := []any{doc.ID, q.SinceVersion, q.SinceVersion, doc.ID, version, version}
		if q.AfterID != "" {
			query += " AND coalesce(a.block_id,b.block_id)>?"
			args = append(args, q.AfterID)
		}
		query += " ORDER BY coalesce(a.block_id,b.block_id) LIMIT ?"
		args = append(args, q.Limit)
		return tx.Raw(query, args...).Scan(&result).Error
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, version, err
}

// ChildrenAt reads a caller-authorized document revision inside the caller's transaction.
func ChildrenAt(ctx context.Context, tx *gorm.DB, q document.ReadQuery) ([]document.BlockRecord, error) {
	tx = tx.WithContext(ctx)
	if q.ParentID != nil {
		var count int64
		if err := tx.Model(&blockRow{}).Where("document_id=? AND block_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)", q.Scope.DocumentID, *q.ParentID, q.Version, q.Version).Count(&count).Error; err != nil {
			return nil, err
		}
		if count != 1 {
			return nil, fault.Missing()
		}
	}
	query := tx.Where("document_id=? AND parent_id IS NOT DISTINCT FROM CAST(? AS UUID) AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)", q.Scope.DocumentID, q.ParentID, q.Version, q.Version)
	if q.AfterID != "" {
		query = query.Where("position>? OR (position=? AND block_id>?)", q.AfterPosition, q.AfterPosition, q.AfterID)
	}
	rows := []blockRow{}
	if err := query.Order("position,block_id").Limit(q.Limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	result := make([]document.BlockRecord, 0, len(rows))
	for _, row := range rows {
		result = append(result, row.domain())
	}
	return childCounts(ctx, tx, q.Scope.DocumentID, q.Version, result)
}
