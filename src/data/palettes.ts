/**
 * Dimension 2 — colour.
 *
 * Every palette here is traceable to a published source or to a published
 * *method*. Nothing was eyeballed from memory. Where a source ships fewer than
 * twelve steps, the gap is filled by OKLCH interpolation between its own
 * anchors and the palette is flagged `derivation` so the provenance stays
 * visible in the UI.
 *
 * The twelve-step shape and the meaning of each step come from Radix Colors'
 * scale documentation (radix-ui.com/colors/docs/palette-composition/understanding-the-scale):
 * 1–2 surfaces, 3–5 component fills, 6–8 borders, 9–10 solids, 11–12 text.
 * Material 3 contributed the *role* layer on top (surface / on-surface /
 * container / outline), not the values.
 */

import { hexToRgb, oklchToHexInGamut, rgbToHex, rgbToOklch, solveForContrast } from "../color";

export type Accent = {
  soft: string;
  solid: string;
  deep: string;
  onSolid: string;
};

export type Palette = {
  id: string;
  name: string;
  /** Twelve steps, light → dark, Radix step semantics. */
  ramp: string[];
  accent: Accent;
  source: string;
  sourceUrl: string;
  /** The thing this source taught, in one sentence. Shown in the UI. */
  learned: string;
  /** Empty when every value is published verbatim. */
  derivation: string;
};

/** Mix two hexes in OKLCH — used only to fill gaps a source leaves open. */
function mixOklch(aHex: string, bHex: string, t: number): string {
  const a = rgbToOklch(hexToRgb(aHex));
  const b = rgbToOklch(hexToRgb(bHex));
  let dh = b.h - a.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return oklchToHexInGamut({
    l: a.l + (b.l - a.l) * t,
    c: a.c + (b.c - a.c) * t,
    h: a.h + dh * t,
  });
}

/** Rebuilds a 12-step ramp from fewer published anchors, evenly in OKLCH. */
function interpolateRamp(anchors: string[], steps = 12): string[] {
  const out: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    const pos = (i / (steps - 1)) * (anchors.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, anchors.length - 1);
    out.push(lo === hi ? anchors[lo] : mixOklch(anchors[lo], anchors[hi], pos - lo));
  }
  return out;
}

/* --------------------------------------------------- 1. Radix Colors ----- */
// Verbatim from @radix-ui/colors 3.0.0 (sand.css / crimson.css, light theme).
const RADIX_SAND = [
  "#fdfdfc", "#f9f9f8", "#f1f0ef", "#e9e8e6", "#e2e1de", "#dad9d6",
  "#cfceca", "#bcbbb5", "#8d8d86", "#82827c", "#63635e", "#21201c",
];

/* ------------------------------------------------------ 2. Open Color ----- */
// Verbatim from open-color.json (yeun/open-color): white, grape 0–9, black.
const OPEN_GRAPE = [
  "#ffffff", "#f8f0fc", "#f3d9fa", "#eebefa", "#e599f7", "#da77f2",
  "#cc5de8", "#be4bdb", "#ae3ec9", "#9c36b5", "#862e9c", "#000000",
];

/* ----------------------------------------------- 3. Catppuccin Latte ----- */
// Verbatim from catppuccin/palette palette.json — Latte ships exactly twelve
// neutrals in ramp order, which is why it drops in without interpolation.
const LATTE = [
  "#eff1f5", "#e6e9ef", "#dce0e8", "#ccd0da", "#bcc0cc", "#acb0be",
  "#9ca0b0", "#8c8fa1", "#7c7f93", "#6c6f85", "#5c5f77", "#4c4f69",
];

/* ------------------------------------------- 4. Leonardo, contrast-first ----- */
// Not a palette lifted from anywhere: the ratios are the input and the colours
// are solved. Chroma peaks mid-scale so the border steps have colour in them
// and the text steps stay readable.
const LICHEN_TARGETS = [1.03, 1.07, 1.14, 1.24, 1.38, 1.55, 1.8, 2.3, 3.3, 3.9, 5.4, 12.6];
const LICHEN_CHROMA = [0.006, 0.012, 0.02, 0.028, 0.035, 0.042, 0.05, 0.062, 0.085, 0.082, 0.06, 0.03];
const LICHEN_RAMP = LICHEN_TARGETS.map((ratio, i) =>
  solveForContrast("#ffffff", ratio, 168, LICHEN_CHROMA[i]),
);

/* ---------------------------------------------- 5. Rosé Pine Dawn ----- */
// Published anchors from rose-pine/palette palette.json (dawn variant).
const DAWN_ANCHORS = ["#fffaf3", "#faf4ed", "#f2e9e1", "#9893a5", "#797593", "#464261"];

