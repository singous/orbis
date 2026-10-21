package postgres

import (
	"context"
	"database/sql"
	"encoding/json"

	"gorm.io/gorm"
	"orbis.local/orbis/internal/document"
)

// ReferencesAsset follows only renderer fields, never arbitrary editor metadata or textual UUID mentions.
func ReferencesAsset(ctx context.Context, tx *gorm.DB, did string, version int64, id string) (bool, error) {
	var exists bool
	err := tx.WithContext(ctx).Raw(`SELECT EXISTS(SELECT 1 FROM document_block_versions b
      WHERE b.document_id=@document AND b.valid_from<=@version AND (b.valid_to IS NULL OR b.valid_to>@version)
      AND (
        (b.payload->>'type' IN ('image','audio','video','file','drawing') AND b.payload->'props'->'source'->>'type'='asset' AND b.payload->'props'->'source'->>'asset_id'=@asset)
        OR (b.payload->>'type'='card' AND b.payload->'props'->>'href'=@link)
        OR jsonb_exists(jsonb_path_query_array(b.payload,'$.content[*].href'),@link)
        OR (b.payload->>'type'='table' AND jsonb_exists(jsonb_path_query_array(b.payload,'$.table.rows[*][*].content[*].href'),@link))
      ))`, sql.Named("document", did), sql.Named("version", version), sql.Named("asset", id), sql.Named("link", document.AssetLink(id))).Scan(&exists).Error
	return exists, err
}

// ReferencedAssetIDs checks a batch through the same renderer paths without N repeated body scans.
func ReferencedAssetIDs(ctx context.Context, tx *gorm.DB, did string, version int64, ids []string) (map[string]bool, error) {
	result := map[string]bool{}
	if len(ids) == 0 {
		return result, nil
	}
	targets := map[string]bool{}
	for _, id := range ids {
		targets[id] = true
	}
	encoded, err := json.Marshal(targets)
	if err != nil {
		return nil, err
	}
	var rows []struct{ ID string }
	err = tx.WithContext(ctx).Raw(`WITH bodies AS (
      SELECT payload FROM document_block_versions WHERE document_id=@document AND valid_from<=@version AND (valid_to IS NULL OR valid_to>@version)
    ), refs AS (
      SELECT payload->'props'->'source'->>'asset_id' AS id FROM bodies
       WHERE payload->>'type' IN ('image','audio','video','file','drawing') AND payload->'props'->'source'->>'type'='asset'
      UNION ALL SELECT substr(h.value,7) FROM bodies CROSS JOIN LATERAL jsonb_array_elements_text(jsonb_path_query_array(payload,'$.content[*].href')) h(value) WHERE starts_with(h.value,'asset:')
      UNION ALL SELECT substr(payload->'props'->>'href',7) FROM bodies WHERE payload->>'type'='card' AND starts_with(payload->'props'->>'href','asset:')
      UNION ALL SELECT substr(h.value,7) FROM bodies CROSS JOIN LATERAL jsonb_array_elements_text(jsonb_path_query_array(payload,'$.table.rows[*][*].content[*].href')) h(value) WHERE payload->>'type'='table' AND starts_with(h.value,'asset:')
    ) SELECT DISTINCT id FROM refs WHERE jsonb_exists(CAST(@targets AS JSONB),id)`, sql.Named("document", did), sql.Named("version", version), sql.Named("targets", string(encoded))).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.ID] = true
	}
	return result, nil
}

// ReferencedAssetsInSnapshots evaluates renderer references in a caller-authorized snapshot subquery (id,version).
func ReferencedAssetsInSnapshots(ctx context.Context, tx *gorm.DB, snapshots *gorm.DB, ids []string) (map[string]bool, error) {
	result := map[string]bool{}
	if len(ids) == 0 {
		return result, nil
	}
	targets := map[string]bool{}
	for _, id := range ids {
		targets[id] = true
	}
	encoded, err := json.Marshal(targets)
	if err != nil {
		return nil, err
	}
	var rows []struct{ ID string }
	query := `WITH bodies AS (
      SELECT b.payload FROM document_block_versions b JOIN (?) s ON s.id=b.document_id
        AND b.valid_from<=s.version AND (b.valid_to IS NULL OR b.valid_to>s.version)
    ), refs AS (
      SELECT payload->'props'->'source'->>'asset_id' AS id FROM bodies WHERE payload->>'type' IN ('image','audio','video','file','drawing') AND payload->'props'->'source'->>'type'='asset'
      UNION ALL SELECT substr(h.value,7) FROM bodies CROSS JOIN LATERAL jsonb_array_elements_text(jsonb_path_query_array(payload,'$.content[*].href')) h(value) WHERE starts_with(h.value,'asset:')
      UNION ALL SELECT substr(payload->'props'->>'href',7) FROM bodies WHERE payload->>'type'='card' AND starts_with(payload->'props'->>'href','asset:')
      UNION ALL SELECT substr(h.value,7) FROM bodies CROSS JOIN LATERAL jsonb_array_elements_text(jsonb_path_query_array(payload,'$.table.rows[*][*].content[*].href')) h(value) WHERE payload->>'type'='table' AND starts_with(h.value,'asset:')
    ) SELECT DISTINCT id FROM refs WHERE jsonb_exists(CAST(? AS JSONB),id)`
	if err := tx.WithContext(ctx).Raw(query, snapshots, string(encoded)).Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.ID] = true
	}
	return result, nil
}
