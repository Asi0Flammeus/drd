/**
 * Artifacts on disk → `AnalysisInput`.
 *
 * A version-2 capture has `artifacts.json`. A version-1 capture has only its
 * stitched screenshot and the `capture_elements` rows; from those this
 * builds a *partial* artifact set (pixel palette, mood, component tokens
 * without hover, no text runs, no CDP fonts), marked `partial` so every
 * finding says so until the page is captured again (I-26).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Box, CaptureArtifacts, ColorUsage, ComponentKind, DomComponent, TextRun } from "../capture/artifacts.ts";
import type { AnalysisInput } from "./index.ts";
import { dHash, isUniformImage, loadRaster } from "./pixels.ts";

export type CaptureFiles = {
  dir: string;
  url: string;
  finishedAt: string | null;
  width: number | null;
  height: number | null;
  meta: string;
  elements: { tag: string; label: string; guess: string; x: number; y: number; width: number; height: number; text: string | null; styles: string; crop: string | null }[];
};

export async function loadInput(capture: CaptureFiles): Promise<AnalysisInput> {
  const file = join(capture.dir, "artifacts.json");
  const artifacts = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as CaptureArtifacts) : await fromVersion1(capture);
  const raster = await loadRaster(join(capture.dir, artifacts.media.page));
  const hashes: Record<string, string> = {};
  for (const crop of Object.values(artifacts.media.crops)) {
    try {
      hashes[crop.file] = await dHash(join(capture.dir, crop.file));
    } catch {
      /* unreadable crop: no hash, the component still stands */
    }
  }
  return { artifacts, raster, hashes };
}

const px = (value: string | undefined): number => {
  const n = parseFloat(value ?? "");
  return Number.isFinite(n) ? n : 0;
};

const rgbKey = (value: string | undefined): string | null => {
  const m = /rgba?\(([^)]+)\)/.exec(value ?? "");
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length > 3 && parts[3] < 0.08) return null;
  return parts.slice(0, 3).map((n) => Math.round(n)).join(",");
};

const GUESS_KIND: Record<string, ComponentKind> = { button: "button", nav: "navigation", card: "card", hero: "hero", footer: "footer", form: "form" };

