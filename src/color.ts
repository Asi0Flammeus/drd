/**
 * Colour maths. Three spaces, each earning its place:
 *   sRGB hex  — what a client's brand guide hands you, and what the raw editor edits.
 *   HSL       — the hue/saturation handles designers actually reach for.
 *   OKLCH     — the only one of the three where "same L" means "same apparent
 *               lightness", so ramp generation and contrast fixing happen here.
 *
 * WCAG 2 relative luminance is kept for the contrast readout: it is what an
 * audit will measure, whatever we generate the colour in.
 */

export type Rgb = { r: number; g: number; b: number };
export type Hsl = { h: number; s: number; l: number };
export type Oklch = { l: number; c: number; h: number };

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const round = (v: number, places = 3) => {
  const f = 10 ** places;
  return Math.round(v * f) / f;
};

export function hexToRgb(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 0, g: 0, b: 0 };
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const isHex = (value: string) => /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/* ---------------------------------------------------------------- HSL ----- */

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hn = ((h % 360) + 360) % 360;
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = ln - c / 2;
  const seg = Math.floor(hn / 60) % 6;
  const table: [number, number, number][] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const [r1, g1, b1] = table[seg];
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

/* -------------------------------------------------------------- OKLCH ----- */

const toLinear = (v: number) => {
  const n = v / 255;
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
};
const toGamma = (v: number) => {
  const n = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return clamp(n * 255, 0, 255);
};

export function rgbToOklch(rgb: Rgb): Oklch {
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(a, bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

export function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: toGamma(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    g: toGamma(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    b: toGamma(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  };
}

/** Drops chroma until the colour is representable in sRGB — the cheap gamut fix. */
export function oklchToHexInGamut(target: Oklch): string {
  let c = target.c;
  for (let i = 0; i < 24; i += 1) {
    const rgb = oklchToRgb({ ...target, c });
    const back = rgbToOklch(rgb);
    if (Math.abs(back.l - target.l) < 0.01 && Math.abs(back.c - c) < 0.006) return rgbToHex(rgb);
    c *= 0.94;
  }
  return rgbToHex(oklchToRgb({ ...target, c: 0 }));
}

/* ----------------------------------------------------------- contrast ----- */

export function luminance(rgb: Rgb): number {
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

/** WCAG 2.1 contrast ratio, 1–21. */
export function contrast(aHex: string, bHex: string): number {
  const a = luminance(hexToRgb(aHex));
  const b = luminance(hexToRgb(bHex));
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastVerdict = "AAA" | "AA" | "AA-large" | "fail";

export function verdict(ratio: number): ContrastVerdict {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA-large";
  return "fail";
}

/**
 * Leonardo's method (leonardocolor.io, Adobe): you do not pick a colour and then
 * measure it, you state the contrast ratio you need against a background and
 * solve for the colour. Binary search on OKLCH L at a fixed hue/chroma.
 */
export function solveForContrast(
  backgroundHex: string,
  targetRatio: number,
  hue: number,
  chroma: number,
): string {
  const bg = luminance(hexToRgb(backgroundHex));
  const wanted = bg > 0.18 ? (bg + 0.05) / targetRatio - 0.05 : targetRatio * (bg + 0.05) - 0.05;
  let lo = 0;
  let hi = 1;
  let hex = backgroundHex;
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    hex = oklchToHexInGamut({ l: mid, c: chroma, h: hue });
    const lum = luminance(hexToRgb(hex));
    if (lum < wanted) lo = mid;
    else hi = mid;
  }
  return hex;
}
