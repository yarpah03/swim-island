-- Explicitly confirmed payments for coaching/web clients. No implicit grants.
CREATE TABLE IF NOT EXISTS chat_pdf_access (
  room_id TEXT PRIMARY KEY REFERENCES chat_coaching(id),
  paid_until_ms INTEGER NOT NULL CHECK (paid_until_ms >= 0),
  updated_by INTEGER NOT NULL CHECK (updated_by > 0),
  updated_ms INTEGER NOT NULL
);
