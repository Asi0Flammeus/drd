/**
 * The library: items, boards, search, duplicates (§5).
 *
 * The only module that writes `items`, `item_tags`, `item_colors`,
 * `items_fts`, `boards` and `board_items`. Routes call these functions and
 * nothing else touches those tables, so the derived indexes stay true to the
 * rows they index.
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { config } from "../config.ts";
import { db } from "../db.ts";
import type { Db } from "../db.ts";
import { deltaE, hexOfLab, hueDistance, keyOfHex, labOfKey, oklchOfLab } from "../analyse/color.ts";
import type { Lab } from "../analyse/color.ts";
import { collectBlobs, storeBlob } from "./blobs.ts";
import { cleanTags, colorsOf, reindexItem, setTags } from "./indexing.ts";
import type { ItemRow } from "./indexing.ts";

export class LibraryError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type Library = "palettes" | "typos" | "composants" | "ambiances";

export const LIBRARY_OF: Record<string, Library> = {
  palette: "palettes",
  color: "palettes",
  type: "typos",
  component: "composants",
  scale: "composants",
  mood: "ambiances",
  page: "ambiances",
};

export const LIBRARY_LABEL: Record<Library, string> = { palettes: "Palettes", typos: "Typographies", composants: "Composants", ambiances: "Ambiances" };

export type ItemView = {
  id: string;
  kind: string;
  subkind: string | null;
  library: Library;
  title: string;
  why: string;
  what: string;
  tags: string[];
  data: unknown;
  media: string[];
  cover: string | null;
  captureId: string | null;
  findingId: string | null;
  sourceUrl: string | null;
  sourceHost: string | null;
  confidence: string | null;
  signature: string | null;
  provenance: Record<string, unknown>;
  boards: { id: string; name: string }[];
  createdAt: string;
  updatedAt: string;
};

export type Neighbour = { id: string; title: string; kind: string; library: Library };

function parse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function view(connection: Db, row: ItemRow): ItemView {
  return {
    id: row.id,
    kind: row.kind,
    subkind: row.subkind,
    library: LIBRARY_OF[row.kind] ?? "ambiances",
    title: row.title,
    why: row.why,
    what: row.what,
    tags: (connection.prepare("SELECT tag FROM item_tags WHERE item_id = ? ORDER BY tag").all(row.id) as { tag: string }[]).map((t) => t.tag),
    data: parse(row.data, {}),
    media: parse(row.media, [] as string[]),
    cover: row.cover,
    captureId: row.capture_id,
    findingId: row.finding_id,
    sourceUrl: row.source_url,
    sourceHost: row.source_host,
    confidence: row.confidence,
    signature: row.signature,
    provenance: parse(row.provenance, {}),
    boards: connection
      .prepare("SELECT b.id, b.name FROM boards b JOIN board_items bi ON bi.board_id = b.id WHERE bi.item_id = ? ORDER BY b.name")
      .all(row.id) as { id: string; name: string }[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowOf(connection: Db, userId: string, itemId: string): ItemRow {
  const row = connection.prepare("SELECT * FROM items WHERE id = ? AND user_id = ?").get(itemId, userId) as ItemRow | undefined;
  if (!row) throw new LibraryError(404, "not_found", "Élément introuvable.");
  return row;
}

function transaction<T>(connection: Db, work: () => T): T {
  connection.exec("BEGIN");
  try {
    const out = work();
    connection.exec("COMMIT");
    return out;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

/** "Maison Cyrah - Institut … | Maison Cyrah" → "Maison Cyrah". */
export function siteLabel(meta: Record<string, string>, host: string): string {
  if (meta.siteName) return meta.siteName.slice(0, 80);
  const first = (meta.title ?? "").split(/\s[|–—-]\s|\s·\s/)[0]?.trim();
  return (first || host.replace(/^www\./, "")).slice(0, 80);
}

/** Every string in `data` naming one of the finding's files becomes `blob:<hash>`. */
function rewriteMedia(value: unknown, map: Record<string, string>): unknown {
  if (typeof value === "string") return map[value] ? `blob:${map[value]}` : value;
  if (Array.isArray(value)) return value.map((entry) => rewriteMedia(entry, map));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = rewriteMedia(entry, map);
    return out;
  }
  return value;
}

/* ------------------------------------------------------------ duplicates ----- */

function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

type Parsed = { row: ItemRow; data: Record<string, unknown> };

