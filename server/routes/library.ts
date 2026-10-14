/**
 * Items, boards, blobs: the HTTP face of `server/library`. Every write goes
 * through the library module; this file only parses requests and checks
 * that the blob asked for belongs to one of the caller's items.
 */

import { createReadStream, statSync } from "node:fs";
import { db } from "../db.ts";
import { HttpError, json, readJson } from "../http.ts";
import type { Route } from "../http.ts";
import { blobPath } from "../library/blobs.ts";
import {
  addToBoard,
  create,
  createBoard,
  deleteBoard,
  getBoard,
  getItem,
  keep,
  listBoards,
  merge,
  remove,
  removeFromBoard,
  search,
  update,
  updateBoard,
} from "../library/index.ts";
import type { SearchQuery } from "../library/index.ts";
import { copyItem } from "../export/tokens.ts";
import type { CopyFormat } from "../export/tokens.ts";

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

export const libraryRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/items",
    auth: true,
    handler({ res, user, url }) {
      const p = url.searchParams;
      const query: SearchQuery = {
        q: p.get("q") ?? undefined,
        library: p.get("library") ?? undefined,
        kind: p.get("kind") ?? undefined,
        board: p.get("board") ?? undefined,
        host: p.get("host") ?? undefined,
        tag: p.get("tag") ?? undefined,
        noReason: p.get("noReason") === "1",
        confidence: p.get("confidence") ?? undefined,
        theme: p.get("theme") === "light" || p.get("theme") === "dark" ? (p.get("theme") as "light" | "dark") : undefined,
        typeClass: p.get("typeClass") ?? undefined,
        componentKind: p.get("componentKind") ?? undefined,
        color: p.get("color") ?? undefined,
        hue: p.has("hue") ? Number(p.get("hue")) : undefined,
        tolerance: p.has("tolerance") ? Math.min(0.3, Math.max(0.005, Number(p.get("tolerance")) || 0.06)) : undefined,
        sort: (["recent", "source", "hue", "size"] as const).find((s) => s === p.get("sort")),
      };
      json(res, 200, search(user.id, query));
    },
  },
  {
    // One tap: `{ findingId }` keeps a finding; `{ kind, title, data }` keeps an Atelier creation.
    method: "POST",
    path: "/api/items",
    auth: true,
    async handler({ req, res, user }) {
      const body = await readJson<{ findingId?: unknown; boardId?: unknown; kind?: unknown; subkind?: unknown; title?: unknown; data?: unknown; why?: unknown; tags?: unknown }>(req);
      const boardId = typeof body.boardId === "string" ? body.boardId : null;
      if (typeof body.findingId === "string") {
        const result = keep(user.id, body.findingId, { boardId });
        json(res, result.already ? 200 : 201, result);
        return;
      }
      if (typeof body.kind !== "string" || typeof body.title !== "string") throw new HttpError(400, "bad_item", "Indiquez une trouvaille, ou un type et un titre.");
      json(res, 201, create(user.id, { kind: body.kind, subkind: typeof body.subkind === "string" ? body.subkind : null, title: body.title, data: body.data, why: typeof body.why === "string" ? body.why : "", tags: body.tags, boardId }));
    },
  },
  {
    method: "POST",
    path: "/api/items/delete",
    auth: true,
    async handler({ req, res, user }) {
      const body = await readJson<{ ids?: unknown }>(req);
      json(res, 200, { removed: remove(user.id, ids(body.ids)) });
    },
  },
  {
    method: "GET",
    path: "/api/items/:id",
    auth: true,
    handler({ res, user, params }) {
      json(res, 200, { item: getItem(user.id, params.id) });
    },
  },
  {
    method: "PATCH",
    path: "/api/items/:id",
    auth: true,
    async handler({ req, res, user, params }) {
      const body = await readJson<{ title?: unknown; why?: unknown; what?: unknown; tags?: unknown; addTags?: unknown }>(req);
      json(res, 200, { item: update(user.id, params.id, body) });
    },
  },
  {
    method: "DELETE",
    path: "/api/items/:id",
    auth: true,
    handler({ res, user, params }) {
      if (!remove(user.id, [params.id])) throw new HttpError(404, "not_found", "Élément introuvable.");
      json(res, 200, { ok: true });
    },
  },
  {
    method: "POST",
    path: "/api/items/:id/merge",
    auth: true,
    async handler({ req, res, user, params }) {
      const body = await readJson<{ with?: unknown }>(req);
      if (typeof body.with !== "string") throw new HttpError(400, "bad_merge", "Indiquez l'élément à fusionner.");
      json(res, 200, { item: merge(user.id, params.id, body.with) });
    },
  },
  {
    method: "GET",
    path: "/api/items/:id/copy",
    auth: true,
    handler({ res, user, params, url }) {
      const format = (["css", "tailwind", "json"] as const).find((f) => f === url.searchParams.get("format")) ?? "css";
      json(res, 200, { format, text: copyItem(getItem(user.id, params.id), format as CopyFormat) });
    },
  },
  {
    method: "GET",
    path: "/api/boards",
    auth: true,
    handler({ res, user }) {
      json(res, 200, { boards: listBoards(user.id) });
    },
  },
  {
    method: "POST",
    path: "/api/boards",
    auth: true,
    async handler({ req, res, user }) {
      json(res, 201, { board: createBoard(user.id, await readJson(req)) });
    },
  },
  {
    method: "GET",
    path: "/api/boards/:id",
    auth: true,
    handler({ res, user, params }) {
      json(res, 200, { board: getBoard(user.id, params.id) });
    },
  },
  {
    method: "PATCH",
    path: "/api/boards/:id",
    auth: true,
    async handler({ req, res, user, params }) {
      json(res, 200, { board: updateBoard(user.id, params.id, await readJson(req)) });
    },
  },
  {
    method: "DELETE",
    path: "/api/boards/:id",
    auth: true,
    handler({ res, user, params }) {
      deleteBoard(user.id, params.id);
      json(res, 200, { ok: true });
    },
  },
  {
    method: "POST",
    path: "/api/boards/:id/items",
    auth: true,
    async handler({ req, res, user, params }) {
      const body = await readJson<{ itemIds?: unknown }>(req);
      json(res, 200, { added: addToBoard(user.id, params.id, ids(body.itemIds)) });
    },
  },
  {
    method: "DELETE",
    path: "/api/boards/:id/items/:itemId",
    auth: true,
    handler({ res, user, params }) {
      removeFromBoard(user.id, params.id, params.itemId);
      json(res, 200, { ok: true });
    },
  },
  {
    // A blob is served only to a user one of whose items owns it.
    method: "GET",
    path: "/blobs/:hash",
    auth: true,
    handler({ res, user, params }) {
      if (!/^[0-9a-f]{64}$/.test(params.hash)) throw new HttpError(400, "bad_hash", "Empreinte invalide.");
      const owned = db()
        .prepare("SELECT 1 FROM items i WHERE i.user_id = ? AND (i.cover = ? OR EXISTS (SELECT 1 FROM json_each(i.media) WHERE json_each.value = ?)) LIMIT 1")
        .get(user.id, params.hash, params.hash);
      const row = db().prepare("SELECT mime FROM blobs WHERE hash = ?").get(params.hash) as { mime: string } | undefined;
      if (!owned || !row) throw new HttpError(404, "not_found", "Fichier introuvable.");
      const path = blobPath(params.hash);
      let size: number;
      try {
        size = statSync(path).size;
      } catch {
        throw new HttpError(404, "not_found", "Fichier introuvable.");
      }
      res.writeHead(200, { "content-type": row.mime, "content-length": size, "cache-control": "private, max-age=31536000, immutable" });
      createReadStream(path).pipe(res);
    },
  },
];
