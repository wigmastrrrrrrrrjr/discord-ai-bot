CREATE TABLE IF NOT EXISTS agent_state (
  user_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  memory TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS relay_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS relay_cmds (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  user_id TEXT NOT NULL,
  command TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  output TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
