/**
 * Palette roles on hand-built pages, for the two ways the S9 pass saw a kept
 * palette go wrong (C1): a version-1 capture calling its page background
 * "text", and an accent crowned by chroma alone from a colour nobody sees.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { CaptureArtifacts, ColorUsage, TextRun } from "../server/capture/artifacts.ts";
import { analysePalette } from "../server/analyse/palette.ts";
import type { Raster } from "../server/analyse/pixels.ts";

const WIDTH = 100;

/** A page raster made of horizontal bands: `[rgb, rows]`, top to bottom. */
function raster(bands: [string, number][]): Raster {
  const height = bands.reduce((n, [, rows]) => n + rows, 0);
  const data = new Uint8Array(WIDTH * height * 3);
  let row = 0;
  for (const [rgb, rows] of bands) {
    const [r, g, b] = rgb.split(",").map(Number);
    for (let i = row * WIDTH; i < (row + rows) * WIDTH; i += 1) data.set([r, g, b], i * 3);
    row += rows;
  }
  return { width: WIDTH, height, data, scale: 1 };
}

function usage(rgb: string, fields: Partial<ColorUsage>): ColorUsage {
  return { rgb, bgCount: 0, bgArea: 0, textArea: 0, textCount: 0, border: 0, interactive: 0, svg: 0, gradient: 0, where: {}, bgBoxes: [], textBoxes: [], states: {}, ...fields };
}

function run(color: string, chars: number): TextRun {
  return {
    text: "x".repeat(Math.min(chars, 80)), chars, tag: "p", family: "Inter", size: 16, weight: 400, lineHeight: 24, tracking: 0, transform: "none", italic: false, variation: "",
    color, background: null, onImage: false, glyph: chars * 128, box: { x: 0, y: 0, width: 10, height: 10 },
    context: { heading: 0, button: false, link: false, nav: false, footer: false, label: false, mono: false, small: false }, style: "s",
  };
}

function page(fields: { colors: ColorUsage[]; runs: TextRun[]; samples?: CaptureArtifacts["samples"]; height: number }): CaptureArtifacts {
  return {
    version: 2, url: "https://example.com/", capturedAt: "2026-09-30T00:00:00Z", partial: !fields.samples,
    page: { width: WIDTH, height: fields.height, viewportWidth: WIDTH, viewportHeight: 50 }, meta: {},
    dom: { colors: fields.colors, runs: fields.runs, textStyles: [], components: [], images: [], fixed: [], spacing: {}, widths: {}, columns: {}, shadows: {} },
    darkScheme: false, customProperties: [], samples: fields.samples ?? { bg: {}, img: 0, total: 0 },
    fonts: { rendered: [], network: [] }, hover: [], media: { page: "page.jpg", crops: {}, typeCrops: {}, specimens: [] },
  };
}

test("a version-1 page background v1 counted as text is the Fond, and unused colours are no accent", () => {
  // linear.app as v1 stored it: #08090a (70 % of the pixels) labelled text,
  // pink and orange labelled text by element count but painted nowhere.
  const artifacts = page({
    height: 100,
    colors: [
      usage("8,9,10", { textArea: 30, textCount: 30 }),
      usage("15,16,17", { bgCount: 12 }),
      usage("247,248,248", { textArea: 633, textCount: 633 }),
      usage("247,156,224", { textArea: 41, textCount: 41 }),
      usage("247,191,139", { textArea: 20, textCount: 20 }),
    ],
    runs: [run("247,248,248", 400)],
  });
  const { palette } = analysePalette(artifacts, raster([["8,9,10", 70], ["15,16,17", 20], ["247,248,248", 10]]));
  const role = (key: string) => palette.data.colors.find((c) => c.key === key)?.hex;
  assert.equal(role("background"), "#08090a");
  assert.equal(role("surface"), "#0f1011");
  assert.equal(role("text"), "#f7f8f8");
  assert.equal(role("accent"), undefined, "a colour with no text, surface or pixels is not an accent");
  assert.equal(palette.data.theme, "dark");
});

test("a vivid colour on 0.07 % of the text is not the accent of a page without interactive colour", () => {
  // nematis: #ff0000 on 4 small elements, nothing interactive is chromatic.
  const artifacts = page({
    height: 100,
    samples: { bg: { "33,37,41": 900, "40,48,48": 100 }, img: 0, total: 1000 },
    colors: [usage("255,255,255", { textArea: 1000 }), usage("255,0,0", { textArea: 1 })],
    runs: [run("255,255,255", 1300), run("255,0,0", 1)],
  });
  const { palette } = analysePalette(artifacts, raster([["33,37,41", 90], ["40,48,48", 10]]));
  assert.equal(palette.data.colors.find((c) => c.key === "accent"), undefined);
  assert.equal(palette.data.colors.find((c) => c.key === "background")?.hex, "#212529");
});