export const PALETTES: Palette[] = [
  {
    id: "radix-sand-crimson",
    name: "Radix · Sand × Crimson",
    ramp: RADIX_SAND,
    accent: {
      soft: "#ffe9f0",
      solid: "#e93d82",
      deep: "#cb1d63",
      onSolid: "#ffffff",
    },
    source: "Radix Colors 3.0.0",
    sourceUrl: "https://www.radix-ui.com/colors",
    learned:
      "A scale is not twelve pretty tints, it is twelve *jobs*: 1–2 page and card surface, " +
      "3–5 component fill / hover / active, 6–8 border soft / normal / strong, 9–10 the solid, " +
      "11–12 low- and high-contrast text. Adopting the jobs is what makes a palette swappable.",
    derivation: "",
  },
  {
    id: "open-color-grape",
    name: "Open Color · Grape × Teal",
    ramp: OPEN_GRAPE,
    accent: {
      soft: "#e6fcf5",
      solid: "#0ca678",
      deep: "#087f5b",
      onSolid: "#ffffff",
    },
    source: "Open Color (yeun/open-color)",
    sourceUrl: "https://yeun.github.io/open-color/",
    learned:
      "Hue-tinted neutrals beat grey: running the surface ramp through grape instead of grey " +
      "makes the whole page read as one decision. Open Color also fixes ten steps per hue and " +
      "refuses a step 11 — a hard stop is a feature, it stops palettes sprawling.",
    derivation: "",
  },
  {
    id: "catppuccin-latte",
    name: "Catppuccin · Latte",
    ramp: LATTE,
    accent: {
      soft: mixOklch(LATTE[0], "#8839ef", 0.14),
      solid: "#8839ef",
      deep: "#7287fd",
      onSolid: "#ffffff",
    },
    source: "catppuccin/palette",
    sourceUrl: "https://github.com/catppuccin/palette",
    learned:
      "Latte names its steps by role, not by number — base, mantle, crust, surface0–2, " +
      "overlay0–2, subtext0–1, text — and that naming is the reason the theme ports to hundreds " +
      "of apps unchanged. Names travel; numbers need a legend.",
    derivation:
      "Accent soft is not published: mixed 14 % mauve into base, in OKLCH. All twelve neutrals are verbatim.",
  },
  {
    id: "leonardo-lichen",
    name: "Leonardo · Lichen (solved)",
    ramp: LICHEN_RAMP,
    accent: {
      soft: solveForContrast("#ffffff", 1.12, 38, 0.04),
      solid: solveForContrast("#ffffff", 4.7, 38, 0.13),
      deep: solveForContrast("#ffffff", 7.2, 38, 0.11),
      onSolid: "#ffffff",
    },
    source: "Adobe Leonardo (leonardocolor.io)",
    sourceUrl: "https://leonardocolor.io/",
    learned:
      "Invert the workflow: state the contrast ratio each step must hit, then solve for the colour " +
      "instead of picking one and auditing it afterwards. Every step of this ramp was computed by " +
      "binary search on OKLCH lightness against white, so it cannot fail its own targets.",
    derivation:
      "Fully generated in-app: target ratios " +
      LICHEN_TARGETS.join(" / ") +
      " against #ffffff, hue 168, chroma peaking mid-scale. Accent hue 38 solved at 1.12 / 4.7 / 7.2.",
  },
  {
    id: "rose-pine-dawn",
    name: "Rosé Pine · Dawn",
    ramp: interpolateRamp(DAWN_ANCHORS),
    accent: {
      soft: mixOklch("#fffaf3", "#286983", 0.1),
      solid: "#286983",
      deep: "#1c4c5f",
      onSolid: "#fffaf3",
    },
    source: "rose-pine/palette (dawn)",
    sourceUrl: "https://rosepinetheme.com/palette",
    learned:
      "Low-contrast can still be accessible if the *text* steps carry the contrast and the " +
      "surface steps stay close together. Dawn ships only six neutrals on purpose — fewer steps, " +
      "less room to pick the wrong one.",
    derivation:
      "Six published anchors (surface, base, overlay, muted, subtle, text) interpolated to twelve " +
      "steps in OKLCH. Accent solid is published `pine`; soft and deep are derived from it.",
  },
];

export const paletteById = (id: string): Palette =>
  PALETTES.find((p) => p.id === id) ?? PALETTES[0];

/**
 * Material 3's contribution to this dimension: a colour is applied through a
 * named *role*, never through its step number. Swap the ramp and every role
 * follows. (m3.material.io/styles/color/roles — "roles are the connective
 * tissue between elements of the UI and what colour goes where".)
 */
export type ColorRoles = {
  surface: string;
  surfaceRaised: string;
  fill: string;
  fillHover: string;
  fillActive: string;
  lineSoft: string;
  line: string;
  lineStrong: string;
  neutralSolid: string;
  neutralSolidHover: string;
  inkDim: string;
  ink: string;
  accentSoft: string;
  accent: string;
  accentDeep: string;
  onAccent: string;
};

export function rolesFor(ramp: string[], accent: Accent): ColorRoles {
  return {
    surface: ramp[0],
    surfaceRaised: ramp[1],
    fill: ramp[2],
    fillHover: ramp[3],
    fillActive: ramp[4],
    lineSoft: ramp[5],
    line: ramp[6],
    lineStrong: ramp[7],
    neutralSolid: ramp[8],
    neutralSolidHover: ramp[9],
    inkDim: ramp[10],
    ink: ramp[11],
    accentSoft: accent.soft,
    accent: accent.solid,
    accentDeep: accent.deep,
    onAccent: accent.onSolid,
  };
}

/** The 3-stop accent is hue-rotated as a unit so it stays one colour. */
export function shiftAccent(accent: Accent, hueShift: number, satScale: number): Accent {
  const apply = (hex: string) => {
    const { l, c, h } = rgbToOklch(hexToRgb(hex));
    return oklchToHexInGamut({ l, c: c * satScale, h: h + hueShift });
  };
  return {
    soft: apply(accent.soft),
    solid: apply(accent.solid),
    deep: apply(accent.deep),
    // Kept literal: a text-on-solid colour must not drift with a hue slider.
    onSolid: rgbToHex(hexToRgb(accent.onSolid)),
  };
}