function roleHex(data: Record<string, unknown>, key: string): string | null {
  const colors = Array.isArray(data.colors) ? (data.colors as { key?: string; hex?: string }[]) : [];
  return colors.find((c) => c.key === key)?.hex ?? null;
}

const close = (a: string | null, b: string | null): boolean => (a === null && b === null) || (a !== null && b !== null && deltaE(labOfKey(keyOfHex(a)), labOfKey(keyOfHex(b))) < 0.02);

/** §5.4, per kind. `true` when `b` is a near-duplicate of `a`. */
export function nearDuplicate(a: Parsed, b: Parsed): boolean {
  if (a.row.kind !== b.row.kind) return false;
  if (a.row.signature && a.row.signature === b.row.signature) return true;
  switch (a.row.kind) {
    case "palette": {
      const labs = (d: Record<string, unknown>) =>
        colorsOf("palette", d)
          .map((c) => labOfKey(keyOfHex(c.hex)))
          .sort((x, y) => x.l - y.l);
      const x = labs(a.data);
      const y = labs(b.data);
      if (!x.length || !y.length) return false;
      const used = new Set<number>();
      let matched = 0;
      for (const lab of x) {
        const hit = y.findIndex((other, index) => !used.has(index) && deltaE(lab, other) <= 0.02);
        if (hit >= 0) {
          used.add(hit);
          matched += 1;
        }
      }
      return matched / Math.max(x.length, y.length) >= 0.8 && close(roleHex(a.data, "background"), roleHex(b.data, "background")) && close(roleHex(a.data, "accent"), roleHex(b.data, "accent"));
    }
    case "color": {
      const hex = (d: Record<string, unknown>) => ((d.color as { hex?: string } | undefined)?.hex ?? null);
      return close(hex(a.data), hex(b.data)) && hex(a.data) !== null;
    }
    case "type": {
      const families = (d: Record<string, unknown>) =>
        [d.family, (d.display as { family?: string } | undefined)?.family, (d.text as { family?: string } | undefined)?.family, ...(Array.isArray(d.families) ? d.families : [])]
          .filter((f): f is string => typeof f === "string")
          .map((f) => f.toLowerCase())
          .sort()
          .join("+");
      const body = (d: Record<string, unknown>) => d.body ?? d.bodySize ?? null;
      const ratio = (d: Record<string, unknown>) => (typeof d.ratio === "number" ? d.ratio : null);
      const ra = ratio(a.data);
      const rb = ratio(b.data);
      return families(a.data) !== "" && families(a.data) === families(b.data) && a.row.subkind === b.row.subkind && body(a.data) === body(b.data) && (ra === rb || (ra !== null && rb !== null && Math.abs(ra - rb) <= 0.02));
    }
    case "component": {
      if (a.data.kind !== b.data.kind) return false;
      if (typeof a.data.css === "string" && a.data.css === b.data.css) return true;
      return typeof a.data.dhash === "string" && typeof b.data.dhash === "string" && hamming(a.data.dhash, b.data.dhash) <= 6;
    }
    case "mood": {
      const images = (d: Record<string, unknown>) => (Array.isArray(d.images) ? (d.images as { crop?: string | null }[]).map((i) => i.crop).filter((c): c is string => Boolean(c)) : []);
      const x = images(a.data);
      const y = new Set(images(b.data));
      return x.length > 0 && x.filter((h) => y.has(h)).length / x.length >= 0.5;
    }
    case "page":
      return Boolean(a.row.source_url) && a.row.source_url === b.row.source_url;
    default:
      return false;
  }
}

function neighboursOf(connection: Db, row: ItemRow): Neighbour[] {
  const self: Parsed = { row, data: parse(row.data, {}) };
  const others = connection.prepare("SELECT * FROM items WHERE user_id = ? AND kind = ? AND id != ?").all(row.user_id, row.kind, row.id) as ItemRow[];
  return others
    .filter((other) => nearDuplicate(self, { row: other, data: parse(other.data, {}) }))
    .map((other) => ({ id: other.id, title: other.title, kind: other.kind, library: LIBRARY_OF[other.kind] ?? "ambiances" }));
}

/* ----------------------------------------------------------------- keep ----- */

export type KeepResult = { item: ItemView; already: boolean; neighbours: Neighbour[] };

