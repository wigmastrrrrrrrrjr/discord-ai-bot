-- Temporary blob overflow for when the device blob server is unreachable.
-- Files are chunked so each row stays well below D1's 2 MB row limit.
CREATE TABLE IF NOT EXISTS temp_blobs (
  key TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunks INTEGER NOT NULL,
  pending INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_temp_blobs_expires_at
  ON temp_blobs (expires_at);

CREATE INDEX IF NOT EXISTS idx_temp_blobs_created_at
  ON temp_blobs (created_at);

CREATE TABLE IF NOT EXISTS temp_blob_chunks (
  key TEXT NOT NULL,
  idx INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (key, idx)
);
