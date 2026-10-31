package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/identity"
	"orbis.local/orbis/internal/platform/fault"
)

type versionRow struct {
	ID, DocumentID, Kind, Description, Title, ContentHash, ContentSchema, AuthorName string
	SourceRevision, MetadataVersion                                                  int64
	Sequence                                                                         int64 `gorm:"default:(-)"`
	Name, AuthorID                                                                   *string
	TitleRecorded                                                                    bool
	Dependencies                                                                     json.RawMessage `gorm:"type:jsonb"`
	CapturedAtMS                                                                     int64           `gorm:"column:captured_at_ms"`
	CreatedAtMS                                                                      int64           `gorm:"column:created_at_ms"`
	UpdatedAtMS                                                                      int64           `gorm:"column:updated_at_ms"`
}

func (versionRow) TableName() string { return "document_versions" }
func (r versionRow) domain() (document.Version, error) {
	deps := []document.VersionDependency{}
	if len(r.Dependencies) > 0 {
		if err := json.Unmarshal(r.Dependencies, &deps); err != nil {
			return document.Version{}, err
		}
	}
	return document.Version{ID: r.ID, DocumentID: r.DocumentID, SourceRevision: r.SourceRevision, Kind: r.Kind, Name: r.Name, Description: r.Description, Title: r.Title, TitleRecorded: r.TitleRecorded, ContentHash: r.ContentHash, ContentSchema: r.ContentSchema, Dependencies: deps, AuthorID: r.AuthorID, AuthorName: r.AuthorName, MetadataVersion: r.MetadataVersion, Sequence: r.Sequence, CapturedAtMS: r.CapturedAtMS, CreatedAtMS: r.CreatedAtMS, UpdatedAtMS: r.UpdatedAtMS}, nil
}

func getVersion(tx *gorm.DB, did, id string) (document.Version, error) {
	var row versionRow
	if err := tx.Where("document_id=? AND id=?", did, id).Take(&row).Error; err != nil {
		return document.Version{}, missing(err)
	}
	return row.domain()
}

func (r *Repository) ListVersions(ctx context.Context, q document.VersionQuery) ([]document.Version, int64, error) {
	items := []document.Version{}
	upper := q.UpperSequence
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, _, err := readSnapshot(ctx, tx, document.ReadQuery{Scope: q.Scope}); err != nil {
			return err
		}
		if upper == 0 {
			if err := tx.Model(&versionRow{}).Where("document_id=?", q.Scope.DocumentID).Select("COALESCE(MAX(sequence),0)").Scan(&upper).Error; err != nil {
				return err
			}
		}
		query := tx.Where("document_id=? AND sequence<=?", q.Scope.DocumentID, upper)
		if q.BeforeSequence > 0 {
			query = query.Where("sequence<?", q.BeforeSequence)
		}
		var rows []versionRow
		if err := query.Omit("dependencies").Order("sequence DESC").Limit(q.Limit).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			item, err := row.domain()
			if err != nil {
				return err
			}
			items = append(items, item)
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return items, upper, err
}

func (r *Repository) GetVersion(ctx context.Context, scope document.DirectoryScope, id string) (document.Version, error) {
	var result document.Version
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, _, err := readSnapshot(ctx, tx, document.ReadQuery{Scope: scope}); err != nil {
			return err
		}
		var err error
		result, err = getVersion(tx, scope.DocumentID, id)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}

