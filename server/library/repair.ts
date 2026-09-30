/**
 * Items migrated from version-1 references carried the page screenshot as
 * their only picture. A library item shows the extracted thing itself,
 * isolated (asi0, 30/09): a component its own crop and CSS, a type item a
 * real sample of its glyphs, a palette its bands. This job gives migrated
 * items those pictures, cut from the capture's stored page at the boxes the
 * references recorded, and derives tokens from their computed styles.
 *
 * It runs at start-up, is idempotent (`provenance.repaired`), and never
 * touches the `why`, `what` or tags the user wrote.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { config } from "../config.ts";
import { db } from "../db.ts";
import { hexOfKey } from "../analyse/color.ts";
import { componentCss } from "../analyse/components.ts";
import { COMPONENT_LABEL } from "../analyse/findings.ts";
import type { ComponentTokenView } from "../analyse/findings.ts";
import type { ComponentKind } from "../capture/artifacts.ts";
import { collectBlobs, storeBlob } from "./blobs.ts";
import { reindexItem } from "./indexing.ts";
import type { ItemRow } from "./indexing.ts";

type Box = { x: number; y: number; width: number; height: number };

const GUESS_KIND: Record<string, ComponentKind> = { button: "button", nav: "navigation", card: "card", hero: "hero", footer: "footer", form: "form", type: "heading", grid: "card", section: "card" };

const px = (value: string | undefined): number => {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) ? n : 0;
};

function hexOf(value: string | undefined): string | null {
  const m = /rgba?\(([^)]+)\)/.exec(value ?? "");
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length > 3 && parts[3] < 0.08) return null;
  return hexOfKey(parts.slice(0, 3).join(","));
}

/** Computed style strings of a v1 element → the token view a v2 component has. */
export function tokensFromStyles(styles: Record<string, string>, box: Box): ComponentTokenView {
  const radius = px(styles.borderRadius);
  const padding = (styles.padding ?? "0 0 0 0").split(/\s+/).map(px);
  const border = px(styles.borderWidth);
  const size = px(styles.fontSize);
  return {
    background: hexOf(styles.backgroundColor) ? { hex: hexOf(styles.backgroundColor) as string, role: null } : null,
    foreground: hexOf(styles.color) ? { hex: hexOf(styles.color) as string, role: null } : null,
    border: border > 0 ? { width: border, style: "solid", color: hexOf(styles.borderColor) ? { hex: hexOf(styles.borderColor) as string, role: null } : null } : null,
    radius: [radius, radius, radius, radius],
    padding: [padding[0] ?? 0, padding[1] ?? 0, padding[2] ?? 0, padding[3] ?? 0],
    height: Math.round(box.height),
    width: Math.round(box.width),
    gap: px(styles.gap),
    font: {
      family: styles.fontFamily ?? "",
      size,
      weight: Number(styles.fontWeight) || 400,
      lineHeight: styles.lineHeight === "normal" || !styles.lineHeight ? null : px(styles.lineHeight),
      letterSpacing: styles.letterSpacing === "normal" ? 0 : px(styles.letterSpacing),
      transform: styles.textTransform ?? "none",
    },
    shadow: styles.boxShadow && styles.boxShadow !== "none" ? styles.boxShadow : null,
    transition: null,
  };
}

