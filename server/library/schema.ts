/**
 * Migration 3: typed libraries, boards, analyses and findings (§9.3).
 *
 * The `up` step moves every existing reference into `items` with the same
 * id, so packs keep resolving; copies each reference's picture into the blob
 * store so it no longer depends on its capture (W12); turns collections into
 * boards (the inbox becomes no board); fills tags, colours and the search
 * index; then drops `refs` and `collections`. One transaction: either all of
 * it happened or none of it did.
 */

import { join } from "node:path";
import { config } from "../config.ts";
import type { Db } from "../db.ts";
import { hexOfKey, labOfKey, keyOfHex, oklchOfLab } from "../analyse/color.ts";
import { storeBlob } from "./blobs.ts";
import { cleanTags, reindexItem, setTags } from "./indexing.ts";

export const LIBRARY_SQL = `
  CREATE TABLE blobs (
    hash TEXT PRIMARY KEY, mime TEXT NOT NULL, width INTEGER, height INTEGER,
    bytes INTEGER NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE analyses (
    id TEXT PRIMARY KEY,
    capture_id TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
    version INTEGER NOT NULL, status TEXT NOT NULL, partial INTEGER NOT NULL DEFAULT 0,
    error TEXT, created_at TEXT NOT NULL, finished_at TEXT, UNIQUE (capture_id, version)
  );
  CREATE TABLE findings (
    id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, subkind TEXT, ordinal INTEGER NOT NULL, title TEXT NOT NULL,
    confidence TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '[]', data TEXT NOT NULL,
    media TEXT NOT NULL DEFAULT '[]', locations TEXT NOT NULL DEFAULT '[]', signature TEXT
  );
  CREATE INDEX findings_analysis ON findings(analysis_id, kind, ordinal);
  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, subkind TEXT, title TEXT NOT NULL,
    why TEXT NOT NULL DEFAULT '', what TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}', media TEXT NOT NULL DEFAULT '[]', cover TEXT REFERENCES blobs(hash),
    capture_id TEXT REFERENCES captures(id) ON DELETE SET NULL,
    finding_id TEXT REFERENCES findings(id) ON DELETE SET NULL,
    source_url TEXT, source_host TEXT, confidence TEXT, signature TEXT,
    provenance TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX items_user_kind ON items(user_id, kind, created_at DESC);
  CREATE INDEX items_capture ON items(capture_id, signature);
  CREATE TABLE item_tags (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tag TEXT NOT NULL, PRIMARY KEY (item_id, tag)
  );
  CREATE TABLE item_colors (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    l REAL NOT NULL, a REAL NOT NULL, b REAL NOT NULL, share REAL NOT NULL
  );
  CREATE INDEX item_colors_lab ON item_colors(l, a, b);
  CREATE TABLE boards (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    cover_item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0, used_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX boards_user ON boards(user_id, position);
  CREATE TABLE board_items (
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0, added_at TEXT NOT NULL, PRIMARY KEY (board_id, item_id)
  );
  CREATE INDEX board_items_item ON board_items(item_id);
  CREATE VIRTUAL TABLE items_fts USING fts5(item_id UNINDEXED, body, tokenize = 'unicode61 remove_diacritics 2');
  ALTER TABLE packs RENAME COLUMN ref_ids TO item_ids;
  ALTER TABLE packs ADD COLUMN formats TEXT NOT NULL DEFAULT '["tokens","css","tailwind","brief"]';
  ALTER TABLE packs ADD COLUMN source TEXT NOT NULL DEFAULT '';
`;

/** §9.3 step 1: `site` → `page`, `font` → `type`, `image` → `mood`. */
const KIND: Record<string, string> = { site: "page", component: "component", font: "type", palette: "palette", image: "mood" };

type RefRow = {
  id: string;
  user_id: string;
  collection_id: string | null;
  type: string;
  title: string;
  capture_id: string | null;
  source_url: string | null;
  source_host: string | null;
  image: string | null;
  payload: string;
  provenance: string;
  what: string;
  why: string;
  tags: string;
  created_at: string;
  updated_at: string;
};

