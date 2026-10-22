// Package postgres stores publishing aggregates and coordinates authorized snapshot transactions.
package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	boardstore "orbis.local/orbis/internal/board/postgres"
	"orbis.local/orbis/internal/document/publicview"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/platform/pagination"
	"orbis.local/orbis/internal/publishing"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

const rowBatchSize = 250

type Repository struct {
	boards        *boardstore.Projector
	db            *gorm.DB
	policy        publicview.URLPolicy
	publicBaseURL string
}

func New(db *gorm.DB, publicBaseURL string, boards ...*boardstore.Projector) (*Repository, error) {
	if publicBaseURL == "" {
		publicBaseURL = publishing.DefaultPublicBaseURL
	}
	parsed, err := url.Parse(publicBaseURL)
	if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("public base URL must be HTTP(S) without credentials, query or fragment")
	}
	var projector *boardstore.Projector
	if len(boards) > 0 {
		projector = boards[0]
	}
	return &Repository{boards: projector, db: db, policy: publicview.URLPolicy{InternalHosts: []string{parsed.Hostname()}}, publicBaseURL: strings.TrimRight(publicBaseURL, "/")}, nil
}

type siteRow struct {
	ID, WorkspaceID, Name, Slug       string
	Configuration                     json.RawMessage `gorm:"type:jsonb"`
	PageRegistry                      json.RawMessage `gorm:"type:jsonb"`
	Version, ReleaseSequence          int64
	PublishedReleaseID, PublishedSlug *string
	CreatedAtMS, UpdatedAtMS          int64
}

func (siteRow) TableName() string { return "sites" }
func (row siteRow) domain() (publishing.Site, error) {
	var config publishing.Config
	err := json.Unmarshal(row.Configuration, &config)
	return publishing.Site{ID: row.ID, WorkspaceID: row.WorkspaceID, Config: config, Version: row.Version, PublishedReleaseID: row.PublishedReleaseID, PublishedSlug: row.PublishedSlug, CreatedAtMS: row.CreatedAtMS, UpdatedAtMS: row.UpdatedAtMS}, err
}

type releaseRow struct {
	ID, SiteID        string
	ReleaseNumber     int64
	Metadata          json.RawMessage `gorm:"type:jsonb"`
	SourceManifest    json.RawMessage `gorm:"type:jsonb"`
	SourceFingerprint string
	PublishedAtMS     int64
}

func (releaseRow) TableName() string { return "site_releases" }

type operationRow struct {
	SiteID, OperationID, ActorID, RequestHash string
	Result                                    json.RawMessage `gorm:"type:jsonb"`
	CreatedAtMS                               int64
}

