CREATE TABLE sites (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80),
    configuration JSONB NOT NULL,
    page_registry JSONB NOT NULL DEFAULT '{}',
    version BIGINT NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 9007199254740991),
    release_sequence BIGINT NOT NULL DEFAULT 0 CHECK (release_sequence BETWEEN 0 AND 9007199254740991),
    published_release_id UUID,
    published_slug TEXT,
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    UNIQUE (workspace_id,id),
    CHECK ((published_release_id IS NULL) = (published_slug IS NULL))
);
CREATE INDEX sites_workspace_page ON sites(workspace_id,updated_at_ms DESC,id);
CREATE UNIQUE INDEX sites_active_slug ON sites(published_slug) WHERE published_slug IS NOT NULL;
CREATE TABLE site_slug_reservations (
    slug TEXT PRIMARY KEY,
    site_id UUID NOT NULL REFERENCES sites(id)
);
CREATE INDEX site_slug_owner ON site_slug_reservations(site_id);
CREATE TABLE site_releases (
    id UUID PRIMARY KEY,
    site_id UUID NOT NULL REFERENCES sites(id),
    release_number BIGINT NOT NULL CHECK (release_number BETWEEN 1 AND 9007199254740991),
    metadata JSONB NOT NULL,
    source_manifest JSONB NOT NULL,
    source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint)=64),
    published_at_ms BIGINT NOT NULL,
    UNIQUE(site_id,id),
    UNIQUE(site_id,release_number)
);
ALTER TABLE sites ADD CONSTRAINT sites_active_release FOREIGN KEY(id,published_release_id)
    REFERENCES site_releases(site_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE published_page_bodies (
    digest TEXT PRIMARY KEY CHECK (length(digest)=64),
    blocks JSONB NOT NULL,
    plain_text TEXT NOT NULL
);
CREATE TABLE site_release_pages (
    release_id UUID NOT NULL REFERENCES site_releases(id),
    slug TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0 AND position < 200),
    metadata JSONB NOT NULL,
    body_digest TEXT NOT NULL REFERENCES published_page_bodies(digest),
    PRIMARY KEY(release_id,slug),
    UNIQUE(release_id,position)
);
CREATE TABLE published_table_snapshots (
    id UUID PRIMARY KEY,
    digest TEXT NOT NULL CHECK (length(digest)=64),
    metadata JSONB NOT NULL,
    total BIGINT NOT NULL CHECK (total BETWEEN 0 AND 50000)
);
CREATE TABLE published_table_records (
    snapshot_id UUID NOT NULL REFERENCES published_table_snapshots(id),
    record_id UUID NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    values JSONB NOT NULL,
    PRIMARY KEY(snapshot_id,position),
    UNIQUE(snapshot_id,record_id)
);
CREATE TABLE site_release_tables (
    release_id UUID NOT NULL REFERENCES site_releases(id),
    snapshot_id UUID NOT NULL REFERENCES published_table_snapshots(id),
    PRIMARY KEY(release_id,snapshot_id)
);
CREATE TABLE site_release_assets (
    release_id UUID NOT NULL REFERENCES site_releases(id),
    asset_id UUID NOT NULL REFERENCES assets(id),
    sha256 TEXT NOT NULL CHECK (length(sha256)=64),
    PRIMARY KEY(release_id,asset_id)
);
CREATE TABLE site_operations (
    site_id UUID NOT NULL REFERENCES sites(id),
    operation_id UUID NOT NULL,
    actor_id UUID NOT NULL REFERENCES users(id),
    request_hash TEXT NOT NULL,
    result JSONB NOT NULL,
    created_at_ms BIGINT NOT NULL,
    PRIMARY KEY(site_id,operation_id)
);