type FindingRow = {
  id: string;
  analysis_id: string;
  kind: string;
  subkind: string | null;
  title: string;
  confidence: string;
  evidence: string;
  data: string;
  media: string;
  signature: string | null;
  capture_id: string;
  user_id: string;
  version: number;
  partial: number;
  final_url: string | null;
  requested_url: string;
  host: string;
  title_page: string | null;
  meta: string;
  finished_at: string | null;
};

/**
 * One tap: the finding is frozen into an item at once, media copied into the
 * item's own blobs. Never fails on a duplicate: the item is created and the
 * neighbour is named, so the toast can offer to merge (§5.2, §5.4).
 */
export function keep(userId: string, findingId: string, options: { boardId?: string | null } = {}): KeepResult {
  const connection = db();
  const finding = connection
    .prepare(
      `SELECT f.*, a.capture_id, a.version, a.partial, c.user_id, c.final_url, c.requested_url, c.host, c.title AS title_page, c.meta, c.finished_at
       FROM findings f JOIN analyses a ON a.id = f.analysis_id JOIN captures c ON c.id = a.capture_id
       WHERE f.id = ? AND c.user_id = ?`,
    )
    .get(findingId, userId) as FindingRow | undefined;
  if (!finding) throw new LibraryError(404, "no_finding", "Trouvaille introuvable.");

  const existing = connection
    .prepare("SELECT * FROM items WHERE user_id = ? AND (finding_id = ? OR (capture_id = ? AND signature = ? AND kind = ?)) LIMIT 1")
    .get(userId, finding.id, finding.capture_id, finding.signature, finding.kind) as ItemRow | undefined;
  if (existing) return { item: view(connection, existing), already: true, neighbours: [] };

  return transaction(connection, () => {
    const dir = join(config.mediaDir, finding.capture_id);
    const files = parse(finding.media, [] as string[]);
    const map: Record<string, string> = {};
    for (const file of files) {
      const hash = storeBlob(connection, join(dir, file));
      if (hash) map[file] = hash;
    }
    const media = files.map((file) => map[file]).filter((hash): hash is string => Boolean(hash));
    const cover = files.find((file) => /\.(webp|png|jpe?g)$/i.test(file) && map[file]) ?? null;
    const meta = parse(finding.meta, {} as { meta?: Record<string, string> }).meta ?? {};
    const site = siteLabel(meta, finding.host);
    const now = new Date().toISOString();
    const data = rewriteMedia(parse(finding.data, {}), map);
    const title = finding.kind === "palette" && finding.subkind === "interface" ? site : finding.kind === "mood" || finding.kind === "page" ? `${site} · ${finding.kind === "mood" ? "ambiance" : "page"}` : finding.title;
    const moodRow = connection
      .prepare("SELECT data FROM findings WHERE analysis_id = ? AND kind = 'mood' LIMIT 1")
      .get(finding.analysis_id) as { data: string } | undefined;
    const moodWords = moodRow ? (parse(moodRow.data, {} as { descriptors?: { word: string }[] }).descriptors ?? []).map((d) => d.word) : [];
    const provenance = {
      site,
      sourceUrl: finding.final_url ?? finding.requested_url,
      pageTitle: finding.title_page,
      capturedAt: finding.finished_at,
      keptAt: now,
      analysisVersion: finding.version,
      partial: Boolean(finding.partial),
      finding: { kind: finding.kind, subkind: finding.subkind, title: finding.title, evidence: parse(finding.evidence, []) },
      moodWords,
      sources: [{ url: finding.final_url ?? finding.requested_url, host: finding.host, capturedAt: finding.finished_at }],
    };
    const id = randomUUID();
    connection
      .prepare(
        `INSERT INTO items (id, user_id, kind, subkind, title, why, what, data, media, cover, capture_id, finding_id,
                            source_url, source_host, confidence, signature, provenance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        finding.kind,
        finding.subkind,
        title.slice(0, 160),
        JSON.stringify(data),
        JSON.stringify(media),
        cover ? map[cover] : null,
        finding.capture_id,
        finding.id,
        finding.final_url ?? finding.requested_url,
        finding.host,
        finding.confidence,
        finding.signature,
        JSON.stringify(provenance),
        now,
        now,
      );
    reindexItem(connection, id);
    if (options.boardId) addToBoardIn(connection, userId, options.boardId, [id]);
    connection.prepare("INSERT INTO signals (id, user_id, kind, subject, weight, created_at) VALUES (?, ?, 'saved', ?, 1, ?)").run(randomUUID(), userId, finding.host, now);
    const row = rowOf(connection, userId, id);
    return { item: view(connection, row), already: false, neighbours: neighboursOf(connection, row) };
  });
}

/** Items made in the Atelier (a mix, a bench setting): no capture behind them. */
export function create(
  userId: string,
  input: { kind: string; subkind?: string | null; title: string; data: unknown; why?: string; tags?: unknown; boardId?: string | null },
): KeepResult {
  if (!LIBRARY_OF[input.kind]) throw new LibraryError(400, "bad_kind", "Type d'élément inconnu.");
  const connection = db();
  return transaction(connection, () => {
    const id = randomUUID();
    const now = new Date().toISOString();
    connection
      .prepare(
        `INSERT INTO items (id, user_id, kind, subkind, title, why, what, data, media, cover, capture_id, finding_id,
                            source_url, source_host, confidence, signature, provenance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '', ?, '[]', NULL, NULL, NULL, NULL, NULL, 'sure', NULL, ?, ?, ?)`,
      )
      .run(id, userId, input.kind, input.subkind ?? null, input.title.slice(0, 160) || "Sans titre", (input.why ?? "").slice(0, 2000), JSON.stringify(input.data ?? {}), JSON.stringify({ source: "atelier", keptAt: now }), now, now);
    setTags(connection, id, cleanTags(input.tags));
    reindexItem(connection, id);
    if (input.boardId) addToBoardIn(connection, userId, input.boardId, [id]);
    const row = rowOf(connection, userId, id);
    return { item: view(connection, row), already: false, neighbours: neighboursOf(connection, row) };
  });
}

export function getItem(userId: string, itemId: string): ItemView & { neighbours: Neighbour[] } {
  const connection = db();
  const row = rowOf(connection, userId, itemId);
  return { ...view(connection, row), neighbours: neighboursOf(connection, row) };
}

export function update(userId: string, itemId: string, patch: { title?: unknown; why?: unknown; what?: unknown; tags?: unknown; addTags?: unknown }): ItemView {
  const connection = db();
  return transaction(connection, () => {
    const row = rowOf(connection, userId, itemId);
    const text = (value: unknown, current: string, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : current);
    connection
      .prepare("UPDATE items SET title = ?, why = ?, what = ?, updated_at = ? WHERE id = ?")
      .run(text(patch.title, row.title, 160) || row.title, text(patch.why, row.why, 2000), text(patch.what, row.what, 2000), new Date().toISOString(), row.id);
    if (patch.tags !== undefined) setTags(connection, row.id, cleanTags(patch.tags));
    if (patch.addTags !== undefined) {
      const current = (connection.prepare("SELECT tag FROM item_tags WHERE item_id = ?").all(row.id) as { tag: string }[]).map((t) => t.tag);
      setTags(connection, row.id, cleanTags([...current, ...cleanTags(patch.addTags)]));
    }
    reindexItem(connection, row.id);
    return view(connection, rowOf(connection, userId, itemId));
  });
}

export function remove(userId: string, itemIds: string[]): number {
  const connection = db();
  const removed = transaction(connection, () => {
    let n = 0;
    for (const id of itemIds) {
      const result = connection.prepare("DELETE FROM items WHERE id = ? AND user_id = ?").run(id, userId);
      if (Number(result.changes)) {
        connection.prepare("DELETE FROM items_fts WHERE item_id = ?").run(id);
        n += 1;
      }
    }
    return n;
  });
  collectBlobs(connection);
  return removed;
}

/**
 * Eagle's merge: the older item stays, the newer one's reason is appended,
 * tags and boards are unioned, both sources recorded; the newer is deleted.
 */
export function merge(userId: string, aId: string, bId: string): ItemView {
  if (aId === bId) throw new LibraryError(400, "same_item", "Un élément ne se fusionne pas avec lui-même.");
  const connection = db();
  const merged = transaction(connection, () => {
    const a = rowOf(connection, userId, aId);
    const b = rowOf(connection, userId, bId);
    if (a.kind !== b.kind) throw new LibraryError(400, "kind_mismatch", "Seuls deux éléments du même type se fusionnent.");
    const [older, newer] = a.created_at <= b.created_at ? [a, b] : [b, a];
    const why = [older.why.trim(), newer.why.trim()].filter(Boolean).filter((v, i, all) => all.indexOf(v) === i).join("\n");
    const provenance = parse(older.provenance, {} as Record<string, unknown>);
    const newerProvenance = parse(newer.provenance, {} as Record<string, unknown>);
    const sources = [...((provenance.sources as unknown[]) ?? []), ...((newerProvenance.sources as unknown[]) ?? [{ url: newer.source_url, host: newer.source_host }])];
    provenance.sources = sources;
    provenance.merged = [...((provenance.merged as unknown[]) ?? []), { id: newer.id, title: newer.title, sourceUrl: newer.source_url, mergedAt: new Date().toISOString() }];
    const tags = (connection.prepare("SELECT tag FROM item_tags WHERE item_id IN (?, ?)").all(older.id, newer.id) as { tag: string }[]).map((t) => t.tag);
    const media = [...new Set([...parse(older.media, [] as string[]), ...parse(newer.media, [] as string[])])];
    connection.prepare("UPDATE items SET why = ?, provenance = ?, media = ?, updated_at = ? WHERE id = ?").run(why.slice(0, 4000), JSON.stringify(provenance), JSON.stringify(media), new Date().toISOString(), older.id);
    setTags(connection, older.id, cleanTags(tags));
    connection.prepare("INSERT OR IGNORE INTO board_items (board_id, item_id, position, added_at) SELECT board_id, ?, position, added_at FROM board_items WHERE item_id = ?").run(older.id, newer.id);
    connection.prepare("DELETE FROM items WHERE id = ?").run(newer.id);
    connection.prepare("DELETE FROM items_fts WHERE item_id = ?").run(newer.id);
    reindexItem(connection, older.id);
    return view(connection, rowOf(connection, userId, older.id));
  });
  collectBlobs(connection);
  return merged;
}

/* --------------------------------------------------------------- search ----- */

export type SearchQuery = {
  q?: string;
  library?: string;
  kind?: string;
  board?: string;
  host?: string;
  tag?: string;
  noReason?: boolean;
  confidence?: string;
  theme?: "light" | "dark";
  typeClass?: string;
  componentKind?: string;
  color?: string;
  hue?: number;
  tolerance?: number;
  sort?: "recent" | "source" | "hue" | "size";
};

export type SearchResult = {
  items: (ItemView & { match?: { hex: string; distance: number } })[];
  counts: { libraries: Record<Library | "tableaux", number>; noReason: number; total: number };
  facets: { hosts: string[]; tags: string[]; componentKinds: string[] };
  mode: "all" | "any" | "none";
};

function fondL(data: Record<string, unknown>): number | null {
  const hex = roleHex(data, "background");
  return hex ? labOfKey(keyOfHex(hex)).l : null;
}

function accentHue(data: Record<string, unknown>): number | null {
  const hex = roleHex(data, "accent") ?? colorsOf("palette", data)[0]?.hex ?? (data.color as { hex?: string } | undefined)?.hex ?? null;
  return hex ? oklchOfLab(labOfKey(keyOfHex(hex))).h : null;
}

function typeClasses(data: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const add = (generic: unknown) => {
    if (generic === "serif") out.add("serif");
    if (generic === "sans-serif") out.add("sans");
    if (generic === "monospace") out.add("mono");
  };
  add(data.generic);
  if (data.display === true) out.add("display");
  for (const part of [data.display, data.text]) if (part && typeof part === "object") add((part as { generic?: unknown }).generic);
  if (data.display && typeof data.display === "object") out.add("display");
  return [...out];
}

/** A pasted `#186063` or `oklch(0.448 0.068 199)` as OKLab. */
export function parseColorQuery(text: string): Lab | null {
  const value = text.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return labOfKey(keyOfHex(value));
  const m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/i.exec(value);
  if (m) {
    const l = m[1].endsWith("%") ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    const c = parseFloat(m[2]);
    const h = (parseFloat(m[3]) * Math.PI) / 180;
    return { l, a: c * Math.cos(h), b: c * Math.sin(h) };
  }
  return null;
}

function ftsQuery(text: string, mode: "all" | "any"): string | null {
  const tokens = text
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2)
    .slice(0, 8)
    .map((t) => `"${t.replace(/"/g, "")}"*`);
  return tokens.length ? tokens.join(mode === "all" ? " AND " : " OR ") : null;
}

export function search(userId: string, query: SearchQuery): SearchResult {
  const connection = db();
  let rows = connection.prepare("SELECT * FROM items WHERE user_id = ? ORDER BY created_at DESC").all(userId) as ItemRow[];
  let mode: SearchResult["mode"] = "none";

  // Free text, or a colour when the text is one.
  const text = (query.q ?? "").trim();
  const colorFromText = text ? parseColorQuery(text) : null;
  if (text && !colorFromText) {
    let ids: Set<string> | null = null;
    for (const attempt of ["all", "any"] as const) {
      const match = ftsQuery(text, attempt);
      if (!match) break;
      const hits = connection.prepare("SELECT item_id FROM items_fts WHERE items_fts MATCH ?").all(match) as { item_id: string }[];
      if (hits.length) {
        ids = new Set(hits.map((h) => h.item_id));
        mode = attempt;
        break;
      }
    }
    rows = ids ? rows.filter((row) => ids.has(row.id)) : [];
  }

  // Colour: a pasted value, or a hue from the ring.
  let target = colorFromText ?? (query.color ? parseColorQuery(query.color) : null);
  if (!target && typeof query.hue === "number" && Number.isFinite(query.hue)) {
    const h = (query.hue * Math.PI) / 180;
    target = { l: 0.65, a: 0.12 * Math.cos(h), b: 0.12 * Math.sin(h) };
  }
  const matches = new Map<string, { hex: string; distance: number; share: number }>();
  if (target) {
    const tolerance = query.tolerance ?? 0.06;
    const hueOnly = !colorFromText && !query.color;
    const candidates = hueOnly
      ? (connection.prepare("SELECT item_id, l, a, b, share FROM item_colors").all() as { item_id: string; l: number; a: number; b: number; share: number }[])
      : (connection
          .prepare("SELECT item_id, l, a, b, share FROM item_colors WHERE l BETWEEN ? AND ? AND a BETWEEN ? AND ? AND b BETWEEN ? AND ?")
          .all(target.l - tolerance, target.l + tolerance, target.a - tolerance, target.a + tolerance, target.b - tolerance, target.b + tolerance) as { item_id: string; l: number; a: number; b: number; share: number }[]);
    const targetHue = oklchOfLab(target).h;
    for (const c of candidates) {
      const lab = { l: c.l, a: c.a, b: c.b };
      // The ring picks a hue, not a lightness: distance is the hue gap, and greys never match.
      const distance = hueOnly ? (Math.hypot(c.a, c.b) < 0.03 ? Infinity : hueDistance(oklchOfLab(lab).h, targetHue) / 360) : deltaE(lab, target);
      if (distance > (hueOnly ? 20 / 360 : tolerance)) continue;
      const previous = matches.get(c.item_id);
      if (!previous || distance < previous.distance || (distance === previous.distance && c.share > previous.share)) {
        const hex = hexOfLab(lab);
        matches.set(c.item_id, { hex, distance, share: c.share });
      }
    }
    rows = rows.filter((row) => matches.has(row.id));
    rows.sort((a, b) => {
      const x = matches.get(a.id);
      const y = matches.get(b.id);
      return (x?.distance ?? 1) - (y?.distance ?? 1) || (y?.share ?? 0) - (x?.share ?? 0);
    });
  }

  // Facet filters that are not the library tab.
  const boardMembers = query.board
    ? new Set((connection.prepare("SELECT item_id FROM board_items bi JOIN boards b ON b.id = bi.board_id WHERE b.id = ? AND b.user_id = ?").all(query.board, userId) as { item_id: string }[]).map((r) => r.item_id))
    : null;
  const tagMembers = query.tag
    ? new Set((connection.prepare("SELECT item_id FROM item_tags WHERE tag = ?").all(query.tag.toLowerCase()) as { item_id: string }[]).map((r) => r.item_id))
    : null;
  const filtered = rows.filter((row) => {
    if (boardMembers && !boardMembers.has(row.id)) return false;
    if (tagMembers && !tagMembers.has(row.id)) return false;
    if (query.host && row.source_host !== query.host) return false;
    if (query.confidence && row.confidence !== query.confidence) return false;
    if (query.kind && row.kind !== query.kind) return false;
    const data = parse(row.data, {} as Record<string, unknown>);
    if (query.theme) {
      const l = fondL(data);
      if (l === null || (query.theme === "light") !== l > 0.6) return false;
    }
    if (query.typeClass && (row.kind !== "type" || !typeClasses(data).includes(query.typeClass))) return false;
    if (query.componentKind && (row.kind !== "component" || row.subkind !== query.componentKind)) return false;
    return true;
  });

  const libraries: Record<Library | "tableaux", number> = { palettes: 0, typos: 0, composants: 0, ambiances: 0, tableaux: 0 };
  for (const row of filtered) libraries[LIBRARY_OF[row.kind] ?? "ambiances"] += 1;
  libraries.tableaux = (connection.prepare("SELECT COUNT(*) AS n FROM boards WHERE user_id = ?").get(userId) as { n: number }).n;

  let inLibrary = query.library ? filtered.filter((row) => (LIBRARY_OF[row.kind] ?? "ambiances") === query.library) : filtered;
  const noReason = inLibrary.filter((row) => !row.why.trim()).length;
  if (query.noReason) inLibrary = inLibrary.filter((row) => !row.why.trim());

  if (!target) {
    const sort = query.sort ?? "recent";
    if (sort === "source") inLibrary.sort((a, b) => (a.source_host ?? "~").localeCompare(b.source_host ?? "~") || b.created_at.localeCompare(a.created_at));
    if (sort === "hue") inLibrary.sort((a, b) => (accentHue(parse(a.data, {})) ?? 999) - (accentHue(parse(b.data, {})) ?? 999));
    if (sort === "size") inLibrary.sort((a, b) => b.data.length - a.data.length);
  }

  const all = connection.prepare("SELECT DISTINCT source_host FROM items WHERE user_id = ? AND source_host IS NOT NULL ORDER BY source_host").all(userId) as { source_host: string }[];
  const tags = connection.prepare("SELECT DISTINCT t.tag FROM item_tags t JOIN items i ON i.id = t.item_id WHERE i.user_id = ? ORDER BY t.tag").all(userId) as { tag: string }[];
  const kinds = connection.prepare("SELECT DISTINCT subkind FROM items WHERE user_id = ? AND kind = 'component' AND subkind IS NOT NULL ORDER BY subkind").all(userId) as { subkind: string }[];

  return {
    items: inLibrary.slice(0, 500).map((row) => {
      const match = matches.get(row.id);
      return { ...view(connection, row), ...(match ? { match: { hex: match.hex, distance: Math.round(match.distance * 1000) / 1000 } } : {}) };
    }),
    counts: { libraries, noReason, total: filtered.length },
    facets: { hosts: all.map((h) => h.source_host), tags: tags.map((t) => t.tag), componentKinds: kinds.map((k) => k.subkind) },
    mode,
  };
}

/* --------------------------------------------------------------- boards ----- */

export type BoardView = { id: string; name: string; description: string; count: number; covers: string[]; kinds: string[]; usedAt: string | null; createdAt: string };

function boardView(connection: Db, row: { id: string; name: string; description: string; used_at: string | null; created_at: string }): BoardView {
  const members = connection
    .prepare("SELECT i.kind, i.cover, i.data FROM board_items bi JOIN items i ON i.id = bi.item_id WHERE bi.board_id = ? ORDER BY bi.position, bi.added_at")
    .all(row.id) as { kind: string; cover: string | null; data: string }[];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    count: members.length,
    covers: members.map((m) => m.cover).filter((c): c is string => Boolean(c)).slice(0, 4),
    kinds: [...new Set(members.map((m) => m.kind))],
    usedAt: row.used_at,
    createdAt: row.created_at,
  };
}

/** Last used first, then recent: the order the board picker shows (§5.2). */
export function listBoards(userId: string): BoardView[] {
  const connection = db();
  const rows = connection
    .prepare("SELECT id, name, description, used_at, created_at FROM boards WHERE user_id = ? ORDER BY COALESCE(used_at, created_at) DESC")
    .all(userId) as { id: string; name: string; description: string; used_at: string | null; created_at: string }[];
  return rows.map((row) => boardView(connection, row));
}

export function createBoard(userId: string, input: { name?: unknown; description?: unknown; itemIds?: unknown }): BoardView {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
  if (!name) throw new LibraryError(400, "bad_name", "Nommez le tableau.");
  const connection = db();
  return transaction(connection, () => {
    const id = randomUUID();
    const now = new Date().toISOString();
    const position = (connection.prepare("SELECT COUNT(*) AS n FROM boards WHERE user_id = ?").get(userId) as { n: number }).n;
    connection
      .prepare("INSERT INTO boards (id, user_id, name, description, position, used_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, userId, name, typeof input.description === "string" ? input.description.slice(0, 2000) : "", position, now, now, now);
    const ids = Array.isArray(input.itemIds) ? input.itemIds.filter((v): v is string => typeof v === "string") : [];
    if (ids.length) addToBoardIn(connection, userId, id, ids);
    return boardView(connection, connection.prepare("SELECT * FROM boards WHERE id = ?").get(id) as never);
  });
}

function ownedBoard(connection: Db, userId: string, boardId: string): { id: string; name: string; description: string; used_at: string | null; created_at: string } {
  const row = connection.prepare("SELECT id, name, description, used_at, created_at FROM boards WHERE id = ? AND user_id = ?").get(boardId, userId) as
    | { id: string; name: string; description: string; used_at: string | null; created_at: string }
    | undefined;
  if (!row) throw new LibraryError(404, "no_board", "Tableau introuvable.");
  return row;
}

function addToBoardIn(connection: Db, userId: string, boardId: string, itemIds: string[]): number {
  ownedBoard(connection, userId, boardId);
  const now = new Date().toISOString();
  let position = (connection.prepare("SELECT COUNT(*) AS n FROM board_items WHERE board_id = ?").get(boardId) as { n: number }).n;
  let added = 0;
  for (const itemId of itemIds) {
    const owned = connection.prepare("SELECT id FROM items WHERE id = ? AND user_id = ?").get(itemId, userId);
    if (!owned) continue;
    const result = connection.prepare("INSERT OR IGNORE INTO board_items (board_id, item_id, position, added_at) VALUES (?, ?, ?, ?)").run(boardId, itemId, position, now);
    if (Number(result.changes)) {
      position += 1;
      added += 1;
    }
  }
  connection.prepare("UPDATE boards SET used_at = ?, updated_at = ? WHERE id = ?").run(now, now, boardId);
  return added;
}

export function addToBoard(userId: string, boardId: string, itemIds: string[]): number {
  const connection = db();
  return transaction(connection, () => addToBoardIn(connection, userId, boardId, itemIds));
}

export function removeFromBoard(userId: string, boardId: string, itemId: string): void {
  const connection = db();
  ownedBoard(connection, userId, boardId);
  connection.prepare("DELETE FROM board_items WHERE board_id = ? AND item_id = ?").run(boardId, itemId);
}

export function getBoard(userId: string, boardId: string): BoardView & { items: ItemView[] } {
  const connection = db();
  const row = ownedBoard(connection, userId, boardId);
  const items = connection
    .prepare("SELECT i.* FROM board_items bi JOIN items i ON i.id = bi.item_id WHERE bi.board_id = ? ORDER BY bi.position, bi.added_at")
    .all(boardId) as ItemRow[];
  return { ...boardView(connection, row), items: items.map((item) => view(connection, item)) };
}

export function updateBoard(userId: string, boardId: string, patch: { name?: unknown; description?: unknown }): BoardView {
  const connection = db();
  const row = ownedBoard(connection, userId, boardId);
  const name = typeof patch.name === "string" && patch.name.trim() ? patch.name.trim().slice(0, 120) : row.name;
  const description = typeof patch.description === "string" ? patch.description.slice(0, 2000) : row.description;
  connection.prepare("UPDATE boards SET name = ?, description = ?, updated_at = ? WHERE id = ?").run(name, description, new Date().toISOString(), boardId);
  return boardView(connection, ownedBoard(connection, userId, boardId));
}

/** Deleting a board never deletes its items: they stay in their libraries. */
export function deleteBoard(userId: string, boardId: string): void {
  const connection = db();
  ownedBoard(connection, userId, boardId);
  connection.prepare("DELETE FROM boards WHERE id = ?").run(boardId);
}

/** Items of a user, in the order they were kept: the export reads these. */
export function itemsByIds(userId: string, ids: string[]): ItemView[] {
  if (!ids.length) return [];
  const connection = db();
  const rows = connection.prepare(`SELECT * FROM items WHERE user_id = ? AND id IN (${ids.map(() => "?").join(", ")})`).all(userId, ...ids) as ItemRow[];
  return rows.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).map((row) => view(connection, row));
}
