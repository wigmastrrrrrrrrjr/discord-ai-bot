CREATE TABLE IF NOT EXISTS guild_commands (
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  prompt TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, name)
);

CREATE INDEX IF NOT EXISTS idx_guild_commands_guild
  ON guild_commands (guild_id);
