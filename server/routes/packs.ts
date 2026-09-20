import { randomUUID } from "node:crypto";
import { db } from "../db.ts";
import { HttpError, json, readJson } from "../http.ts";
import type { Route } from "../http.ts";
import { buildPack, distinctSources, loadPackRefs, packZip } from "../export/pack.ts";
import type { PackRow } from "../export/pack.ts";

function packView(row: PackRow, sources: string[], refCount: number): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    brief: row.brief,
    refIds: JSON.parse(row.ref_ids) as unknown,
    sources,
    refCount,
    createdAt: row.created_at,
  };
}

function loadPack(userId: string, packId: string): PackRow {
  const row = db().prepare("SELECT * FROM packs WHERE id = ? AND user_id = ?").get(packId, userId) as PackRow | undefined;
  if (!row) throw new HttpError(404, "not_found", "Pack introuvable.");
  return row;
}

function refIdsOf(row: PackRow): string[] {
  try {
    const parsed: unknown = JSON.parse(row.ref_ids);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export const packRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/packs",
    auth: true,
    handler({ res, user }) {
      const rows = db().prepare("SELECT * FROM packs WHERE user_id = ? ORDER BY created_at DESC").all(user.id) as PackRow[];
      json(res, 200, {
        packs: rows.map((row) => {
          const refs = loadPackRefs(user.id, refIdsOf(row));
          return packView(row, distinctSources(refs), refs.length);
        }),
      });
    },
  },
  {
    method: "POST",
    path: "/api/packs",
    auth: true,
    async handler({ req, res, user }) {
      const body = await readJson<{ name?: unknown; brief?: unknown; refIds?: unknown; collectionId?: unknown; allowSingleSource?: unknown }>(req);
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : "Pack sans nom";

      let refIds: string[] = Array.isArray(body.refIds)
        ? body.refIds.filter((id): id is string => typeof id === "string")
        : [];
      if (refIds.length === 0 && typeof body.collectionId === "string") {
        refIds = (
          db()
            .prepare("SELECT id FROM refs WHERE user_id = ? AND collection_id = ? ORDER BY created_at")
            .all(user.id, body.collectionId) as { id: string }[]
        ).map((row) => row.id);
      }
      if (refIds.length === 0) throw new HttpError(400, "empty_pack", "Sélectionnez au moins une référence.");

      const refs = loadPackRefs(user.id, refIds);
      if (refs.length === 0) throw new HttpError(404, "no_refs", "Aucune de ces références ne vous appartient.");
      const sources = distinctSources(refs);
      // The rule the whole tool exists for: one source is a copy brief.
      if (sources.length < 2 && body.allowSingleSource !== true) {
        throw new HttpError(
          422,
          "single_source",
          `Toutes les références viennent de ${sources[0]}. Un pack mono-source produit une copie : ajoutez une autre inspiration, ou confirmez explicitement.`,
        );
      }

      const id = randomUUID();
      const created_at = new Date().toISOString();
      db()
        .prepare("INSERT INTO packs (id, user_id, name, brief, ref_ids, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, user.id, name, typeof body.brief === "string" ? body.brief.slice(0, 4000) : "", JSON.stringify(refs.map((ref) => ref.id)), created_at);

      const row: PackRow = { id, user_id: user.id, name, brief: typeof body.brief === "string" ? body.brief.slice(0, 4000) : "", ref_ids: JSON.stringify(refs.map((r) => r.id)), created_at };
      const built = buildPack(row, refs);
      json(res, 201, {
        pack: packView(row, built.sources, built.refCount),
        warnings: built.warnings,
        files: built.entries.map((entry) => entry.name),
      });
    },
  },
  {
    method: "GET",
    path: "/api/packs/:id",
    auth: true,
    handler({ res, user, params }) {
      const row = loadPack(user.id, params.id);
      const refs = loadPackRefs(user.id, refIdsOf(row));
      const built = buildPack(row, refs);
      const readme = built.entries.find((entry) => entry.name === "README.md");
      const prompt = built.entries.find((entry) => entry.name === "prompt.md");
      const tokens = built.entries.find((entry) => entry.name === "tokens.css");
      json(res, 200, {
        pack: packView(row, built.sources, built.refCount),
        warnings: built.warnings,
        files: built.entries.map((entry) => ({ name: entry.name, bytes: entry.data.length })),
        preview: {
          readme: readme?.data.toString("utf8") ?? "",
          prompt: prompt?.data.toString("utf8") ?? "",
          tokens: tokens?.data.toString("utf8") ?? "",
        },
      });
    },
  },
  {
    method: "GET",
    path: "/api/packs/:id/download",
    auth: true,
    handler({ res, user, params }) {
      const row = loadPack(user.id, params.id);
      const built = buildPack(row, loadPackRefs(user.id, refIdsOf(row)));
      const archive = packZip(built);
      const filename = `${row.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pack"}-drd.zip`;
      res.writeHead(200, {
        "content-type": "application/zip",
        "content-length": archive.length,
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      });
      res.end(archive);
    },
  },
  {
    method: "DELETE",
    path: "/api/packs/:id",
    auth: true,
    handler({ res, user, params }) {
      const result = db().prepare("DELETE FROM packs WHERE id = ? AND user_id = ?").run(params.id, user.id);
      if (Number(result.changes) === 0) throw new HttpError(404, "not_found", "Pack introuvable.");
      json(res, 200, { ok: true });
    },
  },
];
