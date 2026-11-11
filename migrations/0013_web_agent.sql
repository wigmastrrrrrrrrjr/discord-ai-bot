-- Web agent state: D1 is the primary store, Workers KV is only a fallback.
CREATE TABLE IF NOT EXISTS webagent_index (
  user_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id)
);
CREATE TABLE IF NOT EXISTS webagent_sessions (
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, session_id)
);
CREATE TABLE IF NOT EXISTS webagent_jobs (
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, session_id)
);
