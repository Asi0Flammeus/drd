import { randomUUID } from "node:crypto";
import { db } from "../db.ts";
import { HttpError, json } from "../http.ts";
import type { Route } from "../http.ts";
import { providers, refreshCandidates, tasteProfile } from "../discovery/providers.ts";
import { startCapture } from "./captures.ts";

type CandidateRow = {
  id: string;
  url: string;
  host: string;
  score: number;
  reasons: string;
  provider: string;
  from_capture: string | null;
  state: string;
  created_at: string;
};

function candidateView(row: CandidateRow): Record<string, unknown> {
  return {
    id: row.id,
    url: row.url,
    host: row.host,
    score: row.score,
    reasons: JSON.parse(row.reasons) as unknown,
    provider: row.provider,
    fromCapture: row.from_capture,
    state: row.state,
    createdAt: row.created_at,
  };
}

function listCandidates(userId: string): Record<string, unknown>[] {
  const rows = db()
    .prepare("SELECT * FROM candidates WHERE user_id = ? AND state = 'new' ORDER BY score DESC, host LIMIT 40")
    .all(userId) as CandidateRow[];
  return rows.map(candidateView);
}

export const discoveryRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/discovery",
    auth: true,
    handler({ res, user }) {
      const profile = tasteProfile(user.id);
      json(res, 200, {
        candidates: listCandidates(user.id),
        providers: providers.map((provider) => ({
          id: provider.id,
          label: provider.label,
          available: provider.available,
          reason: provider.unavailableReason ?? null,
        })),
        profile: {
          tags: Object.entries(profile.tags).sort((a, b) => b[1] - a[1]).slice(0, 12),
          words: Object.entries(profile.words).sort((a, b) => b[1] - a[1]).slice(0, 12),
          hosts: profile.hosts,
        },
      });
    },
  },
  {
    method: "POST",
    path: "/api/discovery/refresh",
    auth: true,
    async handler({ res, user }) {
      const found = await refreshCandidates(user.id);
      json(res, 200, { found: found.length, candidates: listCandidates(user.id) });
    },
  },
  {
    method: "POST",
    path: "/api/discovery/:id/accept",
    auth: true,
    async handler({ res, user, params }) {
      const row = db().prepare("SELECT * FROM candidates WHERE id = ? AND user_id = ?").get(params.id, user.id) as
        | CandidateRow
        | undefined;
      if (!row) throw new HttpError(404, "not_found", "Suggestion introuvable.");
      const capture = await startCapture(user.id, row.url);
      db().prepare("UPDATE candidates SET state = 'accepted' WHERE id = ?").run(row.id);
      db()
        .prepare("INSERT INTO signals (id, user_id, kind, subject, weight, created_at) VALUES (?, ?, 'accepted', ?, 1, ?)")
        .run(randomUUID(), user.id, row.host, new Date().toISOString());
      json(res, 202, { captureId: capture.id });
    },
  },
  {
    method: "POST",
    path: "/api/discovery/:id/dismiss",
    auth: true,
    handler({ res, user, params }) {
      const result = db()
        .prepare("UPDATE candidates SET state = 'dismissed' WHERE id = ? AND user_id = ?")
        .run(params.id, user.id);
      if (Number(result.changes) === 0) throw new HttpError(404, "not_found", "Suggestion introuvable.");
      const row = db().prepare("SELECT host FROM candidates WHERE id = ?").get(params.id) as { host: string };
      db()
        .prepare("INSERT INTO signals (id, user_id, kind, subject, weight, created_at) VALUES (?, ?, 'dismissed', ?, -1, ?)")
        .run(randomUUID(), user.id, row.host, new Date().toISOString());
      json(res, 200, { ok: true });
    },
  },
];
