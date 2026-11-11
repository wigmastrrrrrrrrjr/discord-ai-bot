ALTER TABLE guild_configs ADD COLUMN auto_community INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS model_channels (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  display_name TEXT NOT NULL,
  available INTEGER NOT NULL DEFAULT 1,
  last_checked_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, channel_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_model_channels_model
  ON model_channels (guild_id, provider, model);

CREATE INDEX IF NOT EXISTS idx_model_channels_channel
  ON model_channels (channel_id);

CREATE INDEX IF NOT EXISTS idx_model_channels_available
  ON model_channels (available);
