-- One-off: adds the Sparx Reader columns to an existing pings table.
-- npx wrangler d1 execute sparx-solver-stats --remote --file=migrations-reader.sql
ALTER TABLE pings ADD COLUMN reader_open INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pings ADD COLUMN reader_answer INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pings ADD COLUMN reader_ai INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pings ADD COLUMN reader_autofill_start INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pings ADD COLUMN reader_error INTEGER NOT NULL DEFAULT 0;
