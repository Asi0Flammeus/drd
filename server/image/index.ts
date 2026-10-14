import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { db } from "../db.ts";
import type { Db } from "../db.ts";
import { LibraryError, getItem } from "../library/index.ts";
import type { ItemView } from "../library/index.ts";
import { cleanTags, reindexItem, setTags } from "../library/indexing.ts";
import type { ItemRow } from "../library/indexing.ts";
import { storeBlobBytes } from "../library/blobs.ts";
import type { FetchedImage } from "./fetch.ts";
import { extractImagePalettes, IMAGE_PALETTE_VERSION } from "./palette.ts";
import type { ImagePalette } from "./palette.ts";

export type TagCandidate = {
  tag: string;
  probability: number;
  status: "suggested" | "accepted" | "rejected" | "edited";
  evidence: string;
  editedTag?: string;
};

export type ImageTagAnalysis = {
  status: "pending" | "ready" | "unavailable" | "failed";
  vision: { model: string; version: string; evidence: string } | null;
  jev: { model: string; version: string } | null;
  candidates: TagCandidate[];
  error?: string;
};

type ImageData = {
  assetRole: "original" | "generated-derivative";
  width?: number;
  height?: number;
  mime?: string;
  format?: string;
  contentHash?: string;
  extractorVersion: string;
  palettes: ImagePalette[];
  palette: ImagePalette["colors"];
  tagAnalysis: ImageTagAnalysis;
  generation?: {
    parentId: string;
    prompt: string;
    model: string;
    version: string;
    status: "pending" | "failed" | "complete";
    attempts: number;
    error?: string;
    createdAt: string;
    completedAt?: string;
  };
};

type PersistOptions = { originatingPageUrl?: string | null };

function parse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function imageRow(connection: Db, userId: string, itemId: string): ItemRow {
  const row = connection.prepare("SELECT * FROM items WHERE id = ? AND user_id = ? AND kind = 'mood' AND subkind IN ('image-original', 'image-derivative')").get(itemId, userId) as ItemRow | undefined;
  if (!row) throw new LibraryError(404, "image_not_found", "Référence image introuvable.");
  return row;
}

function titleFor(url: URL): string {
  const file = decodeURIComponent(basename(url.pathname)).replace(/\.(avif|gif|jpe?g|png|webp)$/i, "").trim();
  return (file || url.hostname.replace(/^www\./, "") || "Image").slice(0, 160);
}

function pendingTags(): ImageTagAnalysis {
  return { status: "pending", vision: null, jev: null, candidates: [] };
}

export function getImageItem(userId: string, itemId: string): ItemView {
  imageRow(db(), userId, itemId);
  return getItem(userId, itemId);
}

export async function persistImageReference(userId: string, image: FetchedImage, options: PersistOptions = {}): Promise<{ item: ItemView; already: boolean }> {
  const connection = db();
  const hash = createHash("sha256").update(image.bytes).digest("hex");
  const existing = connection.prepare("SELECT id FROM items WHERE user_id = ? AND subkind = 'image-original' AND signature = ?").get(userId, hash) as { id: string } | undefined;
  if (existing) return { item: getItem(userId, existing.id), already: true };

  const palettes = await extractImagePalettes(image.bytes);
  const blob = storeBlobBytes(connection, image.bytes, image.mime, image.width, image.height);
  const id = randomUUID();
  const now = new Date().toISOString();
  const data: ImageData = {
    assetRole: "original",
    width: image.width,
    height: image.height,
    mime: image.mime,
    format: image.format,
    contentHash: hash,
    extractorVersion: IMAGE_PALETTE_VERSION,
    palettes,
    palette: palettes[0].colors,
    tagAnalysis: pendingTags(),
  };
  const provenance = {
    assetRole: "original",
    generated: false,
    directUrl: image.finalUrl.toString(),
    sourceUrl: image.finalUrl.toString(),
    originatingPageUrl: options.originatingPageUrl ?? null,
    capturedAt: now,
    keptAt: now,
    contentHash: hash,
    custody: "private research copy",
    rights: "Source attribution is preserved. DRD makes no ownership or republication claim.",
  };
  connection
    .prepare(
      `INSERT INTO items (id, user_id, kind, subkind, title, why, what, data, media, cover, capture_id, finding_id,
                          source_url, source_host, confidence, signature, provenance, created_at, updated_at)
       VALUES (?, ?, 'mood', 'image-original', ?, '', '', ?, ?, ?, NULL, NULL, ?, ?, 'sure', ?, ?, ?, ?)`,
    )
    .run(id, userId, titleFor(image.finalUrl), JSON.stringify(data), JSON.stringify([blob]), blob, image.finalUrl.toString(), image.finalUrl.hostname, hash, JSON.stringify(provenance), now, now);
  reindexItem(connection, id);
  return { item: getItem(userId, id), already: false };
}

