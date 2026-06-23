"""create user api core tables

Revision ID: 202606230001
Revises:
Create Date: 2026-06-23
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "202606230001"
down_revision = None
branch_labels = None
depends_on = None

uuid_type = sa.Uuid()
json_type = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at_ms", sa.BigInteger(), nullable=False),
        sa.Column("updated_at_ms", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=False)

    op.create_table(
        "refresh_sessions",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("user_id", uuid_type, nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at_ms", sa.BigInteger(), nullable=False),
        sa.Column("revoked_at_ms", sa.BigInteger(), nullable=True),
        sa.Column("created_at_ms", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(op.f("ix_refresh_sessions_user_id"), "refresh_sessions", ["user_id"], unique=False)

    op.create_table(
        "workspaces",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("owner_id", uuid_type, nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("created_at_ms", sa.BigInteger(), nullable=False),
        sa.Column("updated_at_ms", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_workspaces_owner_id"), "workspaces", ["owner_id"], unique=False)

    op.create_table(
        "workspace_members",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("workspace_id", uuid_type, nullable=False),
        sa.Column("user_id", uuid_type, nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("created_at_ms", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "user_id", name="uq_workspace_members_workspace_user"),
    )
    op.create_index(op.f("ix_workspace_members_user_id"), "workspace_members", ["user_id"], unique=False)
    op.create_index(op.f("ix_workspace_members_workspace_id"), "workspace_members", ["workspace_id"], unique=False)

    op.create_table(
        "notes",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("workspace_id", uuid_type, nullable=False),
        sa.Column("owner_id", uuid_type, nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("note_type", sa.String(length=32), nullable=False),
        sa.Column("blocks", json_type, nullable=False),
        sa.Column("plain_text", sa.Text(), nullable=False),
        sa.Column("content_version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at_ms", sa.BigInteger(), nullable=False),
        sa.Column("updated_at_ms", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_notes_owner_id"), "notes", ["owner_id"], unique=False)
    op.create_index("ix_notes_owner_updated", "notes", ["owner_id", "updated_at_ms"], unique=False)
    op.create_index(op.f("ix_notes_workspace_id"), "notes", ["workspace_id"], unique=False)
    op.create_index("ix_notes_workspace_updated", "notes", ["workspace_id", "updated_at_ms"], unique=False)

    op.create_table(
        "note_revisions",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("note_id", uuid_type, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("blocks", json_type, nullable=False),
        sa.Column("plain_text", sa.Text(), nullable=False),
        sa.Column("created_by", uuid_type, nullable=False),
        sa.Column("created_at_ms", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["note_id"], ["notes.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("note_id", "version", name="uq_note_revisions_note_version"),
    )
    op.create_index(op.f("ix_note_revisions_note_id"), "note_revisions", ["note_id"], unique=False)

    op.create_table(
        "files",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("workspace_id", uuid_type, nullable=False),
        sa.Column("owner_id", uuid_type, nullable=False),
        sa.Column("storage_key", sa.String(length=1024), nullable=False),
        sa.Column("original_filename", sa.String(length=512), nullable=False),
        sa.Column("mime_type", sa.String(length=255), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("upload_status", sa.String(length=32), nullable=False),
        sa.Column("created_at_ms", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_index(op.f("ix_files_owner_id"), "files", ["owner_id"], unique=False)
    op.create_index("ix_files_owner_created", "files", ["owner_id", "created_at_ms"], unique=False)
    op.create_index(op.f("ix_files_sha256"), "files", ["sha256"], unique=False)
    op.create_index(op.f("ix_files_workspace_id"), "files", ["workspace_id"], unique=False)
    op.create_index("ix_files_workspace_created", "files", ["workspace_id", "created_at_ms"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_files_workspace_created", table_name="files")
    op.drop_index(op.f("ix_files_workspace_id"), table_name="files")
    op.drop_index(op.f("ix_files_sha256"), table_name="files")
    op.drop_index("ix_files_owner_created", table_name="files")
    op.drop_index(op.f("ix_files_owner_id"), table_name="files")
    op.drop_table("files")

    op.drop_index(op.f("ix_note_revisions_note_id"), table_name="note_revisions")
    op.drop_table("note_revisions")

    op.drop_index("ix_notes_workspace_updated", table_name="notes")
    op.drop_index(op.f("ix_notes_workspace_id"), table_name="notes")
    op.drop_index("ix_notes_owner_updated", table_name="notes")
    op.drop_index(op.f("ix_notes_owner_id"), table_name="notes")
    op.drop_table("notes")

    op.drop_index(op.f("ix_workspace_members_workspace_id"), table_name="workspace_members")
    op.drop_index(op.f("ix_workspace_members_user_id"), table_name="workspace_members")
    op.drop_table("workspace_members")

    op.drop_index(op.f("ix_workspaces_owner_id"), table_name="workspaces")
    op.drop_table("workspaces")

    op.drop_index(op.f("ix_refresh_sessions_user_id"), table_name="refresh_sessions")
    op.drop_table("refresh_sessions")

    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