// ReadVersionContent follows the fixed manifest, without scanning temporal history.
func (r *Repository) ReadVersionContent(ctx context.Context, scope document.DirectoryScope, id string) (document.Version, document.Content, error) {
	var version document.Version
	var content document.Content
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, _, err := readSnapshot(ctx, tx, document.ReadQuery{Scope: scope}); err != nil {
			return err
		}
		var err error
		version, err = getVersion(tx, scope.DocumentID, id)
		if err != nil {
			return err
		}
		var source revisionRow
		if err := tx.Where("document_id=? AND version=?", scope.DocumentID, version.SourceRevision).Take(&source).Error; err != nil {
			return missing(err)
		}
		var rows []blockRow
		if err := tx.Table("document_version_blocks m").Select("b.*").Joins("JOIN document_block_versions b ON b.document_id=m.document_id AND b.block_id=m.block_id AND b.valid_from=m.block_revision").Where("m.version_id=? AND m.document_id=?", id, scope.DocumentID).Order("m.block_id").Scan(&rows).Error; err != nil {
			return err
		}
		records := make([]document.BlockRecord, 0, len(rows))
		for _, row := range rows {
			records = append(records, row.domain())
		}
		blocks, err := document.Expand(records)
		if err != nil {
			return err
		}
		content = document.Content{Revision: source.domain(), Blocks: blocks}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return version, content, err
}

type versionOperationRow struct {
	DocumentID, OperationID, RequestHash string
	ActorID                              *string
	Result                               json.RawMessage `gorm:"type:jsonb"`
	CreatedAtMS                          int64           `gorm:"column:created_at_ms"`
}

func (versionOperationRow) TableName() string { return "document_version_operations" }

func versionReceipt(tx *gorm.DB, scope document.DirectoryScope, operation, hash string) (document.Version, bool, error) {
	var row versionOperationRow
	err := tx.Where("document_id=? AND operation_id=?", scope.DocumentID, operation).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return document.Version{}, false, nil
	}
	if err != nil {
		return document.Version{}, false, err
	}
	if row.ActorID == nil || *row.ActorID != scope.ActorID || row.RequestHash != hash {
		return document.Version{}, false, fault.New(fault.Conflict, "IDEMPOTENCY_CONFLICT", "操作标识已用于其他请求")
	}
	var result document.Version
	err = json.Unmarshal(row.Result, &result)
	return result, true, err
}

func saveVersionReceipt(tx *gorm.DB, scope document.DirectoryScope, operation, hash string, now int64, result document.Version) error {
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return tx.Create(&versionOperationRow{DocumentID: scope.DocumentID, OperationID: operation, ActorID: &scope.ActorID, RequestHash: hash, Result: raw, CreatedAtMS: now}).Error
}

func (r *Repository) CreateVersion(ctx context.Context, scope document.DirectoryScope, input document.CreateVersion, hash string, now int64) (document.Version, error) {
	var result document.Version
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := LockContent(ctx, tx, scope); err != nil {
			return err
		}
		previous, replay, err := versionReceipt(tx, scope, input.OperationID, hash)
		if err != nil {
			return err
		}
		if replay {
			result = previous
			return nil
		}
		result, err = captureVersion(ctx, tx, scope.DocumentID, input.SourceRevision, document.VersionKindNamed, &input.Name, input.Description, &scope.ActorID, now)
		if err != nil {
			return err
		}
		return saveVersionReceipt(tx, scope, input.OperationID, hash, now, result)
	})
	return result, err
}

func (r *Repository) EditVersion(ctx context.Context, scope document.DirectoryScope, id string, input document.EditVersion, hash string, now int64) (document.Version, error) {
	var result document.Version
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := LockContent(ctx, tx, scope); err != nil {
			return err
		}
		previous, replay, err := versionReceipt(tx, scope, input.OperationID, hash)
		if err != nil {
			return err
		}
		if replay {
			result = previous
			return nil
		}
		result, err = getVersion(tx, scope.DocumentID, id)
		if err != nil {
			return err
		}
		if result.MetadataVersion != input.ExpectedMetadataVersion {
			return fault.New(fault.Conflict, "DOCUMENT_VERSION_METADATA_CONFLICT", "版本名称或说明已被修改，请重新载入")
		}
		if err := tx.Model(&versionRow{}).Where("id=?", id).Updates(map[string]any{"name": input.Name, "description": input.Description, "metadata_version": result.MetadataVersion + 1, "updated_at_ms": now}).Error; err != nil {
			return err
		}
		result.Name, result.Description, result.MetadataVersion, result.UpdatedAtMS = input.Name, input.Description, result.MetadataVersion+1, now
		return saveVersionReceipt(tx, scope, input.OperationID, hash, now, result)
	})
	return result, err
}

