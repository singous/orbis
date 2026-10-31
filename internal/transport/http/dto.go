package httpapi

import (
	"orbis.local/orbis/internal/document"
	"orbis.local/orbis/internal/identity"
	"orbis.local/orbis/internal/workspace"
)

type userDTO struct {
	PreferredWorkspaceID *string `json:"preferred_workspace_id"`
	AvatarAssetID        *string `json:"avatar_asset_id"`
	ID                   string  `json:"id"`
	Email                string  `json:"email"`
	DisplayName          *string `json:"display_name"`
	Bio                  *string `json:"bio"`
	ProfileVersion       int64   `json:"profile_version"`
	CreatedAtMS          int64   `json:"created_at_ms"`
	UpdatedAtMS          int64   `json:"updated_at_ms"`
}

func userResponse(user identity.User) userDTO {
	return userDTO{PreferredWorkspaceID: user.PreferredWorkspaceID,
		ID: user.ID, Email: user.Email, AvatarAssetID: user.AvatarAssetID, DisplayName: user.DisplayName, Bio: user.Bio, ProfileVersion: user.ProfileVersion,
		CreatedAtMS: user.CreatedAtMS, UpdatedAtMS: user.UpdatedAtMS,
	}
}

type tokensDTO struct {
	AccessToken  string  `json:"access_token"`
	RefreshToken string  `json:"refresh_token"`
	TokenType    string  `json:"token_type"`
	ExpiresAtMS  int64   `json:"expires_at_ms"`
	User         userDTO `json:"user"`
}

func tokensResponse(tokens identity.Tokens) tokensDTO {
	return tokensDTO{
		AccessToken: tokens.AccessToken, RefreshToken: tokens.RefreshToken, TokenType: "Bearer",
		ExpiresAtMS: tokens.ExpiresAtMS, User: userResponse(tokens.User),
	}
}

type workspaceDTO struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Role        string `json:"role"`
	CreatedAtMS int64  `json:"created_at_ms"`
	UpdatedAtMS int64  `json:"updated_at_ms"`
}

func workspaceResponse(w workspace.Workspace) workspaceDTO {
	return workspaceDTO{ID: w.ID, Name: w.Name, Role: w.Role, CreatedAtMS: w.CreatedAtMS, UpdatedAtMS: w.UpdatedAtMS}
}

type collectionDTO struct {
	IsArchived       bool                     `json:"is_archived"`
	Icon             *document.CollectionIcon `json:"icon"`
	GroupID          string                   `json:"group_id"`
	SortOrder        int                      `json:"sort_order"`
	MetadataVersion  int64                    `json:"metadata_version"`
	ID               string                   `json:"id"`
	WorkspaceID      string                   `json:"workspace_id"`
	Title            string                   `json:"title"`
	CreatedAtMS      int64                    `json:"created_at_ms"`
	UpdatedAtMS      int64                    `json:"updated_at_ms"`
	DirectoryVersion int64                    `json:"directory_version"`
	ArchivedAtMS     *int64                   `json:"archived_at_ms"`
}

func collectionResponse(c document.Collection) collectionDTO {
	return collectionDTO{Icon: c.Icon, ID: c.ID, WorkspaceID: c.WorkspaceID, Title: c.Title,
		GroupID: c.GroupID, SortOrder: c.SortOrder, MetadataVersion: c.MetadataVersion,
		CreatedAtMS: c.CreatedAtMS, UpdatedAtMS: c.UpdatedAtMS,
		DirectoryVersion: c.DirectoryVersion, ArchivedAtMS: c.ArchivedAtMS, IsArchived: c.IsArchived}
}

type documentDTO struct {
	BoardID                *string `json:"board_id"`
	SheetID                *string `json:"sheet_id"`
	CollaborationAvailable bool    `json:"collaboration_available"`
	IsArchived             bool    `json:"is_archived"`
	ID                     string  `json:"id"`
	WorkspaceID            string  `json:"workspace_id"`
	CollectionID           string  `json:"collection_id"`
	Title                  string  `json:"title"`
	ContentVersion         int64   `json:"content_version"`
	ArchivedAtMS           *int64  `json:"archived_at_ms"`
	CreatedAtMS            int64   `json:"created_at_ms"`
	UpdatedAtMS            int64   `json:"updated_at_ms"`
	ParentID               *string `json:"parent_id"`
	Position               int     `json:"position"`
}

func documentResponse(d document.Document) documentDTO {
	return documentDTO{
		BoardID: d.BoardID,
		SheetID: d.SheetID,
		ID:      d.ID, WorkspaceID: d.WorkspaceID, CollectionID: d.CollectionID, Title: d.Title,
		ContentVersion: d.ContentVersion, ArchivedAtMS: d.ArchivedAtMS, IsArchived: d.IsArchived,
		CreatedAtMS: d.CreatedAtMS, UpdatedAtMS: d.UpdatedAtMS,
		ParentID: d.ParentID, Position: d.Position,
	}
}

func (h *handler) documentResponse(d document.Document) documentDTO {
	result := documentResponse(d)
	result.CollaborationAvailable = h.deps.Documents != nil && h.deps.Documents.CollaborationAvailable()
	return result
}

type revisionDTO struct {
	TitleRecorded       bool    `json:"title_recorded"`
	DocumentID          string  `json:"document_id"`
	Title               string  `json:"title"`
	AuthorID            *string `json:"author_id"`
	AuthorName          string  `json:"author_name"`
	Version             int64   `json:"version"`
	RestoredFromVersion *int64  `json:"restored_from_version"`
	CreatedAtMS         int64   `json:"created_at_ms"`
}

func revisionResponse(r document.Revision) revisionDTO {
	return revisionDTO{
		DocumentID: r.DocumentID, Title: r.Title, AuthorID: r.AuthorID, AuthorName: r.AuthorName, Version: r.Version, TitleRecorded: r.TitleRecorded,
		RestoredFromVersion: r.RestoredFromVersion, CreatedAtMS: r.CreatedAtMS,
	}
}

type contentDTO struct {
	Revision revisionDTO      `json:"revision"`
	Blocks   []document.Block `json:"blocks"`
}

func contentResponse(c document.Content) contentDTO {
	return contentDTO{Revision: revisionResponse(c.Revision), Blocks: c.Blocks}
}
