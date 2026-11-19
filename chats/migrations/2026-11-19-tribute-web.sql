CREATE TABLE IF NOT EXISTS chat_tribute_accounts (
  id TEXT PRIMARY KEY,
  telegram_id INTEGER NOT NULL UNIQUE REFERENCES chat_profiles(telegram_id),
  display_name TEXT NOT NULL,
  login TEXT COLLATE NOCASE UNIQUE,
  password_salt TEXT,
  password_hash TEXT,
  activation_hash TEXT UNIQUE,
  activation_expires_ms INTEGER NOT NULL DEFAULT 0,
  created_ms INTEGER NOT NULL,
  paid_until_ms INTEGER NOT NULL DEFAULT 0,
  login_window_ms INTEGER NOT NULL DEFAULT 0,
  login_attempts INTEGER NOT NULL DEFAULT 0,
  disabled_ms INTEGER
);
CREATE TABLE IF NOT EXISTS chat_tribute_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES chat_tribute_accounts(id),
  expires_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_tribute_sessions_account ON chat_tribute_sessions(account_id,expires_ms);