// captureVersion requires the document row lock. Only content references and a digest are stored.
func captureVersion(ctx context.Context, tx *gorm.DB, did string, revision int64, kind string, name *string, description string, actor *string, now int64) (document.Version, error) {
	if kind != document.VersionKindNamed {
		var existing versionRow
		err := tx.Where("document_id=? AND source_revision=? AND kind=?", did, revision, kind).Take(&existing).Error
		if err == nil {
			return existing.domain()
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return document.Version{}, err
		}
	}
	var source revisionRow
	if err := tx.Where("document_id=? AND version=?", did, revision).Take(&source).Error; err != nil {
		return document.Version{}, missing(err)
	}
	var rows []blockRow
	if err := tx.Where("document_id=? AND valid_from<=? AND (valid_to IS NULL OR valid_to>?)", did, revision, revision).Order("block_id").Find(&rows).Error; err != nil {
		return document.Version{}, err
	}
	records := make([]document.BlockRecord, 0, len(rows))
	for _, row := range rows {
		records = append(records, row.domain())
	}
	blocks, err := document.Expand(records)
	if err != nil {
		return document.Version{}, err
	}
	deps := []document.VersionDependency{}
	for _, ref := range document.MediaReferences(blocks) {
		deps = append(deps, document.VersionDependency{Kind: "asset", ID: ref.ID})
	}
	for _, ref := range document.TableReferences(blocks) {
		value := ref.Version
		deps = append(deps, document.VersionDependency{Kind: "table", ID: ref.TableID, Revision: &value})
	}
	for _, ref := range document.SheetReferences(blocks) {
		deps = append(deps, document.VersionDependency{Kind: "sheet_link", ID: ref.ID})
	}
	sort.Slice(deps, func(i, j int) bool {
		if deps[i].Kind != deps[j].Kind {
			return deps[i].Kind < deps[j].Kind
		}
		if deps[i].ID != deps[j].ID {
			return deps[i].ID < deps[j].ID
		}
		return deps[i].Revision != nil && deps[j].Revision != nil && *deps[i].Revision < *deps[j].Revision
	})
	unique := deps[:0]
	for _, dep := range deps {
		if len(unique) > 0 {
			last := unique[len(unique)-1]
			if dep.Kind == last.Kind && dep.ID == last.ID && ((dep.Revision == nil && last.Revision == nil) || (dep.Revision != nil && last.Revision != nil && *dep.Revision == *last.Revision)) {
				continue
			}
		}
		unique = append(unique, dep)
	}
	deps = unique
	digest, err := document.VersionContentHash(document.Content{Revision: source.domain(), Blocks: blocks})
	if err != nil {
		return document.Version{}, err
	}
	if kind == document.VersionKindAutomatic {
		var last versionRow
		err := tx.Where("document_id=?", did).Order("source_revision DESC,sequence DESC").Take(&last).Error
		if err == nil && last.ContentHash == digest {
			return last.domain()
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return document.Version{}, err
		}
	}
	encoded, err := json.Marshal(deps)
	if err != nil {
		return document.Version{}, err
	}
	author, authorName := source.AuthorID, source.AuthorName
	if actor != nil {
		var user struct{ DisplayName *string }
		if err := tx.Table("users").Select("display_name").Where("id=?", *actor).Take(&user).Error; err != nil {
			return document.Version{}, err
		}
		author, authorName = actor, (identity.User{DisplayName: user.DisplayName}).Name()
	}
	row := versionRow{ID: uuid.NewString(), DocumentID: did, SourceRevision: revision, Kind: kind, Name: name, Description: description, Title: source.Title, TitleRecorded: source.TitleRecorded, ContentHash: digest, ContentSchema: document.VersionContentSchema, Dependencies: encoded, AuthorID: author, AuthorName: authorName, MetadataVersion: 1, CapturedAtMS: source.CreatedAtMS, CreatedAtMS: now, UpdatedAtMS: now}
	if err := tx.WithContext(ctx).Clauses(clause.Returning{}).Create(&row).Error; err != nil {
		return document.Version{}, err
	}
	manifest := make([]map[string]any, 0, len(rows))
	for _, block := range rows {
		manifest = append(manifest, map[string]any{"version_id": row.ID, "document_id": did, "block_id": block.BlockID, "block_revision": block.ValidFrom})
	}
	if len(manifest) > 0 {
		if err := tx.Table("document_version_blocks").CreateInBatches(manifest, 250).Error; err != nil {
			return document.Version{}, err
		}
	}
	assets := []map[string]any{}
	tables := []map[string]any{}
	for _, dep := range deps {
		switch dep.Kind {
		case "asset":
			assets = append(assets, map[string]any{"version_id": row.ID, "asset_id": dep.ID})
		case "table":
			tables = append(tables, map[string]any{"version_id": row.ID, "table_id": dep.ID, "table_revision": *dep.Revision})
		}
	}
	if len(assets) > 0 {
		if err := tx.Table("document_version_assets").CreateInBatches(assets, 250).Error; err != nil {
			return document.Version{}, err
		}
	}
	if len(tables) > 0 {
		if err := tx.Table("document_version_tables").CreateInBatches(tables, 250).Error; err != nil {
			return document.Version{}, err
		}
	}
	return row.domain()
}

