-- High-frequency key/value writes (D1-first, preserves KV put quota).
CREATE TABLE IF NOT EXISTS d1_kv (
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at REAL,
  PRIMARY KEY (key)
);
CREATE INDEX IF NOT EXISTS d1_kv_expiry ON d1_kv (expires_at);
