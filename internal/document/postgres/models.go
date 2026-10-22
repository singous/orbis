package postgres

import (
	"encoding/json"

	"orbis.local/orbis/internal/document"
)

type collectionRow struct {
	IsArchived             bool
	Icon                   *document.CollectionIcon `gorm:"serializer:json;type:jsonb"`
	ID, WorkspaceID, Title string
	GroupID                string
	SortOrder              int
	MetadataVersion        int64  `gorm:"default:1"`
	CreatedAtMS            int64  `gorm:"column:created_at_ms"`
	UpdatedAtMS            int64  `gorm:"column:updated_at_ms"`
	DirectoryVersion       int64  `gorm:"default:1"`
	ArchivedAtMS           *int64 `gorm:"column:archived_at_ms"`
}

// TableName keeps persisted table names independent of Go type names.
func (collectionRow) TableName() string { return "collections" }
func (r collectionRow) domain() document.Collection {
	return document.Collection{Icon: r.Icon,
		ID:          r.ID,
		WorkspaceID: r.WorkspaceID,
		Title:       r.Title,
		GroupID:     r.GroupID, SortOrder: r.SortOrder, MetadataVersion: r.MetadataVersion,
		CreatedAtMS:      r.CreatedAtMS,
		UpdatedAtMS:      r.UpdatedAtMS,
		DirectoryVersion: r.DirectoryVersion,
		ArchivedAtMS:     r.ArchivedAtMS, IsArchived: r.IsArchived,
	}
}

type documentRow struct {
	SheetID                              *string
	IsArchived                           bool
	ID, WorkspaceID, CollectionID, Title string
	ContentVersion                       int64
	ArchivedAtMS                         *int64 `gorm:"column:archived_at_ms"`
	CreatedAtMS                          int64  `gorm:"column:created_at_ms"`
	UpdatedAtMS                          int64  `gorm:"column:updated_at_ms"`
	ParentID                             *string
	Position                             int
}

// TableName keeps persisted table names independent of Go type names.
func (documentRow) TableName() string { return "documents" }
func (r documentRow) domain() document.Document {
	return document.Document{
		SheetID:        r.SheetID,
		ID:             r.ID,
		WorkspaceID:    r.WorkspaceID,
		CollectionID:   r.CollectionID,
		Title:          r.Title,
		ContentVersion: r.ContentVersion,
		ArchivedAtMS:   r.ArchivedAtMS, IsArchived: r.IsArchived,
		CreatedAtMS: r.CreatedAtMS,
		UpdatedAtMS: r.UpdatedAtMS,
		ParentID:    r.ParentID,
		Position:    r.Position,
	}
}

type revisionRow struct {
	DocumentID, Title, AuthorName string
	AuthorID                      *string
	TitleRecorded                 bool `gorm:"default:true"`
	Version                       int64
	RestoredFromVersion           *int64
	CreatedAtMS                   int64 `gorm:"column:created_at_ms"`
}

// TableName keeps persisted table names independent of Go type names.
func (revisionRow) TableName() string { return "document_revisions" }
func (r revisionRow) domain() document.Revision {
	return document.Revision{
		DocumentID:          r.DocumentID,
		Title:               r.Title,
		AuthorID:            r.AuthorID,
		AuthorName:          r.AuthorName,
		TitleRecorded:       r.TitleRecorded,
		Version:             r.Version,
		RestoredFromVersion: r.RestoredFromVersion,
		CreatedAtMS:         r.CreatedAtMS,
	}
}

type blockRow struct {
	PayloadBytes        *int
	PayloadDigest       *string
	DocumentID, BlockID string
	ParentID            *string
	Position            int
	Payload             json.RawMessage `gorm:"type:jsonb"`
	ValidFrom           int64
	ValidTo             *int64
}

// TableName keeps persisted table names independent of Go type names.
func (blockRow) TableName() string { return "document_block_versions" }
func (r blockRow) domain() document.BlockRecord {
	return document.BlockRecord{PayloadByteCount: r.PayloadBytes, Revision: r.ValidFrom, ID: r.BlockID, ParentID: r.ParentID, Position: r.Position, Payload: r.Payload}
}

type operationRow struct {
	Result                               json.RawMessage `gorm:"type:jsonb"`
	DocumentID, OperationID, RequestHash string
	ActorID                              *string
	ResultVersion                        int64
	CreatedAtMS                          int64 `gorm:"column:created_at_ms"`
}

// TableName keeps persisted table names independent of Go type names.
func (operationRow) TableName() string { return "document_operations" }
