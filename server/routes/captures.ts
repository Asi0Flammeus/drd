import { rmSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db.ts";
import { config } from "../config.ts";
import { HttpError, json, readJson, serveFile } from "../http.ts";
import type { Route } from "../http.ts";
import { guardUrl, parseUserUrl } from "../capture/url-guard.ts";
import { requestCapture } from "../capture/runner.ts";
import { analyseCapture, isAnalysing } from "../analyse/job.ts";
import { ANALYSIS_VERSION } from "../analyse/index.ts";

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
  stage: string | null;
  retry_of: string | null;
  artifacts: number;
};

type AnalysisRow = { id: string; capture_id: string; version: number; status: string; partial: number; error: string | null; finished_at: string | null };

function analysisOf(captureId: string): AnalysisRow | undefined {
  return db()
    .prepare("SELECT id, capture_id, version, status, partial, error, finished_at FROM analyses WHERE capture_id = ? ORDER BY version DESC, created_at DESC LIMIT 1")
    .get(captureId) as AnalysisRow | undefined;
}

export function captureSummary(row: CaptureRow): Record<string, unknown> {
  let meta: { meta?: Record<string, string>; page?: unknown } = {};
  try {
    meta = JSON.parse(row.meta);
  } catch {
    meta = {};
  }
  const analysis = analysisOf(row.id);
  let counts: { colors: number; styles: number; components: number } | null = null;
  if (analysis?.status === "done") {
    const rows = db().prepare("SELECT kind, subkind, data FROM findings WHERE analysis_id = ?").all(analysis.id) as { kind: string; subkind: string | null; data: string }[];
    const palette = rows.find((r) => r.kind === "palette" && r.subkind === "interface");
    const scale = rows.find((r) => r.kind === "type" && r.subkind === "scale");
    counts = {
      colors: palette ? (JSON.parse(palette.data) as { colors: unknown[] }).colors.length : 0,
      styles: scale ? (JSON.parse(scale.data) as { styles: unknown[] }).styles.length : 0,
      components: rows.filter((r) => r.kind === "component").reduce((sum, r) => sum + ((JSON.parse(r.data) as { count?: number }).count ?? 1), 0),
    };
  }
  return {
    id: row.id,
    requestedUrl: row.requested_url,
    finalUrl: row.final_url,
    host: row.host,
    title: row.title,
    siteName: meta.meta?.siteName ?? "",
    description: row.description,
    status: row.status,
    stage: row.stage,
    retryOf: row.retry_of,
    artifacts: row.artifacts,
    error: row.error,
    width: row.width,
    height: row.height,
    screenshot: row.screenshot ? `/media/${row.id}/${row.screenshot}` : null,
    analysis: analysis
      ? { id: analysis.id, version: analysis.version, status: isAnalysing(row.id) ? "running" : analysis.status, partial: Boolean(analysis.partial), error: analysis.error, finishedAt: analysis.finished_at }
      : null,
    counts,
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

/** Same page, whatever the scheme case, trailing slash, query or fragment. */
export function normalisedUrl(url: URL): string {
  return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "") || ""}`;
}

export async function startCapture(userId: string, rawUrl: unknown, retryOf: string | null = null): Promise<{ id: string }> {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    throw new HttpError(400, "bad_url", "Aucune URL fournie.");
  }
  assertQuota(userId);
  // Fail fast and legibly: the same guard runs again inside the pipeline, but
  // a user who typed a private address deserves the answer now, not a failed
  // capture row 400 ms later.
  const guard = await guardUrl(rawUrl);
  if (!guard.ok) throw new HttpError(400, guard.code, guard.message);
  return requestCapture(userId, guard.url.toString(), retryOf);
}

/** A ready capture of the same page, if one exists (§5.4, "Déjà capturé"). */
export function previousCapture(userId: string, rawUrl: string): { id: string; createdAt: string } | null {
  const url = parseUserUrl(rawUrl);
  if (!url) return null;
  const key = normalisedUrl(url);
  const rows = db()
    .prepare("SELECT id, requested_url, final_url, created_at FROM captures WHERE user_id = ? AND status = 'ready' ORDER BY created_at DESC")
    .all(userId) as { id: string; requested_url: string; final_url: string | null; created_at: string }[];
  for (const row of rows) {
    for (const candidate of [row.requested_url, row.final_url]) {
      const parsed = candidate ? parseUserUrl(candidate) : null;
      if (parsed && normalisedUrl(parsed) === key) return { id: row.id, createdAt: row.created_at };
    }
  }
  return null;
}

function runAnalysis(captureId: string): void {
  analyseCapture(captureId).catch((error) => console.error("[drd] analysis", captureId, error instanceof Error ? error.message : error));
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
      const body = await readJson<{ url?: unknown; force?: unknown }>(req);
      if (typeof body.url === "string" && body.force !== true) {
        const previous = previousCapture(user.id, body.url);
        if (previous) {
          json(res, 409, { error: "already_captured", message: "Déjà capturé.", existing: previous });
          return;
        }
      }
      const created = await startCapture(user.id, body.url);
      json(res, 202, created);
    },
  },
  {
    method: "GET",
    path: "/api/captures/:id",
    auth: true,
    handler({ res, user, params }) {
      const row = db().prepare("SELECT * FROM captures WHERE id = ? AND user_id = ?").get(params.id, user.id) as CaptureRow | undefined;
      if (!row) throw new HttpError(404, "not_found", "Capture introuvable.");
      const analysis = analysisOf(row.id);
      const findings =
        analysis?.status === "done"
          ? (
              db().prepare("SELECT * FROM findings WHERE analysis_id = ? ORDER BY ordinal").all(analysis.id) as {
                id: string;
                kind: string;
                subkind: string | null;
                ordinal: number;
                title: string;
                confidence: string;
                evidence: string;
                data: string;
                media: string;
                locations: string;
                signature: string | null;
              }[]
            ).map((f) => ({
              id: f.id,
              kind: f.kind,
              subkind: f.subkind,
              title: f.title,
              confidence: f.confidence,
              evidence: JSON.parse(f.evidence) as unknown,
              data: JSON.parse(f.data) as unknown,
              media: JSON.parse(f.media) as unknown,
              locations: JSON.parse(f.locations) as unknown,
              signature: f.signature,
            }))
          : [];
      // Kept state: by finding id, or by signature for a finding re-analysed since.
      const kept: Record<string, string> = {};
      const items = db().prepare("SELECT id, finding_id, signature, kind FROM items WHERE user_id = ? AND capture_id = ?").all(user.id, row.id) as {
        id: string;
        finding_id: string | null;
        signature: string | null;
        kind: string;
      }[];
      for (const finding of findings) {
        const item = items.find((i) => i.finding_id === finding.id) ?? items.find((i) => i.signature !== null && i.signature === finding.signature && i.kind === finding.kind);
        if (item) kept[finding.id] = item.id;
      }
      const attempts = db()
        .prepare("SELECT id, status, error, created_at FROM captures WHERE user_id = ? AND (id = ? OR retry_of = ? OR id = ?) ORDER BY created_at")
        .all(user.id, row.retry_of ?? row.id, row.retry_of ?? row.id, row.retry_of ?? "") as { id: string; status: string; error: string | null; created_at: string }[];
      json(res, 200, { capture: captureSummary(row), findings, kept, attempts, analysisVersion: ANALYSIS_VERSION });
    },
  },
  {
    // A new attempt beside the old one: the failed row and its reason stay.
    method: "POST",
    path: "/api/captures/:id/retry",
    auth: true,
    async handler({ res, user, params }) {
      const row = db().prepare("SELECT id, requested_url, retry_of FROM captures WHERE id = ? AND user_id = ?").get(params.id, user.id) as
        | { id: string; requested_url: string; retry_of: string | null }
        | undefined;
      if (!row) throw new HttpError(404, "not_found", "Capture introuvable.");
      json(res, 202, await startCapture(user.id, row.requested_url, row.retry_of ?? row.id));
    },
  },
  {
    // I-26: analysis v2 from what is stored, partial for a version-1 capture.
    method: "POST",
    path: "/api/captures/:id/reanalyse",
    auth: true,
    handler({ res, user, params }) {
      const row = db().prepare("SELECT id, status FROM captures WHERE id = ? AND user_id = ?").get(params.id, user.id) as { id: string; status: string } | undefined;
      if (!row) throw new HttpError(404, "not_found", "Capture introuvable.");
      if (row.status !== "ready") throw new HttpError(409, "not_ready", "Seule une capture réussie peut être analysée.");
      if (isAnalysing(row.id)) throw new HttpError(409, "running", "Analyse déjà en cours.");
      runAnalysis(row.id);
      json(res, 202, { ok: true });
    },
  },
  {
    method: "DELETE",
    path: "/api/captures/:id",
    auth: true,
    handler({ res, user, params }) {
      const result = db().prepare("DELETE FROM captures WHERE id = ? AND user_id = ?").run(params.id, user.id);
      if (Number(result.changes) === 0) throw new HttpError(404, "not_found", "Capture introuvable.");
      // Kept items own copies of their media (W12): the capture's folder can go.
      rmSync(join(config.mediaDir, params.id), { recursive: true, force: true });
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
      if (!/^[\w.-]+$/.test(params.file) || params.file === "artifacts.json") throw new HttpError(400, "bad_path", "Nom de fichier invalide.");
      const served = serveFile(res, config.mediaDir, `${params.captureId}/${params.file}`, true);
      if (!served) throw new HttpError(404, "not_found", "Média introuvable.");
    },
  },
];

export { runAnalysis };
