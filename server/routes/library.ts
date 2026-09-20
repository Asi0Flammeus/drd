/**
 * Collections and references — the part of the app that is the actual output.
 *
 * A reference is only worth keeping if it says where it came from and why it
 * was kept, so provenance is assembled server-side from the capture row rather
 * than trusted from the client, and `why` is a first-class column instead of a
 * note buried in a JSON blob.
 */

import { randomUUID } from "node:crypto";
import { db } from "../db.ts";
import { HttpError, json, readJson } from "../http.ts";
import type { Route } from "../http.ts";

const REF_TYPES = ["site", "component", "font", "palette", "image"];
const MAX_DEPTH = 6;

type CollectionRow = {
  id: string;
  parent_id: string | null;
  name: string;
  kind: string;
  position: number;
  created_at: string;
};

type RefRow = {
  id: string;
  collection_id: string | null;
  type: string;
  title: string;
  capture_id: string | null;
  element_id: string | null;
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

export function refView(row: RefRow): Record<string, unknown> {
  return {
    id: row.id,
    collectionId: row.collection_id,
    type: row.type,
    title: row.title,
    captureId: row.capture_id,
    elementId: row.element_id,
    sourceUrl: row.source_url,
    sourceHost: row.source_host,
    image: row.image ? `/media/${row.image}` : null,
    payload: JSON.parse(row.payload) as unknown,
    provenance: JSON.parse(row.provenance) as unknown,
    what: row.what,
    why: row.why,
    tags: JSON.parse(row.tags) as unknown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function collectionsOf(userId: string): CollectionRow[] {
  return db()
    .prepare("SELECT id, parent_id, name, kind, position, created_at FROM collections WHERE user_id = ? ORDER BY position, created_at")
    .all(userId) as CollectionRow[];
}

function depthOf(rows: CollectionRow[], id: string | null): number {
  let depth = 0;
  let current = id;
  while (current) {
    const row = rows.find((r) => r.id === current);
    if (!row) break;
    depth += 1;
    current = row.parent_id;
  }
  return depth;
}

function assertOwnedCollection(userId: string, collectionId: unknown): string | null {
  if (collectionId === null || collectionId === undefined || collectionId === "") return null;
  if (typeof collectionId !== "string") throw new HttpError(400, "bad_collection", "Collection invalide.");
  const row = db()
    .prepare("SELECT id FROM collections WHERE id = ? AND user_id = ?")
    .get(collectionId, userId) as { id: string } | undefined;
  if (!row) throw new HttpError(404, "no_collection", "Collection introuvable.");
  return row.id;
}

export function inboxId(userId: string): string {
  const row = db()
    .prepare("SELECT id FROM collections WHERE user_id = ? AND kind = 'inbox' ORDER BY created_at LIMIT 1")
    .get(userId) as { id: string } | undefined;
  if (row) return row.id;
  const id = randomUUID();
  db()
    .prepare("INSERT INTO collections (id, user_id, parent_id, name, kind, position, created_at) VALUES (?, ?, NULL, ?, 'inbox', 0, ?)")
    .run(id, userId, "Boîte de réception", new Date().toISOString());
  return id;
}

type RefBody = {
  type?: unknown;
  title?: unknown;
  collectionId?: unknown;
  captureId?: unknown;
  elementId?: unknown;
  what?: unknown;
  why?: unknown;
  tags?: unknown;
  payload?: unknown;
  sourceUrl?: unknown;
};

function stringField(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

export const libraryRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/collections",
    auth: true,
    handler({ res, user }) {
      const rows = collectionsOf(user.id);
      const counts = db()
        .prepare("SELECT collection_id AS id, COUNT(*) AS n FROM refs WHERE user_id = ? GROUP BY collection_id")
        .all(user.id) as { id: string | null; n: number }[];
      const byId: Record<string, number> = {};
      for (const entry of counts) if (entry.id) byId[entry.id] = Number(entry.n);
      json(res, 200, {
        collections: rows.map((row) => ({
          id: row.id,
          parentId: row.parent_id,
          name: row.name,
          kind: row.kind,
          position: row.position,
          count: byId[row.id] ?? 0,
          createdAt: row.created_at,
        })),
      });
    },
  },
  {
    method: "POST",
    path: "/api/collections",
    auth: true,
    async handler({ req, res, user }) {
      const body = await readJson<{ name?: unknown; parentId?: unknown }>(req);
      const name = stringField(body.name);
      if (!name) throw new HttpError(400, "bad_name", "Nommez la collection.");
      const parentId = assertOwnedCollection(user.id, body.parentId);
      const rows = collectionsOf(user.id);
      if (depthOf(rows, parentId) >= MAX_DEPTH) {
        throw new HttpError(400, "too_deep", `Profondeur maximale atteinte (${MAX_DEPTH} niveaux).`);
      }
      const id = randomUUID();
      const position = rows.filter((row) => row.parent_id === parentId).length;
      db()
        .prepare("INSERT INTO collections (id, user_id, parent_id, name, kind, position, created_at) VALUES (?, ?, ?, ?, 'folder', ?, ?)")
        .run(id, user.id, parentId, name.slice(0, 120), position, new Date().toISOString());
      json(res, 201, { id });
    },
  },
  {
    method: "PATCH",
    path: "/api/collections/:id",
    auth: true,
    async handler({ req, res, user, params }) {
      const body = await readJson<{ name?: unknown; parentId?: unknown }>(req);
      const rows = collectionsOf(user.id);
      const target = rows.find((row) => row.id === params.id);
      if (!target) throw new HttpError(404, "not_found", "Collection introuvable.");
      if (body.parentId !== undefined) {
        const parentId = assertOwnedCollection(user.id, body.parentId);
        // A collection cannot become its own ancestor; the tree walk below is
        // the only thing standing between a drag gesture and an orphaned cycle.
        let cursor = parentId;
        while (cursor) {
          if (cursor === target.id) throw new HttpError(400, "cycle", "Une collection ne peut pas être déplacée dans elle-même.");
          cursor = rows.find((row) => row.id === cursor)?.parent_id ?? null;
        }
        db().prepare("UPDATE collections SET parent_id = ? WHERE id = ? AND user_id = ?").run(parentId, target.id, user.id);
      }
      if (body.name !== undefined) {
        const name = stringField(body.name);
        if (!name) throw new HttpError(400, "bad_name", "Nommez la collection.");
        db().prepare("UPDATE collections SET name = ? WHERE id = ? AND user_id = ?").run(name.slice(0, 120), target.id, user.id);
      }
      json(res, 200, { ok: true });
    },
  },
  {
    method: "DELETE",
    path: "/api/collections/:id",
    auth: true,
    handler({ res, user, params }) {
      const row = db().prepare("SELECT kind FROM collections WHERE id = ? AND user_id = ?").get(params.id, user.id) as
        | { kind: string }
        | undefined;
      if (!row) throw new HttpError(404, "not_found", "Collection introuvable.");
      if (row.kind === "inbox") throw new HttpError(400, "protected", "La boîte de réception ne peut pas être supprimée.");
      // References survive their collection: losing the annotation because a
      // folder was tidied away is the one data loss this app cannot afford.
      db().prepare("UPDATE refs SET collection_id = ? WHERE collection_id = ? AND user_id = ?").run(inboxId(user.id), params.id, user.id);
      db().prepare("DELETE FROM collections WHERE id = ? AND user_id = ?").run(params.id, user.id);
      json(res, 200, { ok: true });
    },
  },
  {
    method: "GET",
    path: "/api/refs",
    auth: true,
    handler({ res, user, url }) {
      const collectionId = url.searchParams.get("collectionId");
      const rows = collectionId
        ? (db()
            .prepare("SELECT * FROM refs WHERE user_id = ? AND collection_id = ? ORDER BY created_at DESC")
            .all(user.id, collectionId) as RefRow[])
        : (db().prepare("SELECT * FROM refs WHERE user_id = ? ORDER BY created_at DESC LIMIT 500").all(user.id) as RefRow[]);
      json(res, 200, { refs: rows.map(refView) });
    },
  },
  {
    method: "POST",
    path: "/api/refs",
    auth: true,
    async handler({ req, res, user }) {
      const body = await readJson<RefBody>(req);
      const type = stringField(body.type);
      if (!REF_TYPES.includes(type)) {
        throw new HttpError(400, "bad_type", `Type de référence inconnu. Attendu : ${REF_TYPES.join(", ")}.`);
      }
      const collectionId = assertOwnedCollection(user.id, body.collectionId) ?? inboxId(user.id);
      const now = new Date().toISOString();

      let sourceUrl = stringField(body.sourceUrl) || null;
      let sourceHost: string | null = null;
      let image: string | null = null;
      let captureId: string | null = null;
      let elementId: string | null = null;
      const payload: Record<string, unknown> =
        body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
          ? { ...body.payload }
          : {};
      const provenance: Record<string, unknown> = { savedAt: now };

      if (typeof body.captureId === "string" && body.captureId) {
        const capture = db()
          .prepare("SELECT id, final_url, requested_url, host, title, screenshot, meta, finished_at FROM captures WHERE id = ? AND user_id = ?")
          .get(body.captureId, user.id) as
          | { id: string; final_url: string | null; requested_url: string; host: string; title: string | null; screenshot: string | null; meta: string; finished_at: string | null }
          | undefined;
        if (!capture) throw new HttpError(404, "no_capture", "Capture introuvable.");
        captureId = capture.id;
        sourceUrl = capture.final_url ?? capture.requested_url;
        sourceHost = capture.host;
        image = capture.screenshot ? `${capture.id}/${capture.screenshot}` : null;
        provenance.capturedAt = capture.finished_at;
        provenance.pageTitle = capture.title;
        provenance.extractedBy = "chrome-headless";
        if (type === "site" || type === "palette" || type === "font") {
          try {
            const meta = JSON.parse(capture.meta) as Record<string, unknown>;
            if (payload.colors === undefined && meta.colors) payload.colors = meta.colors;
            if (payload.fonts === undefined && meta.fonts) payload.fonts = meta.fonts;
            if (payload.meta === undefined && meta.meta) payload.meta = meta.meta;
          } catch {
            /* A capture with unreadable meta still makes a usable reference. */
          }
        }
      }

      if (typeof body.elementId === "string" && body.elementId) {
        const element = db()
          .prepare(
            `SELECT e.id, e.selector, e.label, e.guess, e.x, e.y, e.width, e.height, e.styles, e.crop, e.text, e.capture_id
             FROM capture_elements e JOIN captures c ON c.id = e.capture_id
             WHERE e.id = ? AND c.user_id = ?`,
          )
          .get(body.elementId, user.id) as
          | { id: string; selector: string; label: string; guess: string; x: number; y: number; width: number; height: number; styles: string; crop: string | null; text: string | null; capture_id: string }
          | undefined;
        if (!element) throw new HttpError(404, "no_element", "Élément introuvable.");
        if (captureId && element.capture_id !== captureId) {
          throw new HttpError(400, "mismatch", "Cet élément n'appartient pas à cette capture.");
        }
        elementId = element.id;
        captureId = element.capture_id;
        provenance.selector = element.selector;
        provenance.box = { x: element.x, y: element.y, width: element.width, height: element.height };
        provenance.guessedKind = element.guess;
        payload.styles = JSON.parse(element.styles) as Record<string, string>;
        if (element.text) payload.text = element.text;
        if (element.crop) image = `${element.capture_id}/${element.crop}`;
      }

      if (!captureId && !sourceUrl) {
        provenance.source = "playground";
      }

      const tags = Array.isArray(body.tags)
        ? body.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim().toLowerCase()).filter(Boolean).slice(0, 12)
        : [];

      const id = randomUUID();
      db()
        .prepare(
          `INSERT INTO refs (id, user_id, collection_id, type, title, capture_id, element_id, source_url, source_host,
                             image, payload, provenance, what, why, tags, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          user.id,
          collectionId,
          type,
          (stringField(body.title) || "Sans titre").slice(0, 160),
          captureId,
          elementId,
          sourceUrl,
          sourceHost ?? (sourceUrl ? new URL(sourceUrl).hostname : null),
          image,
          JSON.stringify(payload),
          JSON.stringify(provenance),
          stringField(body.what).slice(0, 2000),
          stringField(body.why).slice(0, 2000),
          JSON.stringify(tags),
          now,
          now,
        );

      // A saved reference is the strongest preference signal there is.
      db()
        .prepare("INSERT INTO signals (id, user_id, kind, subject, weight, created_at) VALUES (?, ?, 'saved', ?, 1, ?)")
        .run(randomUUID(), user.id, sourceHost ?? type, now);

      const row = db().prepare("SELECT * FROM refs WHERE id = ?").get(id) as RefRow;
      json(res, 201, { ref: refView(row) });
    },
  },
  {
    method: "PATCH",
    path: "/api/refs/:id",
    auth: true,
    async handler({ req, res, user, params }) {
      const body = await readJson<RefBody>(req);
      const existing = db().prepare("SELECT * FROM refs WHERE id = ? AND user_id = ?").get(params.id, user.id) as
        | RefRow
        | undefined;
      if (!existing) throw new HttpError(404, "not_found", "Référence introuvable.");
      const collectionId =
        body.collectionId === undefined ? existing.collection_id : assertOwnedCollection(user.id, body.collectionId);
      const tags =
        body.tags === undefined
          ? existing.tags
          : JSON.stringify(
              Array.isArray(body.tags)
                ? body.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim().toLowerCase()).filter(Boolean).slice(0, 12)
                : [],
            );
      const type = body.type === undefined ? existing.type : stringField(body.type);
      if (!REF_TYPES.includes(type)) throw new HttpError(400, "bad_type", "Type de référence inconnu.");
      db()
        .prepare(
          `UPDATE refs SET collection_id = ?, type = ?, title = ?, what = ?, why = ?, tags = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`,
        )
        .run(
          collectionId,
          type,
          (body.title === undefined ? existing.title : stringField(body.title) || existing.title).slice(0, 160),
          (body.what === undefined ? existing.what : stringField(body.what)).slice(0, 2000),
          (body.why === undefined ? existing.why : stringField(body.why)).slice(0, 2000),
          tags,
          new Date().toISOString(),
          params.id,
          user.id,
        );
      const row = db().prepare("SELECT * FROM refs WHERE id = ?").get(params.id) as RefRow;
      json(res, 200, { ref: refView(row) });
    },
  },
  {
    method: "DELETE",
    path: "/api/refs/:id",
    auth: true,
    handler({ res, user, params }) {
      const result = db().prepare("DELETE FROM refs WHERE id = ? AND user_id = ?").run(params.id, user.id);
      if (Number(result.changes) === 0) throw new HttpError(404, "not_found", "Référence introuvable.");
      json(res, 200, { ok: true });
    },
  },
];
