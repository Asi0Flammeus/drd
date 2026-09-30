/**
 * Content-addressed files that items own (W12): a kept crop is copied here,
 * so deleting the capture it came from never strips an item of its picture.
 *
 * `media/blobs/<ab>/<sha256>`; the row holds the MIME type because the file
 * name carries no extension.
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { extname, join } from "node:path";
import { config } from "../config.ts";
import type { Db } from "../db.ts";

const MIME: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export function blobPath(hash: string): string {
  return join(config.mediaDir, "blobs", hash.slice(0, 2), hash);
}

/** Copies a file into the blob store (once per content) and returns its hash, or null when the file is gone. */
export function storeBlob(connection: Db, source: string): string | null {
  if (!existsSync(source)) return null;
  const bytes = readFileSync(source);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const target = blobPath(hash);
  if (!existsSync(target)) {
    mkdirSync(join(config.mediaDir, "blobs", hash.slice(0, 2)), { recursive: true });
    copyFileSync(source, target);
  }
  connection
    .prepare("INSERT OR IGNORE INTO blobs (hash, mime, width, height, bytes, created_at) VALUES (?, ?, NULL, NULL, ?, ?)")
    .run(hash, MIME[extname(source).toLowerCase()] ?? "application/octet-stream", bytes.length, new Date().toISOString());
  return hash;
}

/** Deletes blobs no item references any more: the store never outgrows the library. */
export function collectBlobs(connection: Db): number {
  const referenced = new Set<string>();
  for (const row of connection.prepare("SELECT cover, media FROM items").all() as { cover: string | null; media: string }[]) {
    if (row.cover) referenced.add(row.cover);
    for (const hash of JSON.parse(row.media) as string[]) referenced.add(hash);
  }
  let removed = 0;
  for (const { hash } of connection.prepare("SELECT hash FROM blobs").all() as { hash: string }[]) {
    if (referenced.has(hash)) continue;
    connection.prepare("DELETE FROM blobs WHERE hash = ?").run(hash);
    rmSync(blobPath(hash), { force: true });
    removed += 1;
  }
  return removed;
}
