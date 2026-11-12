CREATE TABLE IF NOT EXISTS game_runs (
  id TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  issued_ms INTEGER NOT NULL,
  finished_ms INTEGER,
  month TEXT,
  meters INTEGER,
  display_name TEXT
);

CREATE INDEX IF NOT EXISTS game_runs_player_issued ON game_runs (player_id, issued_ms);
CREATE INDEX IF NOT EXISTS game_runs_issued ON game_runs (issued_ms);

CREATE TABLE IF NOT EXISTS game_month (
  month TEXT NOT NULL,
  player_id INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  meters INTEGER NOT NULL,
  reached_ms INTEGER NOT NULL,
  PRIMARY KEY (month, player_id)
);

CREATE INDEX IF NOT EXISTS game_month_standings
ON game_month (month, meters DESC, reached_ms, player_id);

-- Updating the ticket and crediting its meters are one atomic SQLite write.
CREATE TRIGGER IF NOT EXISTS game_credit_run
AFTER UPDATE OF finished_ms ON game_runs
WHEN OLD.finished_ms IS NULL AND NEW.finished_ms IS NOT NULL AND NEW.meters > 0
BEGIN
  INSERT INTO game_month (month, player_id, display_name, meters, reached_ms)
  VALUES (NEW.month, NEW.player_id, NEW.display_name, NEW.meters, NEW.finished_ms)
  ON CONFLICT (month, player_id) DO UPDATE SET
    display_name = excluded.display_name,
    meters = game_month.meters + excluded.meters,
    reached_ms = MAX(game_month.reached_ms, excluded.reached_ms);
END;