function parse(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A v1 palette payload (`colors: [{hex, count, role}]`) in the §4.9 shape, OKLCH computed, roles as given. */
function convertPayload(kind: string, payload: Record<string, unknown>): Record<string, unknown> {
  const out = { ...payload };
  if (kind === "palette" && Array.isArray(payload.colors)) {
    const colors = payload.colors.filter((c): c is { hex: string; count?: number; role?: string } => Boolean(c) && typeof c === "object" && typeof (c as { hex?: unknown }).hex === "string");
    out.colors = colors.map((c) => {
      const key = keyOfHex(c.hex);
      return {
        role: c.role ?? "",
        key: null,
        value: oklchOfLab(labOfKey(key)),
        hex: hexOfKey(key),
        share: 0,
        textShare: 0,
        usedOn: [],
        origins: ["dom"],
        confidence: "check",
        evidence: [{ origin: "dom", note: `compté ${c.count ?? 0} fois par l'extracteur v1 (par élément, pas par surface)` }],
        locations: [],
        count: c.count ?? 0,
      };
    });
    out.pairs = [];
    out.others = [];
    out.theme = "light";
    out.legacy = true;
  }
  // W5: the v1 font sample was script source, never keep it.
  if (kind === "type" && Array.isArray(payload.fonts)) {
    out.fonts = payload.fonts.map((f) => {
      if (!f || typeof f !== "object") return f;
      const { sample: _sample, ...rest } = f as Record<string, unknown>;
      return rest;
    });
    out.legacy = true;
  }
  return out;
}

export function migrateLibrary(connection: Db): void {
  const refs = connection.prepare("SELECT * FROM refs").all() as RefRow[];
  const collections = connection.prepare("SELECT id, user_id, parent_id, name, kind, position, created_at FROM collections").all() as {
    id: string;
    user_id: string;
    parent_id: string | null;
    name: string;
    kind: string;
    position: number;
    created_at: string;
  }[];

  const insertItem = connection.prepare(
    `INSERT INTO items (id, user_id, kind, subkind, title, why, what, data, media, cover, capture_id, finding_id,
                        source_url, source_host, confidence, signature, provenance, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'check', NULL, ?, ?, ?)`,
  );
  for (const ref of refs) {
    const kind = KIND[ref.type] ?? "page";
    let cover: string | null = null;
    if (ref.image) {
      cover = storeBlob(connection, join(config.mediaDir, ref.image));
      if (!cover) console.warn(`[drd] migration 3: picture missing for reference ${ref.id} (${ref.image}); kept without cover`);
    }
    const provenance = { ...parse(ref.provenance), migratedFrom: { table: "refs", type: ref.type, image: ref.image } };
    insertItem.run(
      ref.id,
      ref.user_id,
      kind,
      ref.title,
      ref.why,
      ref.what,
      JSON.stringify(convertPayload(kind, parse(ref.payload))),
      JSON.stringify(cover ? [cover] : []),
      cover,
      ref.capture_id,
      ref.source_url,
      ref.source_host,
      JSON.stringify(provenance),
      ref.created_at,
      ref.updated_at,
    );
    let tags: unknown = [];
    try {
      tags = JSON.parse(ref.tags);
    } catch {
      tags = [];
    }
    setTags(connection, ref.id, cleanTags(tags));
  }

  // Collections → boards, flat: the path becomes the name.
  const byId = new Map(collections.map((c) => [c.id, c]));
  const pathOf = (id: string): string[] => {
    const names: string[] = [];
    let cursor: string | null = id;
    for (let depth = 0; cursor && depth < 12; depth += 1) {
      const row = byId.get(cursor);
      if (!row) break;
      names.unshift(row.name);
      cursor = row.parent_id;
    }
    return names;
  };
  const insertBoard = connection.prepare("INSERT INTO boards (id, user_id, name, description, position, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?, ?)");
  const insertMember = connection.prepare("INSERT OR IGNORE INTO board_items (board_id, item_id, position, added_at) VALUES (?, ?, ?, ?)");
  collections
    .filter((c) => c.kind !== "inbox")
    .forEach((collection, index) => {
      insertBoard.run(collection.id, collection.user_id, pathOf(collection.id).join(" › "), index, collection.created_at, collection.created_at);
      refs
        .filter((ref) => ref.collection_id === collection.id)
        .forEach((ref, position) => insertMember.run(collection.id, ref.id, position, ref.updated_at));
    });

  for (const ref of refs) reindexItem(connection, ref.id);

  connection.exec("DROP TABLE refs; DROP TABLE collections;");
}
