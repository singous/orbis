-- Removes sites, releases and their public grants; private documents and files remain.
DROP TABLE site_operations;
DROP TABLE site_release_assets;
DROP TABLE site_release_tables;
DROP TABLE published_table_records;
DROP TABLE published_table_snapshots;
DROP TABLE site_release_pages;
DROP TABLE published_page_bodies;
ALTER TABLE sites DROP CONSTRAINT sites_active_release;
DROP TABLE site_releases;
DROP TABLE site_slug_reservations;
DROP TABLE sites;
