package postgres

import (
	"context"
	"database/sql"

	"gorm.io/gorm"

	"orbis.local/orbis/internal/document"
	docstore "orbis.local/orbis/internal/document/postgres"
	"orbis.local/orbis/internal/platform/fault"
	"orbis.local/orbis/internal/table"
	tablestore "orbis.local/orbis/internal/table/postgres"
	"orbis.local/orbis/internal/workspace"
	wsstore "orbis.local/orbis/internal/workspace/postgres"
)

type Tables struct {
	db            *gorm.DB
	collaboration document.CollaborationEngine
}

func NewTables(db *gorm.DB) *Tables { return &Tables{db: db} }
func NewTablesWithCollaboration(db *gorm.DB, engine document.CollaborationEngine) *Tables {
	return &Tables{db: db, collaboration: engine}
}
func documentScope(scope table.Scope) document.DirectoryScope {
	return document.DirectoryScope{ActorID: scope.ActorID, WorkspaceID: scope.WorkspaceID, DocumentID: scope.DocumentID}
}
func tableReference(ctx context.Context, tx *gorm.DB, scope table.Scope, header tablestore.Header, version int64) (table.Metadata, error) {
	payload, err := docstore.BlockAt(ctx, tx, documentScope(scope), version, header.BlockID)
	if err != nil {
		return table.Metadata{}, err
	}
	reference, ok := document.TableReference(header.BlockID, payload)
	if !ok || reference.TableID != header.ID {
		return table.Metadata{}, fault.Missing()
	}
	return tablestore.Metadata(ctx, tx, header, reference.Version, version)
}
func tableMetadata(ctx context.Context, tx *gorm.DB, query table.Query) (table.Metadata, error) {
	role, err := wsstore.New(tx).Role(ctx, query.Scope.WorkspaceID, query.Scope.ActorID)
	if err != nil {
		return table.Metadata{}, err
	}
	if !workspace.Allowed(role, workspace.Read) {
		return table.Metadata{}, fault.Denied()
	}
	doc, err := docstore.New(tx).Get(ctx, query.Scope.WorkspaceID, query.Scope.DocumentID)
	if err != nil {
		return table.Metadata{}, err
	}
	version := query.DocumentVersion
	if version == 0 {
		version = doc.ContentVersion
	}
	if version > doc.ContentVersion {
		return table.Metadata{}, fault.Missing()
	}
	header, err := tablestore.LoadHeader(ctx, tx, query.Scope, false)
	if err != nil {
		return table.Metadata{}, err
	}
	return tableReference(ctx, tx, query.Scope, header, version)
}
func (r *Tables) Metadata(ctx context.Context, query table.Query) (table.Metadata, error) {
	var result table.Metadata
	err := r.db.WithContext(ctx).Transaction(
		func(tx *gorm.DB) error { var err error; result, err = tableMetadata(ctx, tx, query); return err },
		&sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true},
	)
	return result, err
}
func (r *Tables) Records(ctx context.Context, query table.Query) (table.Page, error) {
	var result table.Page
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		metadata, err := tableMetadata(ctx, tx, query)
		if err != nil {
			return err
		}
		result, err = tablestore.Records(ctx, tx, metadata, query)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func (r *Tables) Export(ctx context.Context, query table.Query) (table.Projection, error) {
	var result table.Projection
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		metadata, err := tableMetadata(ctx, tx, query)
		if err != nil {
			return err
		}
		result, err = tablestore.Export(ctx, tx, metadata, query)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
func tableReplay(ctx context.Context, tx *gorm.DB, scope table.Scope, operation, hash string) (table.Result, bool, error) {
	_, replayed, err := docstore.CheckOperation(
		ctx,
		tx,
		scope.DocumentID,
		scope.ActorID,
		operation,
		hash,
	)
	if err != nil || !replayed {
		return table.Result{}, false, err
	}
	result, err := tablestore.Replay(ctx, tx, scope.DocumentID, operation)
	return result, true, err
}
func (r *Tables) commitTable(ctx context.Context, tx *gorm.DB, header tablestore.Header, version int64, commit docstore.BlockCommit, inverse *table.Changes) (table.Result, error) {
	commit.BlockID = header.BlockID
	commit.Payload = document.Payload{Type: "data_table", Props: map[string]any{"table_id": header.ID, "table_version": version}, Content: []document.TextRun{}}
	contentVersion, err := docstore.CommitBlock(ctx, tx, commit, r.collaboration)
	if err != nil {
		return table.Result{}, err
	}
	result := table.Result{TableID: header.ID, BlockID: header.BlockID, TableVersion: version, ContentVersion: contentVersion, Inverse: inverse}
	return result, tablestore.Receipt(
		ctx,
		tx,
		commit.Document.ID,
		commit.OperationID,
		result,
		commit.Timestamp,
	)
}

func (r *Tables) Create(ctx context.Context, command table.CreateCommand) (table.Result, error) {
	var result table.Result
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		doc, err := docstore.LockContent(ctx, tx, documentScope(command.Scope))
		if err != nil {
			return err
		}
		if previous, exists, err := tableReplay(ctx, tx, command.Scope, command.Input.OperationID, command.Hash); err != nil {
			return err
		} else if exists {
			result = previous
			return nil
		}
		if err := docstore.CheckVersion(doc.ContentVersion, command.Input.ExpectedDocumentVersion); err != nil {
			return err
		}
		block, err := docstore.BlockAt(ctx, tx, documentScope(command.Scope), doc.ContentVersion, command.Input.BlockID)
		if err != nil {
			return err
		}
		if block.Type != "data_table" {
			return fault.Field("body.block_id", "目标块不是数据表")
		}
		if block.Props["table_id"] != nil {
			return fault.New(fault.Conflict, "TABLE_ALREADY_INITIALIZED", "表格已初始化")
		}
		definition := table.DefaultDefinition()
		records := []table.Record{}
		if command.Input.Definition != nil {
			definition = *command.Input.Definition
		}
		if source := command.Input.Source; source != nil {
			query := table.Query{Scope: table.Scope{ActorID: command.Scope.ActorID, WorkspaceID: source.WorkspaceID, DocumentID: source.DocumentID, TableID: source.TableID}}
			if source.DocumentVersion != nil {
				query.DocumentVersion = *source.DocumentVersion
			}
			// Source reads pin an immutable version without locking a second document, preventing opposite-copy deadlocks.
			metadata, err := tableMetadata(ctx, tx, query)
			if err != nil {
				return err
			}
			sourceRows, err := tablestore.CopyRecords(ctx, tx, metadata)
			if err != nil {
				return err
			}
			definition, records, err = table.Copy(metadata.Definition, sourceRows)
			if err != nil {
				return err
			}
		}
		header, err := tablestore.Create(
			ctx,
			tx,
			command.Scope,
			command.Input.BlockID,
			definition,
			records,
			command.Timestamp,
		)
		if err != nil {
			return err
		}
		result, err = r.commitTable(
			ctx,
			tx,
			header,
			1,
			docstore.BlockCommit{
				Document:    doc,
				ActorID:     command.Scope.ActorID,
				OperationID: command.Input.OperationID,
				Hash:        command.Hash,
				Timestamp:   command.Timestamp,
			},
			nil,
		)
		return err
	})
	return result, err
}
func (r *Tables) Mutate(ctx context.Context, command table.MutationCommand) (table.Result, error) {
	var result table.Result
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		doc, err := docstore.LockContent(ctx, tx, documentScope(command.Scope))
		if err != nil {
			return err
		}
		if previous, exists, err := tableReplay(ctx, tx, command.Scope, command.Input.OperationID, command.Hash); err != nil {
			return err
		} else if exists {
			result = previous
			return nil
		}
		if err := docstore.CheckVersion(doc.ContentVersion, command.Input.ExpectedDocumentVersion); err != nil {
			return err
		}
		header, err := tablestore.LoadHeader(ctx, tx, command.Scope, true)
		if err != nil {
			return err
		}
		metadata, err := tableReference(ctx, tx, command.Scope, header, doc.ContentVersion)
		if err != nil {
			return err
		}
		if metadata.TableVersion != command.Input.ExpectedTableVersion {
			return &fault.Error{
				Kind:    fault.Conflict,
				Code:    "TABLE_VERSION_CONFLICT",
				Message: "表格版本已变化，请刷新后重试",
				Details: map[string]int64{"expected_version": command.Input.ExpectedTableVersion, "current_version": metadata.TableVersion},
			}
		}
		version, inverse, err := tablestore.Mutate(
			ctx,
			tx,
			header,
			metadata,
			command.Input.Changes,
			command.Timestamp,
		)
		if err != nil {
			return err
		}
		var undo *table.Changes
		if inverse.Definition != nil || len(inverse.Upserts)+len(inverse.Deletes)+len(inverse.Restores) > 0 {
			undo = &inverse
		}
		result, err = r.commitTable(
			ctx,
			tx,
			header,
			version,
			docstore.BlockCommit{
				Document:    doc,
				ActorID:     command.Scope.ActorID,
				OperationID: command.Input.OperationID,
				Hash:        command.Hash,
				Timestamp:   command.Timestamp,
			},
			undo,
		)
		return err
	})
	return result, err
}

func (r *Tables) PublicRecords(ctx context.Context, query table.Query) (table.PublicPage, error) {
	var result table.PublicPage
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		metadata, err := tableMetadata(ctx, tx, query)
		if err != nil {
			return err
		}
		result, err = tablestore.PublicRecords(ctx, tx, metadata, query)
		return err
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return result, err
}
