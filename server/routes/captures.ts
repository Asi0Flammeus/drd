import { db } from "../db.ts";
import { config } from "../config.ts";
import { HttpError, json, readJson, serveFile } from "../http.ts";
import type { Route } from "../http.ts";
import { guardUrl } from "../capture/url-guard.ts";
import { requestCapture } from "../capture/runner.ts";

type CaptureRow = {
  id: string;
  requested_url: string;
  final_url: string | null;
  host: string;
  title: string | null;
  description: string | null;
  status: string;
  error: string | null;
  width: number | null;
  height: number | null;
  screenshot: string | null;
  meta: string;
  created_at: string;
  finished_at: string | null;
};

export function captureSummary(row: CaptureRow): Record<string, unknown> {
  let meta: unknown = {};
  try {
    meta = JSON.parse(row.meta);
  } catch {
    meta = {};
  }
  return {
    id: row.id,
    requestedUrl: row.requested_url,
    finalUrl: row.final_url,
    host: row.host,
    title: row.title,
    description: row.description,
    status: row.status,
    error: row.error,
    width: row.width,
    height: row.height,
    screenshot: row.screenshot ? `/media/${row.id}/${row.screenshot}` : null,
    meta,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

/** Rate limit per account: a capture costs a browser, so it is metered per hour. */
function assertQuota(userId: string): void {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const row = db()
    .prepare("SELECT COUNT(*) AS n FROM captures WHERE user_id = ? AND created_at > ?")
    .get(userId, since) as { n: number };
  if (Number(row.n) >= config.capture.perUserPerHour) {
    throw new HttpError(429, "quota", `Limite de ${config.capture.perUserPerHour} captures par heure atteinte.`);
  }
}

export async function startCapture(userId: string, rawUrl: unknown): Promise<{ id: string }> {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    throw new HttpError(400, "bad_url", "Aucune URL fournie.");
  }
  assertQuota(userId);
  // Fail fast and legibly: the same guard runs again inside the pipeline, but
  // a user who typed a private address deserves the answer now, not a failed
  // capture row 400 ms later.
  const guard = await guardUrl(rawUrl);
  if (!guard.ok) throw new HttpError(400, guard.code, guard.message);
  return requestCapture(userId, guard.url.toString());
}

export const captureRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/captures",
    auth: true,
    handler({ res, user, url }) {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 60) || 60, 200);
      const rows = db()
        .prepare("SELECT * FROM captures WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(user.id, limit) as CaptureRow[];
      json(res, 200, { captures: rows.map(captureSummary) });
    },
  },
  {
    method: "POST",
    path: "/api/captures",
    auth: true,
    async handler({ req, res, user }) {
      const body = await readJson<{ url?: unknown }>(req);
      const created = await startCapture(user.id, body.url);
      json(res, 202, created);
    },
  },
  {
    method: "GET",
    path: "/api/captures/:id",
    auth: true,
    handler({ res, user, params }) {
      const row = db().prepare("SELECT * FROM captures WHERE id = ? AND user_id = ?").get(params.id, user.id) as
        | CaptureRow
        | undefined;
      if (!row) throw new HttpError(404, "not_found", "Capture introuvable.");
      const elements = (
        db()
          .prepare("SELECT * FROM capture_elements WHERE capture_id = ? ORDER BY ordinal")
          .all(row.id) as {
          id: string;
          ordinal: number;
          tag: string;
          selector: string;
          label: string;
          guess: string;
          x: number;
          y: number;
          width: number;
          height: number;
          text: string | null;
          styles: string;
          crop: string | null;
        }[]
      ).map((element) => ({
        id: element.id,
        ordinal: element.ordinal,
        tag: element.tag,
        selector: element.selector,
        label: element.label,
        guess: element.guess,
        box: { x: element.x, y: element.y, width: element.width, height: element.height },
        text: element.text,
        styles: JSON.parse(element.styles) as Record<string, string>,
        crop: element.crop ? `/media/${row.id}/${element.crop}` : null,
      }));
      const links = db()
        .prepare("SELECT href, host, anchor, rel, in_footer AS inFooter, credit_like AS creditLike FROM capture_links WHERE capture_id = ? ORDER BY credit_like DESC, in_footer DESC LIMIT 120")
        .all(row.id);
      json(res, 200, { capture: captureSummary(row), elements, links });
    },
  },
  {
    method: "DELETE",
    path: "/api/captures/:id",
    auth: true,
    handler({ res, user, params }) {
      const result = db().prepare("DELETE FROM captures WHERE id = ? AND user_id = ?").run(params.id, user.id);
      if (Number(result.changes) === 0) throw new HttpError(404, "not_found", "Capture introuvable.");
      json(res, 200, { ok: true });
    },
  },
  {
    method: "GET",
    path: "/media/:captureId/:file",
    auth: true,
    handler({ res, user, params }) {
      // Ownership is checked in SQL, not on the filesystem: media paths are
      // guessable, capture ids are the authorisation.
      const owner = db()
        .prepare("SELECT id FROM captures WHERE id = ? AND user_id = ?")
        .get(params.captureId, user.id) as { id: string } | undefined;
      if (!owner) throw new HttpError(404, "not_found", "Média introuvable.");
      if (!/^[\w.-]+$/.test(params.file)) throw new HttpError(400, "bad_path", "Nom de fichier invalide.");
      const served = serveFile(res, config.mediaDir, `${params.captureId}/${params.file}`, true);
      if (!served) throw new HttpError(404, "not_found", "Média introuvable.");
    },
  },
];
