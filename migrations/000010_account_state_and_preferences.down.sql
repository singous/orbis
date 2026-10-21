-- Removing inactivity flags can reactivate imported disabled identities; review before any downgrade.
ALTER TABLE users DROP COLUMN preferred_workspace_id;
ALTER TABLE workspaces DROP COLUMN is_active;
ALTER TABLE users DROP COLUMN is_active;
