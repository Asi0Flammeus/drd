/**
 * The token layer, in Material's three classes (ref → sys → comp) with our own
 * names and our own values.
 *
 * Everything the previews render is driven from `previewVars`, so a slider
 * writing one custom property is the only mechanism in the app. Export writes
 * the same tree out as CSS custom properties or JSON.
 */

import { contrast, round, verdict } from "./color";
import { easingById, SHADOW_LADDER, VARIANTS } from "./data/components";
import { familyById } from "./data/fonts";
import { paletteById, rolesFor } from "./data/palettes";
import type { ColorRoles } from "./data/palettes";
import { resolvePalette } from "./state";
import type { Workspace } from "./state";

const NS = "drd";

/** `font-variation-settings` value for a family's current axis state. */
export function variationSettings(familyId: string, axes: Record<string, number>): string {
  const family = familyById(familyId);
  const parts = family.axes
    .filter((a) => a.tag !== "wght")
    .map((a) => `"${a.tag}" ${axes[a.tag] ?? a.default}`);
  return parts.length ? parts.join(", ") : "normal";
}

export function currentRoles(ws: Workspace): ColorRoles {
  const { ramp, accent } = resolvePalette(ws.color);
  return rolesFor(ramp, accent);
}

/**
 * Every custom property the preview surfaces consume. Written onto the preview
 * root as inline style, which is why a control can re-render a specimen without
 * touching the DOM it contains.
 */
export function previewVars(ws: Workspace): Record<string, string> {
  const roles = currentRoles(ws);
  const display = familyById(ws.type.displayFamily);
  const body = familyById(ws.type.bodyFamily);
  const easing = easingById(ws.components.easingId);
  const c = ws.components;

  return {
    "--pv-surface": roles.surface,
    "--pv-surface-raised": roles.surfaceRaised,
    "--pv-fill": roles.fill,
    "--pv-fill-hover": roles.fillHover,
    "--pv-fill-active": roles.fillActive,
    "--pv-line-soft": roles.lineSoft,
    "--pv-line": roles.line,
    "--pv-line-strong": roles.lineStrong,
    "--pv-neutral-solid": roles.neutralSolid,
    "--pv-neutral-solid-hover": roles.neutralSolidHover,
    "--pv-ink-dim": roles.inkDim,
    "--pv-ink": roles.ink,
    "--pv-accent-soft": roles.accentSoft,
    "--pv-accent": roles.accent,
    "--pv-accent-deep": roles.accentDeep,
    "--pv-on-accent": roles.onAccent,

    "--pv-display-family": display.stack,
    "--pv-display-axes": variationSettings(ws.type.displayFamily, ws.type.displayAxes[ws.type.displayFamily] ?? {}),
    "--pv-display-size": `${ws.type.displaySize}px`,
    "--pv-display-weight": String(ws.type.displayWeight),
    "--pv-display-tracking": `${ws.type.displayTracking}em`,
    "--pv-display-leading": String(ws.type.displayLeading),

    "--pv-body-family": body.stack,
    "--pv-body-axes": variationSettings(ws.type.bodyFamily, ws.type.bodyAxes[ws.type.bodyFamily] ?? {}),
    "--pv-body-size": `${ws.type.bodySize}px`,
    "--pv-body-weight": String(ws.type.bodyWeight),
    "--pv-body-tracking": `${ws.type.bodyTracking}em`,
    "--pv-body-leading": String(ws.type.bodyLeading),

    "--pv-radius": `${c.radius}px`,
    "--pv-pad-x": `${c.padX}px`,
    "--pv-pad-y": `${c.padY}px`,
    "--pv-border-w": `${c.borderWidth}px`,
    "--pv-shadow": SHADOW_LADDER[Math.min(c.shadow, SHADOW_LADDER.length - 1)],
    "--pv-duration": `${c.duration}ms`,
    "--pv-easing": easing.value,
    "--pv-travel": `${c.travel}px`,
    "--pv-btn-weight": String(c.weight),
    "--pv-btn-tracking": `${c.tracking}em`,
    "--pv-btn-case": c.uppercase ? "uppercase" : "none",
  };
}

export function applyVars(el: HTMLElement, vars: Record<string, string>): void {
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value);
}

/* ------------------------------------------------------------ export ----- */

export type TokenTree = {
  ref: Record<string, string>;
  sys: Record<string, string>;
  comp: Record<string, string>;
};

