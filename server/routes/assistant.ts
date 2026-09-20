/**
 * The optional conversational layer.
 *
 * Deliberately thin, and deliberately last: every export in this app is
 * produced by `export/pack.ts` from stored rows, so the assistant can only
 * ever discuss a pack that already exists. If no model is configured the
 * endpoint says so plainly instead of degrading into an apology — the pack is
 * the product, the chat is a convenience.
 */

import { config, llmConfigured } from "../config.ts";
import { HttpError, json, readJson } from "../http.ts";
import type { Route } from "../http.ts";
import { buildPack, loadPackRefs } from "../export/pack.ts";
import { db } from "../db.ts";
import type { PackRow } from "../export/pack.ts";

export const assistantRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/assistant",
    auth: true,
    handler({ res }) {
      json(res, 200, {
        available: llmConfigured(),
        model: llmConfigured() ? config.llm.model : null,
        note: llmConfigured()
          ? "L'assistant commente les packs existants ; il n'en fabrique aucun."
          : "Aucun modèle configuré (DRD_LLM_ENDPOINT / DRD_LLM_MODEL). Les packs d'export fonctionnent sans.",
      });
    },
  },
  {
    method: "POST",
    path: "/api/assistant",
    auth: true,
    async handler({ req, res, user }) {
      if (!llmConfigured()) {
        throw new HttpError(
          501,
          "llm_not_configured",
          "Aucun modèle configuré. Le pack d'export reste disponible et contient déjà le brief complet.",
        );
      }
      const body = await readJson<{ packId?: unknown; question?: unknown }>(req);
      const question = typeof body.question === "string" ? body.question.trim().slice(0, 2000) : "";
      if (!question) throw new HttpError(400, "empty", "Posez une question.");
      if (typeof body.packId !== "string") throw new HttpError(400, "no_pack", "Indiquez le pack à commenter.");

      const row = db().prepare("SELECT * FROM packs WHERE id = ? AND user_id = ?").get(body.packId, user.id) as
        | PackRow
        | undefined;
      if (!row) throw new HttpError(404, "not_found", "Pack introuvable.");
      let refIds: string[] = [];
      try {
        const parsed: unknown = JSON.parse(row.ref_ids);
        if (Array.isArray(parsed)) refIds = parsed.filter((id): id is string => typeof id === "string");
      } catch {
        refIds = [];
      }
      const built = buildPack(row, loadPackRefs(user.id, refIds));
      const grounding = built.entries
        .filter((entry) => entry.name.endsWith(".md") || entry.name.endsWith(".css"))
        .map((entry) => `--- ${entry.name} ---\n${entry.data.toString("utf8")}`)
        .join("\n\n")
        .slice(0, 60_000);

      const response = await fetch(`${config.llm.endpoint.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.llm.apiKey ? { authorization: `Bearer ${config.llm.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.llm.model,
          messages: [
            {
              role: "system",
              content:
                "Tu commentes un pack de références de design déjà constitué. Réponds en français, appuie chaque " +
                "affirmation sur le contenu fourni, et refuse toute demande de reproduire un site source à l'identique.",
            },
            { role: "user", content: `${grounding}\n\nQuestion : ${question}` },
          ],
          temperature: 0.4,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        throw new HttpError(502, "llm_failed", `Le modèle a répondu ${response.status}.`);
      }
      const payload = await response.json();
      let answer = "";
      if (payload && typeof payload === "object" && "choices" in payload && Array.isArray(payload.choices)) {
        const first: unknown = payload.choices[0];
        if (first && typeof first === "object" && "message" in first) {
          const message: unknown = first.message;
          if (message && typeof message === "object" && "content" in message && typeof message.content === "string") {
            answer = message.content;
          }
        }
      }
      if (!answer) throw new HttpError(502, "llm_empty", "Réponse du modèle illisible.");
      json(res, 200, { answer });
    },
  },
];
