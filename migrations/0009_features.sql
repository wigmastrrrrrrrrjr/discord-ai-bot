-- Welcome, announcement, moderation, and audit features
CREATE TABLE IF NOT EXISTS guild_automod (
  guild_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  banned_words TEXT NOT NULL DEFAULT '[]',
  notice TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_welcome (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL DEFAULT '',
  message_text TEXT NOT NULL DEFAULT '',
  dm_enabled INTEGER NOT NULL DEFAULT 0,
  dm_text TEXT NOT NULL DEFAULT '',
  goodbye_channel_id TEXT NOT NULL DEFAULT '',
  goodbye_text TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS infra_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_infra_log_guild
  ON infra_log (guild_id, at DESC);
