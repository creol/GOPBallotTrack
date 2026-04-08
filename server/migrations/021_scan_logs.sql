-- Scan log storage — agent logs sent from stations, server processing logs, and general server logs
CREATE TABLE scan_logs (
  id SERIAL PRIMARY KEY,
  election_id INTEGER REFERENCES elections(id),
  source VARCHAR(50) NOT NULL,           -- 'agent:station-1', 'server:scan', 'server:general'
  level VARCHAR(10) NOT NULL DEFAULT 'info' CHECK (level IN ('debug', 'info', 'success', 'warn', 'error')),
  message TEXT NOT NULL,
  serial_number VARCHAR(64),             -- links agent + server logs for same ballot
  round_id INTEGER REFERENCES rounds(id),
  station_id VARCHAR(100),
  metadata JSONB,                        -- timing, file names, confidence scores, etc.
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scan_logs_election ON scan_logs(election_id);
CREATE INDEX idx_scan_logs_source ON scan_logs(source);
CREATE INDEX idx_scan_logs_serial ON scan_logs(serial_number);
CREATE INDEX idx_scan_logs_created ON scan_logs(created_at);
CREATE INDEX idx_scan_logs_level ON scan_logs(level);