func (operationRow) TableName() string { return "site_operations" }
func siteMissing(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return publishing.MissingSite()
	}
	return err
}
func slugError(err error) error {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23505" && (pg.ConstraintName == "site_slug_reservations_pkey" || pg.ConstraintName == "sites_active_slug") {
		return fault.New(fault.Conflict, "SITE_SLUG_CONFLICT", "站点路径已被其他站点保留")
	}
	return err
}
func checkVersion(row siteRow, expected int64) error {
	if row.Version != expected {
		return &fault.Error{Kind: fault.Conflict, Code: "SITE_VERSION_CONFLICT", Message: "站点已变化，请刷新后重试", Details: map[string]int64{"expected_version": expected, "current_version": row.Version}}
	}
	if row.Version >= publishing.MaxVersion {
		return fault.New(fault.Conflict, "SITE_VERSION_EXHAUSTED", "站点版本号已达到上限")
	}
	return nil
}
func siteFor(ctx context.Context, tx *gorm.DB, scope publishing.Scope, lock bool) (siteRow, error) {
	var row siteRow
	q := tx.WithContext(ctx).Where("workspace_id=? AND id=?", scope.WorkspaceID, scope.SiteID)
	if lock {
		q = q.Clauses(clause.Locking{Strength: "NO KEY UPDATE"})
	}
	err := q.Take(&row).Error
	return row, siteMissing(err)
}
func readAccess(ctx context.Context, tx *gorm.DB, scope publishing.Scope) error {
	role, err := wsstore.New(tx).Role(ctx, scope.WorkspaceID, scope.ActorID)
	if err != nil {
		return err
	}
	if !workspace.Allowed(role, workspace.Read) {
		return fault.Denied()
	}
	return nil
}
func reserveSlug(tx *gorm.DB, siteID, slug string) error {
	var current struct{ SiteID string }
	if err := tx.Raw("INSERT INTO site_slug_reservations(slug,site_id) VALUES(?,?) ON CONFLICT(slug) DO UPDATE SET slug=EXCLUDED.slug RETURNING site_id", slug, siteID).Scan(&current).Error; err != nil {
		return slugError(err)
	}
	if current.SiteID != siteID {
		return fault.New(fault.Conflict, "SITE_SLUG_CONFLICT", "站点路径已被其他站点保留")
	}
	return nil
}
func releaseSlugs(tx *gorm.DB, row siteRow) error {
	q := tx.Table("site_slug_reservations").Where("site_id=? AND slug<>?", row.ID, row.Slug)
	if row.PublishedSlug != nil {
		q = q.Where("slug<>?", *row.PublishedSlug)
	}
	return q.Delete(nil).Error
}
func (r *Repository) Create(ctx context.Context, scope publishing.Scope, config publishing.Config, timestamp int64) (publishing.Site, error) {
	encoded, err := json.Marshal(config)
	if err != nil {
		return publishing.Site{}, err
	}
	row := siteRow{ID: uuid.NewString(), WorkspaceID: scope.WorkspaceID, Name: config.Name, Slug: config.Slug, Configuration: encoded, PageRegistry: json.RawMessage(`{}`), Version: 1, CreatedAtMS: timestamp, UpdatedAtMS: timestamp}
	err = r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := wsstore.RequireLocked(ctx, tx, scope.WorkspaceID, scope.ActorID, workspace.Edit); err != nil {
			return err
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		if err := reserveSlug(tx, row.ID, row.Slug); err != nil {
			return err
		}
		_, err := resolve(ctx, tx, row, config, true)
		return err
	})
	if err != nil {
		return publishing.Site{}, err
	}
	return row.domain()
}
func (r *Repository) Get(ctx context.Context, scope publishing.Scope) (publishing.Site, error) {
	var row siteRow
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := readAccess(ctx, tx, scope); err != nil {
			return err
		}
		var err error
		row, err = siteFor(ctx, tx, scope, false)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return publishing.Site{}, err
	}
	return row.domain()
}
func (r *Repository) List(ctx context.Context, scope publishing.Scope, page pagination.Page) ([]publishing.Site, int64, error) {
	result := []publishing.Site{}
	var total int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := readAccess(ctx, tx, scope); err != nil {
			return err
		}
		q := tx.Model(&siteRow{}).Where("workspace_id=?", scope.WorkspaceID)
		if err := q.Count(&total).Error; err != nil {
			return err
		}
		var rows []siteRow
		if err := q.Order("updated_at_ms DESC,id").Offset(page.Offset()).Limit(page.Size).Find(&rows).Error; err != nil {
			return err
		}
		for _, row := range rows {
			site, err := row.domain()
			if err != nil {
				return err
			}
			result = append(result, site)
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, total, err
}
func (r *Repository) Update(ctx context.Context, scope publishing.Scope, config publishing.Config, expected, timestamp int64) (publishing.Site, error) {
	var row siteRow
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := wsstore.RequireLocked(ctx, tx, scope.WorkspaceID, scope.ActorID, workspace.Edit); err != nil {
			return err
		}
		var err error
		row, err = siteFor(ctx, tx, scope, true)
		if err != nil {
			return err
		}
		if err := checkVersion(row, expected); err != nil {
			return err
		}
		resolved, err := resolve(ctx, tx, row, config, true)
		if err != nil {
			return err
		}
		encoded, err := json.Marshal(config)
		if err != nil {
			return err
		}
		registry, err := json.Marshal(resolved.registry)
		if err != nil {
			return err
		}
		if err := reserveSlug(tx, row.ID, config.Slug); err != nil {
			return err
		}
		row.Name, row.Slug, row.Configuration, row.PageRegistry, row.Version, row.UpdatedAtMS = config.Name, config.Slug, encoded, registry, row.Version+1, timestamp
		if err := tx.Model(&siteRow{}).Where("id=?", row.ID).Updates(map[string]any{"name": row.Name, "slug": row.Slug, "configuration": row.Configuration, "page_registry": row.PageRegistry, "version": row.Version, "updated_at_ms": timestamp}).Error; err != nil {
			return err
		}
		return releaseSlugs(tx, row)
	})
	if err != nil {
		return publishing.Site{}, err
	}
	return row.domain()
}
