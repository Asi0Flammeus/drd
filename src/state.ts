/**
 * The playground workspace: the three parameter spaces (type, colour,
 * components) and nothing else.
 *
 * Inherited from the design-system R&D bench, with one deliberate change of
 * status. There, the workspace *was* the library and localStorage was the
 * source of truth. Here it is scratch: what survives the playground is saved
 * as a reference on the server, with the same provenance and the same
 * "what / why" as anything captured from a real site. localStorage keeps only
 * the knob positions, so reopening the app resumes mid-thought.
 */

import { hexToRgb, hslToRgb, isHex, oklchToHexInGamut, rgbToHex, rgbToHsl, rgbToOklch } from "./color";
import type { Accent } from "./data/palettes";
import { FAMILIES, familyById } from "./data/fonts";
import { paletteById } from "./data/palettes";

export const STORAGE_KEY = "drd.playground.v1";

export type DimensionId = "type" | "color" | "components";

export type TypeSpec = {
  displayFamily: string;
  bodyFamily: string;
  /**
   * familyId → axisTag → value, kept per family so switching back remembers,
   * and kept separately per ROLE because the same family in a headline and in
   * body copy wants opposite optical sizes.
   */
  displayAxes: Record<string, Record<string, number>>;
  bodyAxes: Record<string, Record<string, number>>;
  displaySize: number;
  displayWeight: number;
  displayTracking: number;
  displayLeading: number;
  bodySize: number;
  bodyWeight: number;
  bodyTracking: number;
  bodyLeading: number;
  sample: string;
};

export type ColorSpec = {
  paletteId: string;
  mode: "raw" | "hsl";
  /** Ramp-wide transforms, applied to the source palette. */
  hueShift: number;
  satScale: number;
  lightSpread: number;
  accentHueShift: number;
  accentSatScale: number;
  /** Per-swatch hex overrides: "0".."11", "accent-soft" | "accent-solid" | "accent-deep" | "accent-on". */
  overrides: Record<string, string>;
  selected: string;
};

export type CompSpec = {
  variantId: string;
  radius: number;
  padX: number;
  padY: number;
  borderWidth: number;
  shadow: number;
  duration: number;
  easingId: string;
  travel: number;
  weight: number;
  tracking: number;
  uppercase: boolean;
};

export type Workspace = {
  version: 1;
  dimension: DimensionId;
  type: TypeSpec;
  color: ColorSpec;
  components: CompSpec;
};

function defaultAxes(role: "display" | "body"): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const family of FAMILIES) {
    const values: Record<string, number> = {};
    for (const a of family.axes) values[a.tag] = a.default;
    if (role === "display") Object.assign(values, family.displayAxes);
    out[family.id] = values;
  }
  return out;
}

export function defaultWorkspace(): Workspace {
  const bricolage = familyById("bricolage");
  return {
    version: 1,
    dimension: "type",
    type: {
      displayFamily: "bricolage",
      bodyFamily: "newsreader",
      displayAxes: defaultAxes("display"),
      bodyAxes: defaultAxes("body"),
      displaySize: bricolage.preset.headingSize,
      displayWeight: bricolage.preset.headingWeight,
      displayTracking: bricolage.preset.headingTracking,
      displayLeading: bricolage.preset.headingLeading,
      bodySize: 18,
      bodyWeight: 400,
      bodyTracking: 0,
      bodyLeading: 1.66,
      sample: "hero",
    },
    color: {
      paletteId: "leonardo-lichen",
      mode: "hsl",
      hueShift: 0,
      satScale: 1,
      lightSpread: 1,
      accentHueShift: 0,
      accentSatScale: 1,
      overrides: {},
      selected: "9",
    },
    components: {
      variantId: "offset",
      radius: 4,
      padX: 26,
      padY: 15,
      borderWidth: 2,
      shadow: 1,
      duration: 150,
      easingId: "standard",
      travel: 3,
      weight: 600,
      tracking: 0.01,
      uppercase: false,
    },
  };
}

export function loadWorkspace(): Workspace {
  const fallback = defaultWorkspace();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Workspace>;
    if (parsed.version !== 1) return fallback;
    return {
      ...fallback,
      ...parsed,
      type: { ...fallback.type, ...parsed.type },
      color: { ...fallback.color, ...parsed.color },
      components: { ...fallback.components, ...parsed.components },
    };
  } catch {
    return fallback;
  }
}

export function saveWorkspace(ws: Workspace): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
  } catch {
    /* Private mode or quota: the session still works, it just will not survive. */
  }
}

/* ----------------------------------------------------- colour resolve ----- */

export type ResolvedPalette = { ramp: string[]; accent: Accent };

/** Applies the ramp-wide OKLCH transform, then any per-swatch hex override. */
export function resolvePalette(spec: ColorSpec): ResolvedPalette {
  const base = paletteById(spec.paletteId);
  const lightnesses = base.ramp.map((hex) => rgbToOklch(hexToRgb(hex)).l);
  const mid = lightnesses.reduce((a, b) => a + b, 0) / lightnesses.length;

  const ramp = base.ramp.map((hex, i) => {
    const override = spec.overrides[String(i)];
    if (override && isHex(override)) return override;
    const { l, c, h } = rgbToOklch(hexToRgb(hex));
    return oklchToHexInGamut({
      l: Math.min(0.995, Math.max(0.02, mid + (l - mid) * spec.lightSpread)),
      c: c * spec.satScale,
      h: h + spec.hueShift,
    });
  });

  const stop = (key: string, hex: string, rotate: boolean) => {
    const override = spec.overrides[key];
    if (override && isHex(override)) return override;
    if (!rotate) return hex;
    const { l, c, h } = rgbToOklch(hexToRgb(hex));
    return oklchToHexInGamut({ l, c: c * spec.accentSatScale, h: h + spec.accentHueShift });
  };

  return {
    ramp,
    accent: {
      soft: stop("accent-soft", base.accent.soft, true),
      solid: stop("accent-solid", base.accent.solid, true),
      deep: stop("accent-deep", base.accent.deep, true),
      onSolid: stop("accent-on", base.accent.onSolid, false),
    },
  };
}

/** Per-swatch HSL editing: read the resolved hex, write back an override. */
export function hslOf(hex: string): { h: number; s: number; l: number } {
  return rgbToHsl(hexToRgb(hex));
}

export function hexFromHsl(h: number, s: number, l: number): string {
  return rgbToHex(hslToRgb({ h, s, l }));
}
