package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"orbis.local/orbis/internal/platform/tasks"
	"sync"

	appstore "orbis.local/orbis/internal/app/postgres"
	"orbis.local/orbis/internal/asset"
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/document/crdtengine"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/identity"
	idstore "orbis.local/orbis/internal/identity/postgres"
	"orbis.local/orbis/internal/integration"
	itstore "orbis.local/orbis/internal/integration/postgres"
	"orbis.local/orbis/internal/platform/clock"
	"orbis.local/orbis/internal/platform/config"
	"orbis.local/orbis/internal/platform/database"
	mailadapter "orbis.local/orbis/internal/platform/mail"
	"orbis.local/orbis/internal/platform/security"
	"orbis.local/orbis/internal/platform/storage"
	"orbis.local/orbis/internal/platform/thumbnail"
	"orbis.local/orbis/internal/publishing"
	pubstore "orbis.local/orbis/internal/publishing/postgres"
	"orbis.local/orbis/internal/search"
	searchstore "orbis.local/orbis/internal/search/postgres"
	"orbis.local/orbis/internal/sharing"
	sharestore "orbis.local/orbis/internal/sharing/postgres"
	"orbis.local/orbis/internal/sheet"
	sheetstore "orbis.local/orbis/internal/sheet/postgres"
	"orbis.local/orbis/internal/table"
	httpapi "orbis.local/orbis/internal/transport/http"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

type Application struct {
	collaborationSockets *httpapi.CollaborationSockets
	collaborationEngine  *crdtengine.Client
	closeOnce            sync.Once
	closeErr             error
	Handler              http.Handler
	pool                 *sql.DB
	objects              *storage.Local
	assets               *asset.Service
	imports              *tasks.Imports
	importStore          *appstore.Imports
}

// New checks the schema and owns all resources used by the returned HTTP handler.
func New(ctx context.Context, cfg config.Config, logger *slog.Logger) (*Application, error) {
	return NewWithClock(ctx, cfg, logger, clock.System{})
}

