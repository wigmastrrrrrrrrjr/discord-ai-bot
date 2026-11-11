CREATE TABLE IF NOT EXISTS dashboard_state (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (kind, key)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_state_key
  ON dashboard_state (key);

CREATE INDEX IF NOT EXISTS idx_dashboard_state_expires_at
  ON dashboard_state (expires_at);
