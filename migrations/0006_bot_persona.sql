ALTER TABLE guild_configs ADD COLUMN bot_nickname TEXT;
ALTER TABLE guild_configs ADD COLUMN use_emojis INTEGER NOT NULL DEFAULT 1;
ALTER TABLE guild_configs ADD COLUMN reaction_emoji TEXT NOT NULL DEFAULT '✅';
ALTER TABLE guild_configs ADD COLUMN reply_emoji TEXT NOT NULL DEFAULT '';
ALTER TABLE guild_configs ADD COLUMN persona TEXT;

CREATE INDEX IF NOT EXISTS idx_guild_configs_updated
  ON guild_configs (updated_at);
