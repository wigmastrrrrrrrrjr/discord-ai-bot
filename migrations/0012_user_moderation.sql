-- Autonomous ToS enforcement: per-user usage restrictions.
CREATE TABLE IF NOT EXISTS user_bans (
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id)
);
