/**
 * Colour arithmetic for the analysis: OKLab for every distance, OKLCH for
 * every value a human reads, WCAG 2 for every contrast grade.
 *
 * culori does the conversions a person sees (hex, OKLCH, contrast, gamut
 * clipping). The one hand-written path is `labOfRgb`, the bulk sRGB → OKLab
 * used on ~200 000 pixels per page: a 256-entry linearisation table and the
 * published matrices, because an object per pixel through culori costs
 * seconds for the same numbers.
 */

import { converter, formatHex, wcagContrast } from "culori";
import type { RgbKey } from "../capture/artifacts.ts";

export type Lab = { l: number; a: number; b: number };
export type Oklch = { l: number; c: number; h: number };

const LINEAR = Float64Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/** sRGB bytes → OKLab (Björn Ottosson's matrices). */
export function labOfRgb(r: number, g: number, b: number): Lab {
  const R = LINEAR[r];
  const G = LINEAR[g];
  const B = LINEAR[b];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function rgbOfKey(key: RgbKey): [number, number, number] {
  const [r, g, b] = key.split(",").map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))));
  return [r, g, b];
}

export function labOfKey(key: RgbKey): Lab {
  const [r, g, b] = rgbOfKey(key);
  return labOfRgb(r, g, b);
}

export function oklchOfLab(lab: Lab): Oklch {
  const c = Math.hypot(lab.a, lab.b);
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: round(lab.l, 3), c: round(c, 3), h: c < 0.0005 ? 0 : Math.round(h) % 360 };
}

export function hexOfKey(key: RgbKey): string {
  const [r, g, b] = rgbOfKey(key);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** An OKLab point back to a displayable hex, clipped into sRGB. */
export function hexOfLab(lab: Lab): string {
  return formatHex({ mode: "oklab", l: lab.l, a: lab.a, b: lab.b }) ?? "#000000";
}

export function keyOfHex(hex: string): RgbKey {
  const toRgb = converter("rgb");
  const rgb = toRgb(hex);
  if (!rgb) return "0,0,0";
  return [rgb.r, rgb.g, rgb.b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(",");
}

/** ΔE_OK: Euclidean distance in OKLab, the unit every threshold in §4 uses. */
export function deltaE(x: Lab, y: Lab): number {
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);
}

export function contrast(fg: string, bg: string): number {
  return wcagContrast(fg, bg);
}

export type Grade = "AAA" | "AA" | "AA large" | "fail";

/** WCAG 2.x: large text only earns "AA large" when every run of the pair really is large. */
export function grade(ratio: number, large: boolean): Grade {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3 && large) return "AA large";
  return "fail";
}

export function oklchCss(value: Oklch): string {
  return `oklch(${round(value.l, 3)} ${round(value.c, 3)} ${value.h})`;
}

export function round(value: number, places: number): number {
  const factor = 10 ** places;
  const out = Math.round(value * factor) / factor;
  return Object.is(out, -0) ? 0 : out;
}

/** Hue distance on the circle, in degrees. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