export function tokenTree(ws: Workspace): TokenTree {
  const { ramp, accent } = resolvePalette(ws.color);
  const palette = paletteById(ws.color.paletteId);
  const display = familyById(ws.type.displayFamily);
  const body = familyById(ws.type.bodyFamily);
  const easing = easingById(ws.components.easingId);
  const variant = VARIANTS.find((v) => v.id === ws.components.variantId) ?? VARIANTS[0];

  const ref: Record<string, string> = {};
  ramp.forEach((hex, i) => {
    ref[`${NS}.ref.palette.step-${i + 1}`] = hex;
  });
  ref[`${NS}.ref.palette.source`] = palette.source;
  ref[`${NS}.ref.accent.soft`] = accent.soft;
  ref[`${NS}.ref.accent.solid`] = accent.solid;
  ref[`${NS}.ref.accent.deep`] = accent.deep;
  ref[`${NS}.ref.accent.on-solid`] = accent.onSolid;
  ref[`${NS}.ref.typeface.display`] = display.name;
  ref[`${NS}.ref.typeface.body`] = body.name;
  ref[`${NS}.ref.motion.easing.${easing.id}`] = easing.value;
  ref[`${NS}.ref.motion.duration`] = `${ws.components.duration}ms`;

  const roleNames: [string, keyof ColorRoles][] = [
    ["surface", "surface"],
    ["surface-raised", "surfaceRaised"],
    ["fill", "fill"],
    ["fill-hover", "fillHover"],
    ["fill-active", "fillActive"],
    ["line-soft", "lineSoft"],
    ["line", "line"],
    ["line-strong", "lineStrong"],
    ["neutral-solid", "neutralSolid"],
    ["neutral-solid-hover", "neutralSolidHover"],
    ["ink-dim", "inkDim"],
    ["ink", "ink"],
    ["accent-soft", "accentSoft"],
    ["accent", "accent"],
    ["accent-deep", "accentDeep"],
    ["on-accent", "onAccent"],
  ];
  const roles = rolesFor(ramp, accent);
  const stepIndex = (hex: string) => ramp.indexOf(hex);

  const sys: Record<string, string> = {};
  for (const [name, key] of roleNames) {
    const value = roles[key];
    const idx = stepIndex(value);
    sys[`${NS}.sys.color.${name}`] =
      idx >= 0 ? `{${NS}.ref.palette.step-${idx + 1}} → ${value}` : value;
  }
  sys[`${NS}.sys.type.display.family`] = `{${NS}.ref.typeface.display}`;
  sys[`${NS}.sys.type.display.size`] = `${ws.type.displaySize}px`;
  sys[`${NS}.sys.type.display.weight`] = String(ws.type.displayWeight);
  sys[`${NS}.sys.type.display.tracking`] = `${ws.type.displayTracking}em`;
  sys[`${NS}.sys.type.display.line-height`] = String(ws.type.displayLeading);
  sys[`${NS}.sys.type.display.axes`] = variationSettings(
    ws.type.displayFamily,
    ws.type.displayAxes[ws.type.displayFamily] ?? {},
  );
  sys[`${NS}.sys.type.body.family`] = `{${NS}.ref.typeface.body}`;
  sys[`${NS}.sys.type.body.size`] = `${ws.type.bodySize}px`;
  sys[`${NS}.sys.type.body.weight`] = String(ws.type.bodyWeight);
  sys[`${NS}.sys.type.body.tracking`] = `${ws.type.bodyTracking}em`;
  sys[`${NS}.sys.type.body.line-height`] = String(ws.type.bodyLeading);
  sys[`${NS}.sys.type.body.axes`] = variationSettings(
    ws.type.bodyFamily,
    ws.type.bodyAxes[ws.type.bodyFamily] ?? {},
  );
  sys[`${NS}.sys.motion.duration`] = `{${NS}.ref.motion.duration}`;
  sys[`${NS}.sys.motion.easing`] = `{${NS}.ref.motion.easing.${easing.id}}`;

  const comp: Record<string, string> = {
    [`${NS}.comp.button.variant`]: variant.id,
    [`${NS}.comp.button.container-color`]: `{${NS}.sys.color.accent}`,
    [`${NS}.comp.button.label-color`]: `{${NS}.sys.color.on-accent}`,
    [`${NS}.comp.button.radius`]: `${ws.components.radius}px`,
    [`${NS}.comp.button.padding`]: `${ws.components.padY}px ${ws.components.padX}px`,
    [`${NS}.comp.button.border-width`]: `${ws.components.borderWidth}px`,
    [`${NS}.comp.button.shadow`]: SHADOW_LADDER[Math.min(ws.components.shadow, 3)],
    [`${NS}.comp.button.press-travel`]: `${ws.components.travel}px`,
    [`${NS}.comp.button.label-weight`]: String(ws.components.weight),
    [`${NS}.comp.button.label-tracking`]: `${ws.components.tracking}em`,
    [`${NS}.comp.button.label-case`]: ws.components.uppercase ? "uppercase" : "none",
    [`${NS}.comp.button.motion-duration`]: `{${NS}.sys.motion.duration}`,
    [`${NS}.comp.button.motion-easing`]: `{${NS}.sys.motion.easing}`,
  };

  return { ref, sys, comp };
}

/** The four pairings an audit will look at first. */
export function contrastChecks(ws: Workspace): { label: string; pair: string; ratio: number; grade: string }[] {
  const r = currentRoles(ws);
  const pairs: [string, string, string][] = [
    ["Body on surface", r.ink, r.surface],
    ["Muted on surface", r.inkDim, r.surface],
    ["Label on accent", r.onAccent, r.accent],
    ["Accent on surface", r.accent, r.surface],
  ];
  return pairs.map(([label, a, b]) => {
    const ratio = contrast(a, b);
    return { label, pair: `${a} / ${b}`, ratio: round(ratio, 2), grade: verdict(ratio) };
  });
}

export function tokensAsCss(ws: Workspace): string {
  const tree = tokenTree(ws);
  const lines: string[] = [
    "/* Generated by DRD — design research & development */",
    ":root {",
  ];
  const emit = (header: string, entries: Record<string, string>) => {
    lines.push(`  /* ${header} */`);
    for (const [key, value] of Object.entries(entries)) {
      const name = "--" + key.replace(/\./g, "-");
      const resolved = value.includes("→") ? value.split("→")[1].trim() : value;
      lines.push(`  ${name}: ${resolved};`);
    }
  };
  emit("reference — raw values", tree.ref);
  emit("system — semantic roles", tree.sys);
  emit("component — button", tree.comp);
  lines.push("}");
  return lines.join("\n");
}

export function tokensAsJson(ws: Workspace): string {
  return JSON.stringify({ ...tokenTree(ws), contrast: contrastChecks(ws) }, null, 2);
}
