/**
 * Dimension 3 — components and their motion.
 *
 * Six button recipes. Two are house patterns already shipping on alysis sites,
 * two are adapted from Hover.css (ianlunn/Hover.css, MIT) — the sweep and the
 * growing underline — and two are the plain flat/hairline pair every system
 * needs. All six are driven by the same component-token set, so the tweak
 * sliders move every variant at once instead of per-variant hacks.
 *
 * Easing and duration values are Material 3's published motion tokens
 * (m3.material.io/styles/motion/easing-and-duration/tokens-specs). Material
 * contributed the *token structure* — a named easing set plus a short/medium
 * duration ladder — and nothing else; the shapes and shadows below are
 * deliberately not Material's.
 */

export type ButtonVariant = {
  id: string;
  name: string;
  /** Where the recipe comes from. */
  origin: string;
  /** What it is for. */
  use: string;
};

export const VARIANTS: ButtonVariant[] = [
  {
    id: "flat",
    name: "Flat",
    origin: "House pattern — alysis.cat `.btn` (ink fill, opacity on hover, no radius)",
    use: "The default. Reads as a printed block, not a UI chip.",
  },
  {
    id: "hairline",
    name: "Hairline",
    origin: "House pattern — `.btn--ghost` on alysis.cat and L'Entre-Deux",
    use: "Secondary action that must not compete with the primary.",
  },
  {
    id: "offset",
    name: "Offset block",
    origin: "House pattern — website-holy-biem `.btn` (hard 4px shadow, translates on press)",
    use: "Loud, playful brands. Physical: the button visibly moves under the finger.",
  },
  {
    id: "sweep",
    name: "Sweep",
    origin: "Adapted from Hover.css `hvr-sweep-to-right` (ianlunn/Hover.css, MIT)",
    use: "Fill wipes across on hover. Works when the fill colour is the brand.",
  },
  {
    id: "underline",
    name: "Grown underline",
    origin: "Adapted from Hover.css `hvr-underline-from-left` (ianlunn/Hover.css, MIT)",
    use: "Text-level action inside prose, where a filled box would be too heavy.",
  },
  {
    id: "lift",
    name: "Lift",
    origin: "Elevation-on-hover, re-cut with our own shadow ladder instead of Material's",
    use: "Card-like calls to action. The one recipe here that uses a soft shadow.",
  },
];

export type Easing = { id: string; label: string; value: string; token: string };

export const EASINGS: Easing[] = [
  {
    id: "standard",
    label: "Standard",
    value: "cubic-bezier(0.2, 0, 0, 1)",
    token: "md.sys.motion.easing.standard",
  },
  {
    id: "decelerate",
    label: "Emphasised decelerate",
    value: "cubic-bezier(0.05, 0.7, 0.1, 1)",
    token: "md.sys.motion.easing.emphasized.decelerate",
  },
  {
    id: "accelerate",
    label: "Emphasised accelerate",
    value: "cubic-bezier(0.3, 0, 0.8, 0.15)",
    token: "md.sys.motion.easing.emphasized.accelerate",
  },
  {
    id: "overshoot",
    label: "Overshoot",
    value: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    token: "house — website-holy-biem `--ease-bounce`",
  },
  { id: "linear", label: "Linear", value: "linear", token: "none (debug)" },
];

/** M3's duration ladder, used to label whatever the slider lands on. */
const DURATION_TOKENS: [number, string][] = [
  [50, "short1"],
  [100, "short2"],
  [150, "short3"],
  [200, "short4"],
  [250, "medium1"],
  [300, "medium2"],
  [350, "medium3"],
  [400, "medium4"],
  [500, "long2"],
  [600, "long4"],
];

export function nearestDurationToken(ms: number): string {
  let best = DURATION_TOKENS[0];
  for (const entry of DURATION_TOKENS) {
    if (Math.abs(entry[0] - ms) < Math.abs(best[0] - ms)) best = entry;
  }
  const exact = best[0] === ms ? "" : "≈ ";
  return `${exact}md.sys.motion.duration.${best[1]}`;
}

/** Four rungs, not Material's five dp elevations — flatter on purpose. */
export const SHADOW_LADDER = [
  "none",
  "0 1px 2px color-mix(in srgb, var(--pv-ink) 12%, transparent)",
  "0 3px 8px color-mix(in srgb, var(--pv-ink) 14%, transparent)",
  "0 10px 24px -6px color-mix(in srgb, var(--pv-ink) 26%, transparent)",
];

export const easingById = (id: string): Easing =>
  EASINGS.find((e) => e.id === id) ?? EASINGS[0];
