-- Per-upload tracking: one row for every image an agent uploads, regardless of
-- how it was classified (counted, flagged, duplicate, wrong_round, etc.).
-- Used to compute Total Scans and per-station/per-pass breakdowns.
CREATE TABLE scan_uploads (
  id            SERIAL PRIMARY KEY,
  station_id    VARCHAR(64) NOT NULL DEFAULT 'unknown',
  round_id      INTEGER REFERENCES rounds(id) ON DELETE CASCADE,
  pass_id       INTEGER REFERENCES passes(id) ON DELETE SET NULL,
  serial_number VARCHAR(64),
  outcome       VARCHAR(32) NOT NULL,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scan_uploads_round ON scan_uploads(round_id);
CREATE INDEX idx_scan_uploads_pass ON scan_uploads(pass_id);
CREATE INDEX idx_scan_uploads_station ON scan_uploads(station_id);
CREATE INDEX idx_scan_uploads_round_station ON scan_uploads(round_id, station_id);
