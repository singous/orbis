CREATE TABLE legacy_conversions (
    bundle_digest TEXT PRIMARY KEY CHECK(length(bundle_digest)=64),
    transformation_version INTEGER NOT NULL CHECK(transformation_version>=1),
    report JSONB NOT NULL,
    created_at_ms BIGINT NOT NULL
);
