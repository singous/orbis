CREATE TABLE workspace_invitations (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    email TEXT NOT NULL CHECK (email = lower(email)),
    role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
    invited_by_user_id UUID NOT NULL REFERENCES users(id),
    accepted_by_user_id UUID REFERENCES users(id),
    ttl_seconds BIGINT NOT NULL CHECK (ttl_seconds BETWEEN 60 AND 604800),
    expires_at_ms BIGINT NOT NULL,
    email_sent BOOLEAN NOT NULL DEFAULT FALSE,
    email_error_summary TEXT,
    accepted_at_ms BIGINT,
    revoked_at_ms BIGINT,
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    CHECK (expires_at_ms > created_at_ms)
);
CREATE UNIQUE INDEX invitation_pending_email ON workspace_invitations(workspace_id, email) WHERE status = 'pending';
CREATE INDEX invitations_workspace_created ON workspace_invitations(workspace_id, created_at_ms DESC, id DESC);

CREATE TABLE ownership_transfers (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id),
    from_user_id UUID NOT NULL REFERENCES users(id),
    target_user_id UUID NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired', 'failed')),
    expires_at_ms BIGINT NOT NULL,
    email_sent BOOLEAN NOT NULL DEFAULT FALSE,
    email_error_summary TEXT,
    confirmed_at_ms BIGINT,
    cancelled_at_ms BIGINT,
    created_at_ms BIGINT NOT NULL,
    updated_at_ms BIGINT NOT NULL,
    CHECK (from_user_id <> target_user_id),
    CHECK (expires_at_ms > created_at_ms)
);
CREATE UNIQUE INDEX ownership_one_pending ON ownership_transfers(workspace_id) WHERE status = 'pending';
CREATE INDEX ownership_workspace_created ON ownership_transfers(workspace_id, created_at_ms DESC, id DESC);