const versionDifferenceTextLimit = 400

func (r *Repository) CompareVersions(ctx context.Context, scope document.DirectoryScope, from, to, after string, limit int) (document.VersionComparison, error) {
	result := document.VersionComparison{Items: []document.VersionDifference{}}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, _, err := readSnapshot(ctx, tx, document.ReadQuery{Scope: scope}); err != nil {
			return err
		}
		var err error
		result.From, err = getVersion(tx, scope.DocumentID, from)
		if err != nil {
			return err
		}
		result.To, err = getVersion(tx, scope.DocumentID, to)
		if err != nil {
			return err
		}
		query := `WITH before AS (SELECT b.block_id,b.parent_id,b.position,b.payload,b.plain_text FROM document_version_blocks m JOIN document_block_versions b ON b.document_id=m.document_id AND b.block_id=m.block_id AND b.valid_from=m.block_revision WHERE m.version_id=?),
            after AS (SELECT b.block_id,b.parent_id,b.position,b.payload,b.plain_text FROM document_version_blocks m JOIN document_block_versions b ON b.document_id=m.document_id AND b.block_id=m.block_id AND b.valid_from=m.block_revision WHERE m.version_id=?)
            SELECT COALESCE(a.block_id,b.block_id) AS block_id,
            CASE WHEN b.block_id IS NULL THEN 'added' WHEN a.block_id IS NULL THEN 'removed' WHEN a.payload IS DISTINCT FROM b.payload THEN 'modified' ELSE 'moved' END AS change,
            a.payload IS DISTINCT FROM b.payload AS content_changed,
            (a.parent_id IS DISTINCT FROM b.parent_id OR a.position IS DISTINCT FROM b.position) AS position_changed,
            left(b.plain_text,?) AS before_text,left(a.plain_text,?) AS after_text
            FROM before b FULL OUTER JOIN after a ON a.block_id=b.block_id
            WHERE (a.block_id IS NULL OR b.block_id IS NULL OR a.parent_id IS DISTINCT FROM b.parent_id OR a.position<>b.position OR a.payload IS DISTINCT FROM b.payload)`
		args := []any{result.From.ID, result.To.ID, versionDifferenceTextLimit, versionDifferenceTextLimit}
		if after != "" {
			query += " AND COALESCE(a.block_id,b.block_id)>?"
			args = append(args, after)
		}
		args = append(args, limit)
		return tx.Raw(query+" ORDER BY COALESCE(a.block_id,b.block_id) LIMIT ?", args...).Scan(&result.Items).Error
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
