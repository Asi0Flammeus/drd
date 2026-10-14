/**
 * The two derived indexes of an item: its colours in OKLab (for the hue and
 * hex filter) and its full-text row (for search). Both are rebuilt from the
 * item row and its tags, never written independently, so they cannot drift.
 */

import type { Db } from "../db.ts";
import { labOfKey, keyOfHex } from "../analyse/color.ts";

export type ItemRow = {
  id: string;
  user_id: string;
  kind: string;
  subkind: string | null;
  title: string;
  why: string;
  what: string;
  data: string;
  media: string;
  cover: string | null;
  capture_id: string | null;
  finding_id: string | null;
  source_url: string | null;
  source_host: string | null;
  confidence: string | null;
  signature: string | null;
  provenance: string;
  created_at: string;
  updated_at: string;
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Every colour an item carries, with the weight it has in that item. */
export function colorsOf(kind: string, data: Record<string, unknown>): { hex: string; share: number }[] {
  const out: { hex: string; share: number }[] = [];
  const push = (hex: unknown, share: unknown) => {
    if (typeof hex === "string" && HEX.test(hex)) out.push({ hex: hex.toLowerCase(), share: typeof share === "number" && share > 0 ? share : 0.1 });
  };
  const list = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object") : []);
  if (kind === "palette") for (const c of list(data.colors)) push(c.hex, c.share);
  if (kind === "color" && data.color && typeof data.color === "object") {
    const c = data.color as Record<string, unknown>;
    push(c.hex, 1);
  }
  if (kind === "mood") for (const c of list(data.palette)) push(c.hex, c.share);
  if (kind === "component" && data.tokens && typeof data.tokens === "object") {
    const t = data.tokens as Record<string, { hex?: unknown } | null>;
    push(t.background?.hex, 0.6);
    push(t.foreground?.hex, 0.3);
  }
  // Atelier palettes keep the playground's ramp and roles untouched.
  if (Array.isArray(data.ramp)) for (const hex of data.ramp) push(hex, 0.1);
  if (data.roles && typeof data.roles === "object") for (const hex of Object.values(data.roles as Record<string, unknown>)) push(hex, 0.15);
  return out;
}

function words(kind: string, data: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim()) out.push(value);
  };
  const LIBRARY: Record<string, string> = { palette: "palette couleurs", color: "couleur", type: "typographie typo police", component: "composant", scale: "échelle", mood: "ambiance", page: "page site" };
  add(LIBRARY[kind]);
  const walk = (value: unknown, depth: number) => {
    if (depth > 4 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const entry of value.slice(0, 40)) walk(entry, depth + 1);
      return;
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (["role", "family", "generic", "label", "kindLabel", "word", "name", "ratioName", "system", "rule", "hex", "title", "siteName", "description"].includes(key)) add(entry);
      else if (typeof entry === "object") walk(entry, depth + 1);
    }
  };
  walk(data, 0);
  return out;
}

export function reindexItem(connection: Db, itemId: string): void {
  const row = connection.prepare("SELECT * FROM items WHERE id = ?").get(itemId) as ItemRow | undefined;
  connection.prepare("DELETE FROM item_colors WHERE item_id = ?").run(itemId);
  connection.prepare("DELETE FROM items_fts WHERE item_id = ?").run(itemId);
  if (!row) return;
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    data = {};
  }
  const insert = connection.prepare("INSERT INTO item_colors (item_id, l, a, b, share) VALUES (?, ?, ?, ?, ?)");
  for (const color of colorsOf(row.kind, data)) {
    const lab = labOfKey(keyOfHex(color.hex));
    insert.run(itemId, lab.l, lab.a, lab.b, color.share);
  }
  const tags = (connection.prepare("SELECT tag FROM item_tags WHERE item_id = ?").all(itemId) as { tag: string }[]).map((t) => t.tag);
  let provenance: Record<string, unknown> = {};
  try {
    provenance = JSON.parse(row.provenance) as Record<string, unknown>;
  } catch {
    provenance = {};
  }
  const context = Array.isArray(provenance.moodWords) ? (provenance.moodWords as unknown[]).filter((w): w is string => typeof w === "string") : [];
  const body = [row.title, row.why, row.what, tags.join(" "), row.source_host ?? "", ...words(row.kind, data), ...context].join(" \n ");
  connection.prepare("INSERT INTO items_fts (item_id, body) VALUES (?, ?)").run(itemId, body);
}

/** Tags are lower-cased, trimmed, de-duplicated, at most twelve. */
export function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((t): t is string => typeof t === "string").map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
}

export function setTags(connection: Db, itemId: string, tags: string[]): void {
  connection.prepare("DELETE FROM item_tags WHERE item_id = ?").run(itemId);
  const insert = connection.prepare("INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?, ?)");
  for (const tag of tags) insert.run(itemId, tag);
}
