CREATE TABLE IF NOT EXISTS guild_configs (
  guild_id TEXT PRIMARY KEY,
  guild_name TEXT,
  channel_id TEXT,
  auto_reply INTEGER NOT NULL DEFAULT 0,
  system_prompt TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_guild_configs_channel
  ON guild_configs (channel_id);
