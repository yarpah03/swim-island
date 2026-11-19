CREATE TABLE IF NOT EXISTS bot_subscribers (
  chat_id INTEGER PRIMARY KEY, subscribed INTEGER NOT NULL DEFAULT 1,
  created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'direct',
  CHECK(subscribed IN (0,1))
);
CREATE TABLE IF NOT EXISTS bot_updates (
  update_id INTEGER PRIMARY KEY, lease_until INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bot_materials (
  id TEXT PRIMARY KEY, category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
  kind TEXT NOT NULL, payload TEXT NOT NULL, photo TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER, created_ms INTEGER NOT NULL,
  CHECK(category IN ('lessons','checklists','plans')), CHECK(kind IN ('asset','document','video','url'))
);
CREATE TABLE IF NOT EXISTS bot_admin_drafts (
  actor_id INTEGER PRIMARY KEY, step TEXT NOT NULL, payload TEXT NOT NULL, nonce TEXT NOT NULL, updated_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bot_media (
  name TEXT PRIMARY KEY, file_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bot_broadcasts (
  id TEXT PRIMARY KEY, source_chat INTEGER NOT NULL, source_message INTEGER NOT NULL,
  created_by INTEGER NOT NULL, created_ms INTEGER NOT NULL, payload TEXT,
  status TEXT NOT NULL DEFAULT 'draft', lease_until INTEGER NOT NULL DEFAULT 0,
  not_before INTEGER NOT NULL DEFAULT 0, CHECK(status IN ('draft','sending','paused','done','cancelled'))
);
CREATE TABLE IF NOT EXISTS bot_deliveries (
  broadcast_id TEXT NOT NULL REFERENCES bot_broadcasts(id), chat_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', updated_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(broadcast_id,chat_id), CHECK(status IN ('pending','sending','sent','failed','skipped'))
);
CREATE TABLE IF NOT EXISTS bot_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, created_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bot_active_materials ON bot_materials(category,active,created_ms);
CREATE INDEX IF NOT EXISTS bot_queued_delivery ON bot_deliveries(broadcast_id,status,chat_id);
CREATE INDEX IF NOT EXISTS bot_recent_news ON bot_broadcasts(status,created_ms);
CREATE INDEX IF NOT EXISTS bot_update_cleanup ON bot_updates(lease_until);
CREATE TABLE IF NOT EXISTS bot_menu_limits (
  user_id INTEGER PRIMARY KEY, window_ms INTEGER NOT NULL, count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bot_menu_actions (
  nonce TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_ms INTEGER NOT NULL
);