async function fromVersion1(capture: CaptureFiles): Promise<CaptureArtifacts> {
  let meta: { meta?: Record<string, string>; colors?: { hex: string; count: number; role: string }[]; page?: { width: number; height: number; viewportWidth?: number; viewportHeight?: number } } = {};
  try {
    meta = JSON.parse(capture.meta);
  } catch {
    meta = {};
  }
  const width = capture.width ?? meta.page?.width ?? 1280;
  const height = capture.height ?? meta.page?.height ?? 900;

  const colors: ColorUsage[] = (meta.colors ?? []).map((c) => {
    const n = parseInt(c.hex.slice(1), 16);
    const rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    return {
      rgb,
      bgCount: c.role === "background" ? c.count : 0,
      bgArea: 0,
      textArea: c.role === "text" ? c.count : 0,
      textCount: c.role === "text" ? c.count : 0,
      border: c.role === "border" ? c.count * width : 0,
      interactive: 0,
      svg: 0,
      gradient: 0,
      where: {},
      bgBoxes: [],
      textBoxes: [],
      states: {},
    };
  });

  const components: DomComponent[] = [];
  const crops: CaptureArtifacts["media"]["crops"] = {};
  const images: { kind: string; box: Box; alt: string }[] = [];
  const spacing: Record<string, number> = {};
  const shadows: Record<string, number> = {};
  const runs: TextRun[] = [];
  for (const element of capture.elements) {
    let styles: Record<string, string> = {};
    try {
      styles = JSON.parse(element.styles);
    } catch {
      styles = {};
    }
    const box = { x: element.x, y: element.y, width: element.width, height: element.height };
    for (const part of (styles.padding ?? "").split(/\s+/)) {
      const v = px(part);
      if (v > 0 && v <= 256) spacing[String(Math.round(v * 2) / 2)] = (spacing[String(Math.round(v * 2) / 2)] ?? 0) + 1;
    }
    if (styles.boxShadow && styles.boxShadow !== "none") shadows[styles.boxShadow] = (shadows[styles.boxShadow] ?? 0) + 1;
    if (element.guess === "image") {
      images.push({ kind: "img", box, alt: "" });
      continue;
    }
    // Headings and buttons are the only v1 rows whose label is real visible text.
    if ((element.guess === "type" || element.guess === "button") && element.label && styles.fontSize) {
      const size = px(styles.fontSize);
      runs.push({
        text: element.label.slice(0, 80),
        chars: element.label.length,
        tag: element.tag,
        family: styles.fontFamily ?? "",
        size,
        weight: Number(styles.fontWeight) || 400,
        lineHeight: styles.lineHeight === "normal" ? size * 1.2 : px(styles.lineHeight) || size * 1.2,
        tracking: styles.letterSpacing === "normal" ? 0 : px(styles.letterSpacing),
        transform: styles.textTransform ?? "none",
        italic: false,
        variation: "",
        color: rgbKey(styles.color) ?? "0,0,0",
        background: null,
        onImage: false,
        glyph: element.label.length * size * size * 0.5,
        box,
        context: { heading: /^h[1-6]$/.test(element.tag) ? Number(element.tag[1]) : 0, button: element.guess === "button", link: element.tag === "a", nav: false, footer: false, label: false, mono: false, small: false },
        style: [styles.fontFamily, styles.fontWeight, styles.fontSize].join("|"),
      });
    }
    const kind = GUESS_KIND[element.guess];
    if (!kind || !element.crop) continue;
    const cropPath = join(capture.dir, element.crop);
    if (!existsSync(cropPath) || (await isUniformImage(cropPath).catch(() => true))) continue;
    const id = components.length;
    const radius = px(styles.borderRadius);
    const padding = (styles.padding ?? "0 0 0 0").split(/\s+/).map(px);
    components.push({
      id,
      kind: element.tag === "a" && kind === "button" ? "link-button" : kind,
      tag: element.tag,
      name: element.label.slice(0, 80),
      box,
      fixed: false,
      tokens: {
        background: rgbKey(styles.backgroundColor),
        backgroundImage: styles.backgroundImage && styles.backgroundImage !== "none" ? "image" : null,
        color: rgbKey(styles.color),
        borderWidth: px(styles.borderWidth),
        borderStyle: "solid",
        borderColor: px(styles.borderWidth) > 0 ? rgbKey(styles.borderColor) : null,
        radius: [radius, radius, radius, radius],
        padding: [padding[0] ?? 0, padding[1] ?? 0, padding[2] ?? 0, padding[3] ?? 0],
        width: element.width,
        height: element.height,
        gap: px(styles.gap),
        fontFamily: styles.fontFamily ?? "",
        fontSize: px(styles.fontSize),
        fontWeight: Number(styles.fontWeight) || 400,
        lineHeight: styles.lineHeight === "normal" ? null : px(styles.lineHeight),
        letterSpacing: styles.letterSpacing === "normal" ? 0 : px(styles.letterSpacing),
        textTransform: styles.textTransform ?? "none",
        shadow: styles.boxShadow && styles.boxShadow !== "none" ? styles.boxShadow : null,
        transition: null,
      },
      state: null,
    });
    crops[id] = { file: element.crop, scale: 1 };
  }

  return {
    version: 2,
    url: capture.url,
    capturedAt: capture.finishedAt ?? new Date(0).toISOString(),
    partial: true,
    page: { width, height, viewportWidth: meta.page?.viewportWidth ?? 1280, viewportHeight: meta.page?.viewportHeight ?? 900 },
    meta: meta.meta ?? {},
    dom: { colors, runs, textStyles: [], components, images, fixed: [], spacing, widths: {}, columns: {}, shadows },
    darkScheme: false,
    customProperties: [],
    samples: { bg: {}, img: 0, total: 0 },
    fonts: { rendered: [], network: [] },
    hover: [],
    media: { page: "page.jpg", crops, typeCrops: {}, specimens: [] },
  };
}
