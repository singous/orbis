CREATE TABLE published_asset_copies (
    id UUID PRIMARY KEY,
    sha256 TEXT NOT NULL CHECK(length(sha256)=64),
    storage_key TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    media_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL CHECK(size_bytes BETWEEN 0 AND 9007199254740991),
    created_at_ms BIGINT NOT NULL
);
CREATE TABLE site_release_asset_copies (
    release_id UUID NOT NULL REFERENCES site_releases(id),
    asset_id UUID NOT NULL REFERENCES published_asset_copies(id),
    PRIMARY KEY(release_id,asset_id)
);