// NewWithClock makes expiry workflows testable without changing the system clock.
func NewWithClock(ctx context.Context, cfg config.Config, logger *slog.Logger, wallClock clock.Clock) (*Application, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	pool, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("obtain PostgreSQL pool: %w", err)
	}
	cleanup := func(err error) (*Application, error) {
		return nil, errors.Join(err, pool.Close())
	}
	if err := database.CheckSchema(ctx, db); err != nil {
		return cleanup(err)
	}
	objects, err := storage.NewLocal(cfg.StorageDirectory)
	if err != nil {
		return cleanup(err)
	}
	cleanup = func(err error) (*Application, error) { return nil, errors.Join(err, objects.Close(), pool.Close()) }
	passwords := security.NewPasswords()
	dummyPassword, err := security.RandomToken()
	if err != nil {
		return cleanup(err)
	}
	dummyHash, err := passwords.Hash(ctx, dummyPassword)
	if err != nil {
		return cleanup(err)
	}
	accounts := identity.New(
		idstore.New(db),
		passwords,
		wallClock,
		cfg.SigningKey,
		cfg.AccessTTL,
		cfg.RefreshTTL,
		dummyHash,
		cfg.LegacyRefreshSecret,
	)
	workspaces := workspace.New(appstore.NewWorkspaces(db), wallClock)
	mailer, err := mailadapter.New(cfg.Mail)
	if err != nil {
		return cleanup(err)
	}
	publicBaseURL := cfg.Mail.PublicBaseURL
	if publicBaseURL == "" {
		publicBaseURL = publishing.DefaultPublicBaseURL
	}
	actions := workspace.NewActions(wsstore.NewActions(db, wallClock), workspaces, workspace.ActionOptions{
		Accounts: accounts, Mailer: mailer, Clock: wallClock, PublicBaseURL: publicBaseURL, Logger: logger, LegacyTokenSecret: cfg.LegacyActionSecret,
	})
	var collaborationEngine *crdtengine.Client
	var engine document.CollaborationEngine
	if cfg.CollaborationURL != "" {
		collaborationEngine, err = crdtengine.New(cfg.CollaborationURL, cfg.CollaborationKey)
		if err != nil {
			return cleanup(err)
		}
		engine = collaborationEngine
	}
	documents := document.New(
		docstore.NewWithCollaboration(db, engine),
		workspaces,
		wallClock,
		security.NewCursorSigner(cfg.SigningKey),
	)
	assets := asset.New(appstore.NewAssets(db, wallClock), workspaces, objects, thumbnail.Normalizer{}, wallClock, cfg.MaxUploadBytes)
	publishingRepo, err := pubstore.New(db, publicBaseURL)
	if err != nil {
		return cleanup(err)
	}
	shares := sharing.New(sharestore.New(db, wallClock, publicBaseURL), workspaces, wallClock, cfg.SigningKey, cfg.LegacyActionSecret)
	libraryRepo := appstore.NewLibraryWithCollaboration(db, wallClock, cfg.SigningKey, engine)
	importsRepo := appstore.NewImports(db, libraryRepo, objects, wallClock)
	var importWorkers *tasks.Imports
	if cfg.RedisURL != "" {
		source, _ := url.Parse(cfg.DatabaseURL)
		namespace := security.Digest(source.Host + source.Path)[:16]
		importWorkers, err = tasks.StartImports(ctx, cfg.RedisURL, namespace, importsRepo, logger)
		if err != nil {
			return cleanup(err)
		}
		cleanup = func(err error) (*Application, error) {
			return nil, errors.Join(err, importWorkers.Close(), objects.Close(), pool.Close())
		}
	}
	collaborationSockets := httpapi.NewCollaborationSockets()
	router, err := httpapi.New(httpapi.Dependencies{
		CollaborationSockets: collaborationSockets,
		Identity:             accounts, Workspaces: workspaces, Documents: documents,
		Imports:           integration.NewImports(importsRepo, wallClock, importWorkers != nil),
		IntegrationTokens: integration.NewTokens(itstore.New(db, wallClock), workspaces, wallClock),
		Library:           integration.NewLibrary(libraryRepo, wallClock, objects, cfg.MaxUploadBytes, shares),
		Preferences:       identity.NewPreferences(appstore.NewPreferences(db), wallClock),
		Publishing:        publishing.New(publishingRepo, workspaces, wallClock),
		Sharing:           shares,
		PublicBaseURL:     publicBaseURL,
		Search:            search.New(searchstore.New(db), workspaces),
		Transfers:         integration.NewTransfers(appstore.NewTransfers(db), workspaces, wallClock),
		Sheets:            sheet.New(sheetstore.New(db, cfg.SigningKey), workspaces, wallClock),
		Tables:            table.New(appstore.NewTablesWithCollaboration(db, engine), workspaces, wallClock),
		Actions:           actions,
		Assets:            assets, MaxUploadBytes: cfg.MaxUploadBytes,
		Catalog:  document.NewCatalog(docstore.New(db), workspaces, wallClock),
		Comments: document.NewComments(docstore.New(db), workspaces, wallClock),
		Setup:    NewSetup(appstore.NewSetup(db), accounts), Ready: pool.PingContext,
		Logger: logger, MaxBodyBytes: cfg.MaxBodyBytes, RequestTimeout: cfg.WriteTimeout,
	})
	if err != nil {
		collaborationSockets.Close()
		if collaborationEngine != nil {
			collaborationEngine.Close()
		}
		return cleanup(err)
	}
	return &Application{Handler: router, pool: pool, objects: objects, assets: assets, imports: importWorkers, importStore: importsRepo, collaborationEngine: collaborationEngine, collaborationSockets: collaborationSockets}, nil
}

// Close releases the database pool after request processing has stopped.
func (a *Application) Close() error {
	a.closeOnce.Do(func() {
		if a.collaborationSockets != nil {
			a.collaborationSockets.Close()
		}
		if a.collaborationEngine != nil {
			a.collaborationEngine.Close()
		}
		a.closeErr = errors.Join(a.imports.Close(), a.objects.Close(), a.pool.Close())
	})
	return a.closeErr
}

// CleanupAssets performs one bounded maintenance batch without starting a background worker.
func (a *Application) CleanupAssets(ctx context.Context) (int, error) { return a.assets.Cleanup(ctx) }

// CleanupImports removes only expired staged sources in one bounded maintenance batch.
func (a *Application) CleanupImports(ctx context.Context) (int, error) {
	return a.importStore.Cleanup(ctx)
}
