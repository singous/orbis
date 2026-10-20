-- Removes icon choices and normalized-icon markers; uploaded file objects remain available.
DROP TABLE collection_icon_assets;
ALTER TABLE collections DROP COLUMN icon;