/** A box of the stitched page, with context, as a WebP blob; null when the page is gone or the region is blank. */
async function cropBlob(captureId: string, box: Box, context: number): Promise<string | null> {
  const page = join(config.mediaDir, captureId, "page.jpg");
  if (!existsSync(page)) return null;
  const meta = await sharp(page, { limitInputPixels: false }).metadata();
  const left = Math.max(0, Math.floor(box.x - context));
  const top = Math.max(0, Math.floor(box.y - context));
  const width = Math.min((meta.width ?? 0) - left, Math.ceil(box.width + 2 * context));
  const height = Math.min((meta.height ?? 0) - top, Math.ceil(box.height + 2 * context), 1600);
  if (width < 8 || height < 8) return null;
  const data = await sharp(page, { limitInputPixels: false }).extract({ left, top, width, height }).webp({ quality: 88 }).toBuffer();
  const stats = await sharp(data).stats();
  if (stats.channels.slice(0, 3).every((c) => c.stdev < 1.5)) return null;
  const dir = mkdtempSync(join(tmpdir(), "drd-repair-"));
  try {
    const file = join(dir, "crop.webp");
    await sharp(data).toFile(file);
    return storeBlob(db(), file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function repairLegacyItems(): Promise<{ repaired: string[] }> {
  const connection = db();
  const rows = connection.prepare("SELECT * FROM items").all() as ItemRow[];
  const repaired: string[] = [];
  for (const row of rows) {
    const provenance = JSON.parse(row.provenance) as Record<string, unknown>;
    if (!provenance.migratedFrom || provenance.repaired || !row.capture_id) continue;
    const data = JSON.parse(row.data) as Record<string, unknown>;
    const migratedImage = String((provenance.migratedFrom as { image?: unknown }).image ?? "");
    const fromPage = migratedImage.endsWith("/page.jpg");
    // The page screenshot leaves the item; an element crop v1 made stays.
    const media = (JSON.parse(row.media) as string[]).filter((hash) => !(fromPage && hash === row.cover));
    let cover: string | null = fromPage ? null : row.cover;

    if (row.kind === "component") {
      const box = provenance.box as Box | undefined;
      const styles = (data.styles ?? {}) as Record<string, string>;
      if (box) {
        const kind = GUESS_KIND[String(provenance.guessedKind ?? "")] ?? "card";
        const crop = cover ?? (await cropBlob(row.capture_id, box, 16));
        const tokens = tokensFromStyles(styles, box);
        data.kind = kind;
        data.kindLabel = COMPONENT_LABEL[kind];
        data.label = typeof data.text === "string" && data.text ? data.text : row.title;
        data.count = 1;
        data.tokens = tokens;
        data.css = componentCss(kind, tokens);
        data.hover = null;
        if (crop) {
          data.crop = `blob:${crop}`;
          cover = crop;
          if (!media.includes(crop)) media.unshift(crop);
        }
        connection.prepare("UPDATE items SET subkind = ? WHERE id = ?").run(kind, row.id);
      }
    }

    if (row.kind === "type") {
      // Real glyphs: the page's own headings and text blocks in the kept families.
      const families = (Array.isArray(data.fonts) ? data.fonts : []).map((f) => String((f as { family?: string }).family ?? "").toLowerCase());
      const elements = connection
        .prepare("SELECT label, x, y, width, height, styles FROM capture_elements WHERE capture_id = ? AND guess IN ('type', 'button') ORDER BY y")
        .all(row.capture_id) as { label: string; x: number; y: number; width: number; height: number; styles: string }[];
      const samples: { family: string; size: number; weight: number; text: string; crop: string }[] = [];
      const seen = new Set<string>();
      for (const element of elements) {
        if (samples.length >= 4) break;
        const styles = JSON.parse(element.styles) as Record<string, string>;
        const family = (styles.fontFamily ?? "").split(",")[0].replace(/["']/g, "").trim();
        const key = `${family}|${styles.fontSize}|${styles.fontWeight}`;
        if (!families.includes(family.toLowerCase()) || seen.has(key) || element.height > 400) continue;
        const crop = await cropBlob(row.capture_id, element, 6);
        if (!crop) continue;
        seen.add(key);
        samples.push({ family, size: px(styles.fontSize), weight: Number(styles.fontWeight) || 400, text: element.label.slice(0, 60), crop: `blob:${crop}` });
        media.unshift(crop);
        cover ??= crop;
      }
      data.samples = samples;
      if (samples[0]) data.family = samples[0].family;
    }

    provenance.repaired = { at: new Date().toISOString(), note: "vignette remplacée par l'élément extrait, isolé" };
    // The page screenshot is never an item's picture: the extracted crop is, or nothing.
    connection
      .prepare("UPDATE items SET data = ?, media = ?, cover = ?, provenance = ? WHERE id = ?")
      .run(JSON.stringify(data), JSON.stringify([...new Set(media)]), cover, JSON.stringify(provenance), row.id);
    reindexItem(connection, row.id);
    repaired.push(row.id);
  }
  if (repaired.length) collectBlobs(connection);
  return { repaired };
}
