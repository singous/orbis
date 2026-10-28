-- Existing integer positions remain readable when rolling back the ordering feature.
ALTER TABLE sheet_records ALTER COLUMN position SET GENERATED ALWAYS;