export function setImageTagAnalysis(userId: string, itemId: string, analysis: ImageTagAnalysis): ItemView {
  const connection = db();
  const row = imageRow(connection, userId, itemId);
  const data = parse<ImageData>(row.data, { assetRole: row.subkind === "image-original" ? "original" : "generated-derivative", extractorVersion: IMAGE_PALETTE_VERSION, palettes: [], palette: [], tagAnalysis: pendingTags() });
  data.tagAnalysis = analysis;
  connection.prepare("UPDATE items SET data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(data), new Date().toISOString(), row.id);
  reindexItem(connection, row.id);
  return getItem(userId, row.id);
}

export function reviewImageTag(userId: string, itemId: string, tag: string, status: "accepted" | "rejected" | "edited", editedTag?: string): ItemView {
  const connection = db();
  const row = imageRow(connection, userId, itemId);
  const data = parse<ImageData>(row.data, { assetRole: "original", extractorVersion: IMAGE_PALETTE_VERSION, palettes: [], palette: [], tagAnalysis: pendingTags() });
  const candidate = data.tagAnalysis.candidates.find((entry) => entry.tag === tag);
  if (!candidate) throw new LibraryError(404, "tag_not_found", "Suggestion introuvable.");
  if (status === "edited") {
    const cleaned = cleanTags([editedTag])[0];
    if (!cleaned) throw new LibraryError(400, "bad_tag", "Indiquez le tag corrigé.");
    candidate.editedTag = cleaned;
  } else {
    delete candidate.editedTag;
  }
  candidate.status = status;
  const accepted = data.tagAnalysis.candidates.flatMap((entry) => entry.status === "accepted" ? [entry.tag] : entry.status === "edited" && entry.editedTag ? [entry.editedTag] : []);
  connection.prepare("UPDATE items SET data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(data), new Date().toISOString(), row.id);
  setTags(connection, row.id, cleanTags(accepted));
  reindexItem(connection, row.id);
  return getItem(userId, row.id);
}

export function createDerivative(userId: string, parentId: string, promptInput: string, model: string): { item: ItemView; already: false } {
  const connection = db();
  const parent = imageRow(connection, userId, parentId);
  const prompt = promptInput.trim().slice(0, 2000);
  if (!prompt) throw new LibraryError(400, "empty_prompt", "Décrivez la variation à générer.");
  const id = randomUUID();
  const now = new Date().toISOString();
  const data: ImageData = {
    assetRole: "generated-derivative",
    extractorVersion: IMAGE_PALETTE_VERSION,
    palettes: [],
    palette: [],
    tagAnalysis: { status: "unavailable", vision: null, jev: null, candidates: [] },
    generation: { parentId, prompt, model, version: "", status: "pending", attempts: 1, createdAt: now },
  };
  const parentProvenance = parse<Record<string, unknown>>(parent.provenance, {});
  const provenance = {
    generated: true,
    assetRole: "generated-derivative",
    parentId,
    sourceContentHash: parent.signature,
    sourceUrl: parent.source_url,
    originatingPageUrl: parentProvenance.originatingPageUrl ?? null,
    createdAt: now,
  };
  connection
    .prepare(
      `INSERT INTO items (id, user_id, kind, subkind, title, why, what, data, media, cover, capture_id, finding_id,
                          source_url, source_host, confidence, signature, provenance, created_at, updated_at)
       VALUES (?, ?, 'mood', 'image-derivative', ?, '', '', ?, '[]', NULL, NULL, NULL, ?, ?, 'check', NULL, ?, ?, ?)`,
    )
    .run(id, userId, `${parent.title} · variation`, JSON.stringify(data), parent.source_url, parent.source_host, JSON.stringify(provenance), now, now);
  reindexItem(connection, id);
  return { item: getItem(userId, id), already: false };
}

export function failDerivative(userId: string, itemId: string, message: string): ItemView {
  const connection = db();
  const row = imageRow(connection, userId, itemId);
  const data = parse<ImageData>(row.data, { assetRole: "generated-derivative", extractorVersion: IMAGE_PALETTE_VERSION, palettes: [], palette: [], tagAnalysis: pendingTags() });
  if (!data.generation || data.generation.status === "complete") return getItem(userId, row.id);
  data.generation.status = "failed";
  data.generation.error = message.slice(0, 500);
  connection.prepare("UPDATE items SET data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(data), new Date().toISOString(), row.id);
  return getItem(userId, row.id);
}

export function retryDerivative(userId: string, itemId: string): { item: ItemView; already: boolean } {
  const connection = db();
  const row = imageRow(connection, userId, itemId);
  const data = parse<ImageData>(row.data, { assetRole: "generated-derivative", extractorVersion: IMAGE_PALETTE_VERSION, palettes: [], palette: [], tagAnalysis: pendingTags() });
  if (!data.generation) throw new LibraryError(409, "not_derivative", "Cet élément n'est pas une image générée.");
  if (data.generation.status === "complete") return { item: getItem(userId, row.id), already: true };
  data.generation.status = "pending";
  data.generation.attempts += 1;
  delete data.generation.error;
  connection.prepare("UPDATE items SET data = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(data), new Date().toISOString(), row.id);
  return { item: getItem(userId, row.id), already: false };
}

export async function completeDerivative(userId: string, itemId: string, bytes: Buffer, mime: string, width: number, height: number, version: string): Promise<ItemView> {
  const connection = db();
  const row = imageRow(connection, userId, itemId);
  const data = parse<ImageData>(row.data, { assetRole: "generated-derivative", extractorVersion: IMAGE_PALETTE_VERSION, palettes: [], palette: [], tagAnalysis: pendingTags() });
  if (!data.generation) throw new LibraryError(409, "not_derivative", "Cet élément n'est pas une image générée.");
  if (data.generation.status === "complete") return getItem(userId, row.id);
  const palettes = await extractImagePalettes(bytes);
  const hash = storeBlobBytes(connection, bytes, mime, width, height);
  data.width = width;
  data.height = height;
  data.mime = mime;
  data.format = mime.replace("image/", "");
  data.contentHash = hash;
  data.palettes = palettes;
  data.palette = palettes[0].colors;
  data.generation.status = "complete";
  data.generation.version = version;
  data.generation.completedAt = new Date().toISOString();
  delete data.generation.error;
  connection.prepare("UPDATE items SET data = ?, media = ?, cover = ?, signature = ?, confidence = 'sure', updated_at = ? WHERE id = ?").run(JSON.stringify(data), JSON.stringify([hash]), hash, hash, new Date().toISOString(), row.id);
  reindexItem(connection, row.id);
  return getItem(userId, row.id);
}
