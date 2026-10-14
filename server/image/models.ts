import { readFileSync } from "node:fs";
import sharp from "sharp";
import { config, llmConfigured } from "../config.ts";
import { blobPath } from "../library/blobs.ts";
import { completeDerivative, failDerivative, getImageItem, setImageTagAnalysis } from "./index.ts";
import type { ImageTagAnalysis, TagCandidate } from "./index.ts";

export const IMAGE_TAXONOMY = [
  "editorial",
  "photography",
  "illustration",
  "minimal",
  "organic",
  "geometric",
  "warm",
  "cool",
  "high contrast",
  "muted",
  "people",
  "architecture",
  "nature",
  "product",
  "other / insufficient evidence",
] as const;

function contentFrom(payload: unknown): string {
  if (!payload || typeof payload !== "object" || !("choices" in payload) || !Array.isArray(payload.choices)) return "";
  const choice = payload.choices[0];
  if (!choice || typeof choice !== "object" || !("message" in choice)) return "";
  const message = choice.message;
  return message && typeof message === "object" && "content" in message && typeof message.content === "string" ? message.content : "";
}

function jsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("model JSON missing");
  const value: unknown = JSON.parse(text.slice(start, end + 1));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("model JSON invalid");
  return value as Record<string, unknown>;
}

async function chat(endpoint: string, apiKey: string, body: Record<string, unknown>): Promise<{ payload: unknown; model: string }> {
  const response = await fetch(`${endpoint.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`model responded ${response.status}`);
  const payload: unknown = await response.json();
  const model = payload && typeof payload === "object" && "model" in payload && typeof payload.model === "string" ? payload.model : String(body.model ?? "unknown");
  return { payload, model };
}

export async function analyseImageTags(userId: string, itemId: string, bytes: Buffer, mime: string): Promise<void> {
  if (!config.image.visionEndpoint || !config.image.visionModel || !llmConfigured()) {
    setImageTagAnalysis(userId, itemId, {
      status: "unavailable",
      vision: null,
      jev: null,
      candidates: [{ tag: "other / insufficient evidence", probability: 1, status: "suggested", evidence: "Vision and Jev models are not both configured." }],
      error: "Configure the vision model and Jev to analyse semantic tags.",
    });
    return;
  }
  try {
    const visionResult = await chat(config.image.visionEndpoint, config.image.visionApiKey, {
      model: config.image.visionModel,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `Inspect the image. Return JSON only: {"evidence":"bounded visual evidence","candidates":["tag"]}. Candidates must come from this taxonomy: ${IMAGE_TAXONOMY.join(", ")}. Include other / insufficient evidence when the image does not support a specific label.`,
        },
        { role: "user", content: [{ type: "text", text: "Describe only visible design evidence." }, { type: "image_url", image_url: { url: `data:${mime};base64,${bytes.toString("base64")}` } }] },
      ],
    });
    const visionJson = jsonObject(contentFrom(visionResult.payload));
    const evidence = typeof visionJson.evidence === "string" ? visionJson.evidence.slice(0, 4000) : "";
    const allowed = new Set<string>(IMAGE_TAXONOMY);
    const proposed = Array.isArray(visionJson.candidates) ? visionJson.candidates.filter((tag): tag is string => typeof tag === "string" && allowed.has(tag)) : [];
    const candidates = [...new Set([...proposed.slice(0, 8), "other / insufficient evidence"])] as string[];
    const jevResult = await chat(config.llm.endpoint, config.llm.apiKey, {
      model: config.llm.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "You do not see the image. Score only the supplied candidate tags from the supplied textual evidence. Return JSON only: {\"scores\":[{\"tag\":\"...\",\"probability\":0.0,\"evidence\":\"...\"}]}. Never invent a tag.",
        },
        { role: "user", content: JSON.stringify({ evidence, candidates }) },
      ],
    });
    const jevJson = jsonObject(contentFrom(jevResult.payload));
    const rawScores = Array.isArray(jevJson.scores) ? jevJson.scores : [];
    const scores: TagCandidate[] = [];
    for (const value of rawScores) {
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      if (typeof row.tag !== "string" || !candidates.includes(row.tag)) continue;
      scores.push({
        tag: row.tag,
        probability: typeof row.probability === "number" && Number.isFinite(row.probability) ? Math.max(0, Math.min(1, Math.round(row.probability * 100) / 100)) : 0,
        status: "suggested",
        evidence: typeof row.evidence === "string" ? row.evidence.slice(0, 500) : evidence.slice(0, 500),
      });
    }
    for (const tag of candidates) {
      if (!scores.some((candidate) => candidate.tag === tag)) scores.push({ tag, probability: 0, status: "suggested", evidence: evidence.slice(0, 500) });
    }
    const analysis: ImageTagAnalysis = {
      status: "ready",
      vision: { model: config.image.visionModel, version: visionResult.model, evidence },
      jev: { model: config.llm.model, version: jevResult.model },
      candidates: scores.sort((a, b) => b.probability - a.probability),
    };
    setImageTagAnalysis(userId, itemId, analysis);
  } catch (error) {
    setImageTagAnalysis(userId, itemId, {
      status: "failed",
      vision: { model: config.image.visionModel, version: config.image.visionModel, evidence: "" },
      jev: { model: config.llm.model, version: config.llm.model },
      candidates: [{ tag: "other / insufficient evidence", probability: 1, status: "suggested", evidence: "The model pipeline did not return usable evidence." }],
      error: error instanceof Error ? error.message.slice(0, 500) : "model pipeline failed",
    });
  }
}

export function queueImageTagAnalysis(userId: string, itemId: string, bytes: Buffer, mime: string): void {
  void analyseImageTags(userId, itemId, bytes, mime).catch((error) => console.error("[drd] image tag analysis", itemId, error));
}

export async function generateDerivative(userId: string, itemId: string): Promise<void> {
  const item = getImageItem(userId, itemId);
  const data = item.data as { generation?: { parentId?: string; prompt?: string } };
  if (!data.generation?.parentId || !data.generation.prompt) throw new Error("generation metadata missing");
  if (!config.image.generationEndpoint || !config.image.generationModel) {
    failDerivative(userId, itemId, "Aucun modèle de génération d'image configuré.");
    return;
  }
  try {
    const parent = getImageItem(userId, data.generation.parentId);
    if (!parent.cover) throw new Error("source image missing");
    const source = readFileSync(blobPath(parent.cover));
    const form = new FormData();
    form.set("model", config.image.generationModel);
    form.set("prompt", data.generation.prompt);
    form.set("response_format", "b64_json");
    form.set("image", new Blob([source], { type: String((parent.data as { mime?: unknown }).mime ?? "image/png") }), "source-image");
    const response = await fetch(`${config.image.generationEndpoint.replace(/\/$/, "")}/images/edits`, {
      method: "POST",
      headers: config.image.generationApiKey ? { authorization: `Bearer ${config.image.generationApiKey}` } : {},
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`generation model responded ${response.status}`);
    const payload: unknown = await response.json();
    const first = payload && typeof payload === "object" && "data" in payload && Array.isArray(payload.data) ? payload.data[0] : null;
    if (!first || typeof first !== "object" || !("b64_json" in first) || typeof first.b64_json !== "string") throw new Error("generation image missing");
    const bytes = Buffer.from(first.b64_json, "base64");
    const metadata = await sharp(bytes, { limitInputPixels: config.image.maxPixels }).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (!width || !height || width * height > config.image.maxPixels || width > config.image.maxDimension || height > config.image.maxDimension) throw new Error("generated image dimensions refused");
    const mime = metadata.format === "jpeg" ? "image/jpeg" : metadata.format === "webp" ? "image/webp" : metadata.format === "avif" || metadata.format === "heif" ? "image/avif" : metadata.format === "png" ? "image/png" : "";
    if (!mime) throw new Error("generated image format refused");
    const version = payload && typeof payload === "object" && "model" in payload && typeof payload.model === "string" ? payload.model : config.image.generationModel;
    await completeDerivative(userId, itemId, bytes, mime, width, height, version);
  } catch (error) {
    failDerivative(userId, itemId, error instanceof Error ? error.message : "generation failed");
  }
}

export function queueDerivativeGeneration(userId: string, itemId: string): void {
  void generateDerivative(userId, itemId).catch((error) => console.error("[drd] image generation", itemId, error));
}
