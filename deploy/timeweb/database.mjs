import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

function normalized(row) {
  if (!row) return null;
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Uint8Array) row[key] = Array.from(value);
  }
  return row;
}

export function openDatabase(path) {
  assert(statSync(path).isFile(), 'SWIM_DB must point to an existing database file');
  const database = new DatabaseSync(path);
  database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

  function prepare(sql) {
    const statement = database.prepare(sql);
    function bind(...values) {
      return {
        bind,
        first: async () => normalized(statement.get(...values)),
        all: async () => ({ results: statement.all(...values).map(normalized) }),
        run: async () => ({ meta: { changes: statement.run(...values).changes } }),
        batchResult() {
          if (statement.columns().length) return { results: statement.all(...values).map(normalized) };
          return { meta: { changes: statement.run(...values).changes } };
        },
      };
    }
    return bind();
  }

  return {
    prepare,
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => statement.batchResult());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, destination, snapshot] = process.argv.slice(2);
  assert((action === 'init' || action === 'import') && destination && (action === 'init' || snapshot),
    'Usage: node database.mjs init <new file> or node database.mjs import <new file> <D1 SQL dump>');
  assert(!existsSync(destination), 'Use a new database file. Existing database preserved.');
  process.umask(0o077);
  const path = action === 'init' ? new URL('./schema.sql', import.meta.url) : snapshot;
  // The AUTOINCREMENT table creates sqlite_sequence. Some SQLite dumps repeat
  // the declaration using writable_schema. Keep its data and let SQLite create it.
  const sql = readFileSync(path, 'utf8')
    .replace(/^[ \t]*PRAGMA writable_schema\s*=\s*(?:ON|OFF|0|1);[ \t]*\r?$/gim, '')
    .replace(/^[ \t]*CREATE TABLE (?:IF NOT EXISTS )?sqlite_sequence\(name,\s*seq\);[ \t]*\r?$/gim, '');
  const db = new DatabaseSync(destination, { enableForeignKeyConstraints: false });
  try {
    db.exec(sql);
    const errors = db.prepare('PRAGMA foreign_key_check').all();
    assert.equal(errors.length, 0, 'Database has invalid references');
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok', 'SQLite integrity check failed');
    db.prepare('SELECT token_hash FROM chat_web_account_sessions LIMIT 0');
    db.prepare('SELECT photo FROM chat_messages LIMIT 0');
  } catch (error) {
    db.close();
    unlinkSync(destination);
    throw error;
  }
  db.close();
}
