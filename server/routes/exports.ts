/**
 * Exports: a selection (items, a board, a filtered library) becomes a pack
 * whose rows are stored, so a past export can be downloaded again and gives
 * the same bytes while its items exist.
 */

import { randomUUID } from "node:crypto";
import { db } from "../db.ts";
import { HttpError, json, readJson } from "../http.ts";
import type { Route } from "../http.ts";
import { itemsByIds, search } from "../library/index.ts";
import type { ItemView } from "../library/index.ts";
import { FORMATS, buildPack, packZip } from "../export/pack.ts";
import type { Format } from "../export/pack.ts";
import { slug } from "../export/tokens.ts";

type PackRow = { id: string; user_id: string; name: string; brief: string; item_ids: string; formats: string; source: string; created_at: string };

const parseIds = (raw: string): string[] => {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};

function formatsOf(value: unknown): Format[] {
  const list = Array.isArray(value) ? value.filter((v): v is Format => (FORMATS as readonly string[]).includes(String(v))) : [];
  return list.length ? list : [...FORMATS];
}

type Selection = { itemIds?: unknown; boardId?: unknown; library?: unknown; q?: unknown };

/** The items a selection names: explicit ids, a board's members, or a filtered library. */
function resolve(userId: string, body: Selection): { items: ItemView[]; source: string } {
  if (Array.isArray(body.itemIds) && body.itemIds.length) {
    const items = itemsByIds(userId, body.itemIds.filter((v): v is string => typeof v === "string"));
    return { items, source: `${items.length} élément${items.length > 1 ? "s" : ""} choisi${items.length > 1 ? "s" : ""}` };
  }
  if (typeof body.boardId === "string") {
    const board = db().prepare("SELECT name FROM boards WHERE id = ? AND user_id = ?").get(body.boardId, userId) as { name: string } | undefined;
    if (!board) throw new HttpError(404, "no_board", "Tableau introuvable.");
    const ids = (db().prepare("SELECT item_id FROM board_items WHERE board_id = ? ORDER BY position").all(body.boardId) as { item_id: string }[]).map((r) => r.item_id);
    return { items: itemsByIds(userId, ids), source: `tableau « ${board.name} »` };
  }
  if (typeof body.library === "string") {
    const result = search(userId, { library: body.library, q: typeof body.q === "string" ? body.q : undefined });
    return { items: itemsByIds(userId, result.items.map((i) => i.id)), source: `bibliothèque ${body.library}${typeof body.q === "string" && body.q ? ` · « ${body.q} »` : ""}` };
  }
  throw new HttpError(400, "empty_selection", "Choisissez des éléments, un tableau ou une bibliothèque.");
}

function view(row: PackRow, items: ItemView[]): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    brief: row.brief,
    itemIds: parseIds(row.item_ids),
    formats: parseIds(row.formats),
    source: row.source,
    sources: [...new Set(items.map((i) => i.sourceHost ?? "atelier"))].sort(),
    itemCount: items.length,
    createdAt: row.created_at,
  };
}

function load(userId: string, id: string): PackRow {
  const row = db().prepare("SELECT * FROM packs WHERE id = ? AND user_id = ?").get(id, userId) as PackRow | undefined;
  if (!row) throw new HttpError(404, "not_found", "Export introuvable.");
  return row;
}

function built(row: PackRow) {
  const items = itemsByIds(row.user_id, parseIds(row.item_ids));
  return { items, pack: buildPack({ id: row.id, name: row.name, brief: row.brief, createdAt: row.created_at }, items, formatsOf(parseIds(row.formats)), true) };
}

export const exportRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/exports",
    auth: true,
    handler({ res, user }) {
      const rows = db().prepare("SELECT * FROM packs WHERE user_id = ? ORDER BY created_at DESC").all(user.id) as PackRow[];
      json(res, 200, { exports: rows.map((row) => view(row, itemsByIds(user.id, parseIds(row.item_ids)))) });
    },
  },
  {
    // The wizard's third step: warnings and the file list, nothing saved.
    method: "POST",
    path: "/api/exports/preview",
    auth: true,
    async handler({ req, res, user }) {
      const body = await readJson<Selection & { formats?: unknown; name?: unknown; brief?: unknown; allowSingleSource?: unknown }>(req);
      const { items, source } = resolve(user.id, body);
      const pack = buildPack({ id: "apercu", name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Export", brief: typeof body.brief === "string" ? body.brief : "", createdAt: new Date().toISOString() }, items, formatsOf(body.formats), body.allowSingleSource === true);
      json(res, 200, { warnings: pack.warnings, files: pack.entries.map((e) => ({ name: e.name, bytes: e.data.length })), sources: pack.sources, itemCount: pack.itemCount, source });
    },
  },
  {
    method: "POST",
    path: "/api/exports",
    auth: true,
    async handler({ req, res, user }) {
      const body = await readJson<Selection & { formats?: unknown; name?: unknown; brief?: unknown; allowSingleSource?: unknown }>(req);
      const { items, source } = resolve(user.id, body);
      if (!items.length) throw new HttpError(400, "empty_pack", "Aucun élément dans cette sélection.");
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : "Export sans nom";
      const brief = typeof body.brief === "string" ? body.brief.slice(0, 4000) : "";
      const formats = formatsOf(body.formats);
      const check = buildPack({ id: "check", name, brief, createdAt: new Date().toISOString() }, items, formats, body.allowSingleSource === true);
      const refusal = check.warnings.find((w) => w.level === "refuse");
      if (refusal) throw new HttpError(422, "single_source", refusal.message);
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      db()
        .prepare("INSERT INTO packs (id, user_id, name, brief, item_ids, formats, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, user.id, name, brief, JSON.stringify(items.map((i) => i.id)), JSON.stringify(formats), source, createdAt);
      const row = load(user.id, id);
      const { pack } = built(row);
      json(res, 201, { export: view(row, items), warnings: pack.warnings, files: pack.entries.map((e) => ({ name: e.name, bytes: e.data.length })) });
    },
  },
  {
    method: "GET",
    path: "/api/exports/:id",
    auth: true,
    handler({ res, user, params }) {
      const row = load(user.id, params.id);
      const { items, pack } = built(row);
      const text = (name: string) => pack.entries.find((e) => e.name === name)?.data.toString("utf8") ?? "";
      json(res, 200, {
        export: view(row, items),
        warnings: pack.warnings.filter((w) => w.level !== "refuse"),
        files: pack.entries.map((e) => ({ name: e.name, bytes: e.data.length })),
        preview: { brief: text("BRIEF.md"), design: text("DESIGN.md"), theme: text("theme.css") },
      });
    },
  },
  {
    method: "GET",
    path: "/api/exports/:id/download",
    auth: true,
    handler({ res, user, params }) {
      const row = load(user.id, params.id);
      const archive = packZip(built(row).pack);
      res.writeHead(200, {
        "content-type": "application/zip",
        "content-length": archive.length,
        "content-disposition": `attachment; filename="drd-${slug(row.name, "export")}.zip"`,
        "cache-control": "no-store",
      });
      res.end(archive);
    },
  },
  {
    method: "DELETE",
    path: "/api/exports/:id",
    auth: true,
    handler({ res, user, params }) {
      const result = db().prepare("DELETE FROM packs WHERE id = ? AND user_id = ?").run(params.id, user.id);
      if (Number(result.changes) === 0) throw new HttpError(404, "not_found", "Export introuvable.");
      json(res, 200, { ok: true });
    },
  },
];
