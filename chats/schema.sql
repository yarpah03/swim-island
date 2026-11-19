CREATE TABLE IF NOT EXISTS chat_profiles (
  telegram_id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('n', 's', 'p'))
);

CREATE TABLE IF NOT EXISTS chat_groups (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  level TEXT CHECK (level IN ('n', 's', 'p'))
);

INSERT OR IGNORE INTO chat_groups (id, title, level) VALUES
  ('level-n', 'Новички', 'n'),
  ('level-s', 'Средний уровень', 's'),
  ('level-p', 'Продвинутые', 'p');

CREATE TABLE IF NOT EXISTS chat_coaches (
  telegram_id INTEGER PRIMARY KEY,
  handle TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_coaching (
  id TEXT PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES chat_profiles(telegram_id),
  coach_id INTEGER NOT NULL REFERENCES chat_profiles(telegram_id),
  expires_ms INTEGER NOT NULL,
  CHECK (student_id <> coach_id),
  UNIQUE (student_id, coach_id)
);

CREATE INDEX IF NOT EXISTS chat_coaching_coach ON chat_coaching (coach_id, expires_ms);

CREATE TABLE IF NOT EXISTS chat_direct (
  id TEXT PRIMARY KEY,
  first_id INTEGER NOT NULL REFERENCES chat_profiles(telegram_id),
  second_id INTEGER NOT NULL REFERENCES chat_profiles(telegram_id),
  CHECK (first_id < second_id),
  UNIQUE (first_id, second_id)
);

CREATE INDEX IF NOT EXISTS chat_direct_second ON chat_direct (second_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  sender_id INTEGER NOT NULL REFERENCES chat_profiles(telegram_id),
  client_id TEXT NOT NULL,
  body TEXT NOT NULL,
  video_url TEXT,
  sent_ms INTEGER NOT NULL,
  photo BLOB,
  photo_width INTEGER,
  photo_height INTEGER,
  UNIQUE (room_id, sender_id, client_id)
);

CREATE INDEX IF NOT EXISTS chat_messages_room ON chat_messages (room_id, id);
CREATE INDEX IF NOT EXISTS chat_messages_sender ON chat_messages (room_id, sender_id, sent_ms);

CREATE TABLE IF NOT EXISTS chat_preferences (
  telegram_id INTEGER PRIMARY KEY REFERENCES chat_profiles(telegram_id),
  nickname TEXT,
  avatar TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  notify_personal INTEGER NOT NULL DEFAULT 0 CHECK (notify_personal IN (0, 1)),
  notify_groups INTEGER NOT NULL DEFAULT 0 CHECK (notify_groups IN (0, 1))
);

CREATE TABLE IF NOT EXISTS chat_notification_state (
  telegram_id INTEGER NOT NULL REFERENCES chat_profiles(telegram_id),
  room_id TEXT NOT NULL,
  seen_id INTEGER NOT NULL DEFAULT 0,
  notified_id INTEGER NOT NULL DEFAULT 0,
  notified_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (telegram_id, room_id)
);

CREATE TABLE IF NOT EXISTS chat_web_clients (
  student_id INTEGER PRIMARY KEY REFERENCES chat_profiles(telegram_id) CHECK (student_id < 0),
  coach_id INTEGER NOT NULL REFERENCES chat_coaches(telegram_id),
  room_id TEXT NOT NULL UNIQUE REFERENCES chat_coaching(id),
  email TEXT NOT NULL,
  invite_hash TEXT NOT NULL UNIQUE,
  verified_ms INTEGER,
  code_hash TEXT,
  code_expires_ms INTEGER NOT NULL DEFAULT 0,
  code_attempts INTEGER NOT NULL DEFAULT 0,
  last_code_ms INTEGER NOT NULL DEFAULT 0,
  code_window_ms INTEGER NOT NULL DEFAULT 0,
  code_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (coach_id, email)
);

CREATE TABLE IF NOT EXISTS chat_web_sessions (
  token_hash TEXT PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES chat_web_clients(student_id),
  expires_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS chat_web_sessions_student ON chat_web_sessions (student_id, expires_ms);

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

CREATE TABLE IF NOT EXISTS chat_pdf_access (
  room_id TEXT PRIMARY KEY REFERENCES chat_coaching(id),
  paid_until_ms INTEGER NOT NULL CHECK (paid_until_ms >= 0),
  updated_by INTEGER NOT NULL CHECK (updated_by > 0),
  updated_ms INTEGER NOT NULL
);

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
