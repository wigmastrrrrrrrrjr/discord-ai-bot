CREATE TABLE IF NOT EXISTS guild_updates (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  opted_in INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS global_updates (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  latest_message TEXT NOT NULL,
  posted_at INTEGER NOT NULL
);
