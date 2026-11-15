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
