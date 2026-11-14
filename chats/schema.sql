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

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  sender_id INTEGER NOT NULL REFERENCES chat_profiles(telegram_id),
  client_id TEXT NOT NULL,
  body TEXT NOT NULL,
  video_url TEXT,
  sent_ms INTEGER NOT NULL,
  UNIQUE (room_id, sender_id, client_id)
);

CREATE INDEX IF NOT EXISTS chat_messages_room ON chat_messages (room_id, id);
CREATE INDEX IF NOT EXISTS chat_messages_sender ON chat_messages (room_id, sender_id, sent_ms);
