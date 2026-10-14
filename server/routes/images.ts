import { config } from "../config.ts";
import { HttpError, json, readJson } from "../http.ts";
import type { Route } from "../http.ts";
import { createDerivative, persistImageReference, retryDerivative, reviewImageTag } from "../image/index.ts";
import { fetchImageResource } from "../image/fetch.ts";
import { queueDerivativeGeneration, queueImageTagAnalysis } from "../image/models.ts";
import { previousCapture, startCapture } from "./captures.ts";

export async function ingestImageUrl(userId: string, rawUrl: string, originatingPageUrl?: string | null): Promise<
  | { kind: "image"; itemId: string; already: boolean }
  | { kind: "page"; finalUrl: string }
> {
  const fetched = await fetchImageResource(rawUrl);
  if (fetched.kind === "page") return { kind: "page", finalUrl: fetched.finalUrl.toString() };
  const result = await persistImageReference(userId, fetched, { originatingPageUrl });
  if (!result.already) queueImageTagAnalysis(userId, result.item.id, fetched.bytes, fetched.mime);
  return { kind: "image", itemId: result.item.id, already: result.already };
}

export const imageRoutes: Route[] = [
  {
    method: "POST",
    path: "/api/references/from-url",
    auth: true,
    async handler({ req, res, user }) {
      const body = await readJson<{ url?: unknown; originatingPageUrl?: unknown; force?: unknown }>(req);
      if (typeof body.url !== "string" || !body.url.trim()) throw new HttpError(400, "bad_url", "Aucune URL fournie.");
      const result = await ingestImageUrl(user.id, body.url, typeof body.originatingPageUrl === "string" ? body.originatingPageUrl : null);
      if (result.kind === "image") {
        json(res, result.already ? 200 : 201, result);
        return;
      }
      if (body.force !== true) {
        const previous = previousCapture(user.id, result.finalUrl);
        if (previous) {
          json(res, 409, { error: "already_captured", message: "Déjà capturé.", existing: previous });
          return;
        }
      }
      const capture = await startCapture(user.id, result.finalUrl);
      json(res, 202, { kind: "capture", id: capture.id });
    },
  },
  {
    method: "POST",
    path: "/api/items/:id/image-tags",
    auth: true,
    async handler({ req, res, user, params }) {
      const body = await readJson<{ tag?: unknown; status?: unknown; editedTag?: unknown }>(req);
      if (typeof body.tag !== "string" || !["accepted", "rejected", "edited"].includes(String(body.status))) {
        throw new HttpError(400, "bad_review", "Indiquez une suggestion et sa décision.");
      }
      const status = body.status as "accepted" | "rejected" | "edited";
      const item = reviewImageTag(user.id, params.id, body.tag, status, typeof body.editedTag === "string" ? body.editedTag : undefined);
      json(res, 200, { item });
    },
  },
  {
    method: "POST",
    path: "/api/items/:id/derivatives",
    auth: true,
    async handler({ req, res, user, params }) {
      const body = await readJson<{ prompt?: unknown }>(req);
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      const created = createDerivative(user.id, params.id, prompt, config.image.generationModel || "non configuré");
      queueDerivativeGeneration(user.id, created.item.id);
      json(res, 202, created);
    },
  },
  {
    method: "POST",
    path: "/api/items/:id/derivatives/retry",
    auth: true,
    handler({ res, user, params }) {
      const result = retryDerivative(user.id, params.id);
      if (!result.already) queueDerivativeGeneration(user.id, result.item.id);
      json(res, result.already ? 200 : 202, result);
    },
  },
];
