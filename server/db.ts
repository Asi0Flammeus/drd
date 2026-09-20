/**
 * SQLite, through Node's own `node:sqlite`. No ORM, no driver dependency.
 *
 * Migrations are a numbered list applied inside one transaction each, with the
 * applied number kept in `schema_migrations`. That is the whole mechanism: a
 * fresh clone runs `npm run migrate` and gets exactly the schema this code
 * expects, and an existing database only runs what it is missing.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.ts";

export type Db = DatabaseSync;

let handle: Db | null = null;

export function db(): Db {
  if (handle) return handle;
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const open = new DatabaseSync(config.dbPath);
  open.exec("PRAGMA journal_mode = WAL");
  open.exec("PRAGMA foreign_keys = ON");
  open.exec("PRAGMA busy_timeout = 5000");
  handle = open;
  return open;
}

export function closeDb(): void {
  handle?.close();
  handle = null;
}

type Migration = { id: number; name: string; sql: string };

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "accounts, collections, captures, references",
    sql: `
      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );

      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX sessions_user ON sessions(user_id);

      CREATE TABLE collections (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id  TEXT REFERENCES collections(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        kind       TEXT NOT NULL DEFAULT 'folder',
        position   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX collections_user ON collections(user_id, parent_id);

      CREATE TABLE captures (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        requested_url TEXT NOT NULL,
        final_url     TEXT,
        host          TEXT NOT NULL,
        title         TEXT,
        description   TEXT,
        status        TEXT NOT NULL,
        error         TEXT,
        width         INTEGER,
        height        INTEGER,
        screenshot    TEXT,
        meta          TEXT NOT NULL DEFAULT '{}',
        created_at    TEXT NOT NULL,
        finished_at   TEXT
      );
      CREATE INDEX captures_user ON captures(user_id, created_at DESC);
      CREATE INDEX captures_host ON captures(user_id, host);

      CREATE TABLE capture_elements (
        id         TEXT PRIMARY KEY,
        capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
        ordinal    INTEGER NOT NULL,
        tag        TEXT NOT NULL,
        selector   TEXT NOT NULL,
        label      TEXT NOT NULL,
        guess      TEXT NOT NULL,
        x          REAL NOT NULL,
        y          REAL NOT NULL,
        width      REAL NOT NULL,
        height     REAL NOT NULL,
        text       TEXT,
        styles     TEXT NOT NULL DEFAULT '{}',
        crop       TEXT
      );
      CREATE INDEX capture_elements_capture ON capture_elements(capture_id, ordinal);

      CREATE TABLE capture_links (
        id          TEXT PRIMARY KEY,
        capture_id  TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
        href        TEXT NOT NULL,
        host        TEXT NOT NULL,
        anchor      TEXT,
        rel         TEXT,
        in_footer   INTEGER NOT NULL DEFAULT 0,
        credit_like INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX capture_links_capture ON capture_links(capture_id);
      CREATE INDEX capture_links_host ON capture_links(host);

      CREATE TABLE refs (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
        type          TEXT NOT NULL,
        title         TEXT NOT NULL,
        capture_id    TEXT REFERENCES captures(id) ON DELETE SET NULL,
        element_id    TEXT REFERENCES capture_elements(id) ON DELETE SET NULL,
        source_url    TEXT,
        source_host   TEXT,
        image         TEXT,
        payload       TEXT NOT NULL DEFAULT '{}',
        provenance    TEXT NOT NULL DEFAULT '{}',
        what          TEXT NOT NULL DEFAULT '',
        why           TEXT NOT NULL DEFAULT '',
        tags          TEXT NOT NULL DEFAULT '[]',
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX refs_user ON refs(user_id, created_at DESC);
      CREATE INDEX refs_collection ON refs(collection_id);

      CREATE TABLE signals (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL,
        subject    TEXT NOT NULL,
        weight     REAL NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX signals_user ON signals(user_id, kind);

      CREATE TABLE candidates (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        url         TEXT NOT NULL,
        host        TEXT NOT NULL,
        score       REAL NOT NULL,
        reasons     TEXT NOT NULL DEFAULT '[]',
        provider    TEXT NOT NULL,
        from_capture TEXT REFERENCES captures(id) ON DELETE SET NULL,
        state       TEXT NOT NULL DEFAULT 'new',
        created_at  TEXT NOT NULL,
        UNIQUE(user_id, host)
      );
      CREATE INDEX candidates_user ON candidates(user_id, state, score DESC);

      CREATE TABLE packs (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        brief      TEXT NOT NULL DEFAULT '',
        ref_ids    TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX packs_user ON packs(user_id, created_at DESC);
    `,
  },
];

export function migrate(): { applied: number[]; current: number } {
  const connection = db();
  connection.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const done = new Set(
    (connection.prepare("SELECT id FROM schema_migrations").all() as { id: number }[]).map((r) => r.id),
  );
  const applied: number[] = [];
  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) continue;
    connection.exec("BEGIN");
    try {
      connection.exec(migration.sql);
      connection
        .prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.id, migration.name, new Date().toISOString());
      connection.exec("COMMIT");
    } catch (error) {
      connection.exec("ROLLBACK");
      throw error;
    }
    applied.push(migration.id);
  }
  return { applied, current: MIGRATIONS[MIGRATIONS.length - 1].id };
}
