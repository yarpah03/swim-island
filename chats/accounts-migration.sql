CREATE TABLE IF NOT EXISTS chat_web_accounts (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('client', 'partner')),
  owner_id INTEGER NOT NULL CHECK (owner_id > 0),
  room_id TEXT UNIQUE REFERENCES chat_coaching(id),
  label TEXT NOT NULL,
  display_name TEXT,
  bio TEXT NOT NULL DEFAULT '',
  invite_hash TEXT NOT NULL UNIQUE,
  claimable INTEGER NOT NULL DEFAULT 1 CHECK (claimable IN (0, 1)),
  login TEXT COLLATE NOCASE UNIQUE,
  password_salt TEXT,
  password_hash TEXT,
  login_window_ms INTEGER NOT NULL DEFAULT 0,
  login_attempts INTEGER NOT NULL DEFAULT 0,
  disabled_ms INTEGER,
  CHECK ((role = 'client' AND room_id IS NOT NULL AND room_id = id) OR (role = 'partner' AND room_id IS NULL))
);

CREATE INDEX IF NOT EXISTS chat_web_accounts_owner ON chat_web_accounts (owner_id, role);

CREATE TABLE IF NOT EXISTS chat_web_account_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES chat_web_accounts(id),
  expires_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS chat_web_account_sessions_account ON chat_web_account_sessions (account_id, expires_ms);

CREATE TABLE IF NOT EXISTS chat_partner_materials (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES chat_web_accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('course', 'workout')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  body TEXT NOT NULL,
  video_url TEXT,
  published INTEGER NOT NULL CHECK (published IN (0, 1)),
  updated_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS chat_partner_materials_list ON chat_partner_materials (partner_id, published, updated_ms);
