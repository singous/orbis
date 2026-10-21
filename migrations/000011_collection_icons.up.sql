ALTER TABLE collections ADD COLUMN icon JSONB CHECK(icon IS NULL OR jsonb_typeof(icon)='object');
CREATE TABLE collection_icon_assets (
    asset_id UUID PRIMARY KEY REFERENCES assets(id),
    workspace_id UUID NOT NULL REFERENCES workspaces(id)
);
CREATE INDEX collection_icon_assets_scope ON collection_icon_assets(workspace_id,asset_id);
