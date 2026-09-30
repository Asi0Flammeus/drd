/**
 * Components (§4.4): the capture detected and cropped them; here they get a
 * label a person would use, tokens resolved to palette roles, a hover diff,
 * a CSS snippet, and identical ones collapse into one finding.
 */

import type { CaptureArtifacts, ComponentKind, DomComponent, HoverStyle, RgbKey } from "../capture/artifacts.ts";
import { hexOfKey } from "./color.ts";
import { COMPONENT_LABEL } from "./findings.ts";
import type { ColorRef, ComponentData, ComponentTokenView, Finding } from "./findings.ts";

/** A shadow whose every colour is transparent or whose every length is zero draws nothing. */
export function visibleShadow(value: string | null | undefined): string | null {
  if (!value || value === "none") return null;
  const layers = value.split(/,(?![^(]*\))/);
  const drawn = layers.filter((layer) => !/rgba\([^)]*,\s*0\)|transparent/.test(layer) && /[1-9]/.test(layer.replace(/rgba?\([^)]*\)/g, "")));
  return drawn.length ? value : null;
}

const ORDER: ComponentKind[] = ["navigation", "hero", "heading", "button", "link-button", "card", "field", "form", "badge", "footer"];

/** A hover value as CSS: colours are stored as `r,g,b` keys. */
function hoverValue(key: keyof HoverStyle, value: string | null): string {
  if (value === null) return key === "background" ? "transparent" : "currentColor";
  if (/^\d+,\d+,\d+$/.test(value)) return hexOfKey(value);
  if (key === "boxShadow") return visibleShadow(value) ?? "none";
  return value;
}

const HOVER_PROPERTY: Record<keyof HoverStyle, string> = {
  background: "background",
  color: "color",
  borderColor: "border-color",
  boxShadow: "box-shadow",
  transform: "transform",
  textDecoration: "text-decoration",
  opacity: "opacity",
};

/** The rest state as a rule, then what the hover pass saw change as a `:hover` rule (D5). */
export function componentCss(kind: ComponentKind, tokens: ComponentTokenView, hover: { before: HoverStyle; after: HoverStyle } | null): string {
  const lines: string[] = [];
  if (tokens.background) lines.push(`  background: ${tokens.background.hex};`);
  if (tokens.foreground) lines.push(`  color: ${tokens.foreground.hex};`);
  if (tokens.border && tokens.border.width > 0) lines.push(`  border: ${tokens.border.width}px ${tokens.border.style} ${tokens.border.color?.hex ?? "currentColor"};`);
  const [a, b, c, d] = tokens.radius;
  if (a || b || c || d) lines.push(`  border-radius: ${a === b && b === c && c === d ? `${a}px` : `${a}px ${b}px ${c}px ${d}px`};`);
  const [pt, pr, pb, pl] = tokens.padding;
  if (pt || pr || pb || pl) lines.push(`  padding: ${pt === pb && pr === pl ? `${pt}px ${pr}px` : `${pt}px ${pr}px ${pb}px ${pl}px`};`);
  if (kind === "button" || kind === "link-button" || kind === "field" || kind === "badge") lines.push(`  min-height: ${tokens.height}px;`);
  if (tokens.gap) lines.push(`  gap: ${tokens.gap}px;`);
  lines.push(`  font-size: ${tokens.font.size}px;`, `  font-weight: ${tokens.font.weight};`);
  if (tokens.font.lineHeight) lines.push(`  line-height: ${tokens.font.lineHeight}px;`);
  if (tokens.font.letterSpacing) lines.push(`  letter-spacing: ${tokens.font.letterSpacing}px;`);
  if (tokens.font.transform && tokens.font.transform !== "none") lines.push(`  text-transform: ${tokens.font.transform};`);
  if (tokens.shadow) lines.push(`  box-shadow: ${tokens.shadow};`);
  if (tokens.transition) lines.push(`  transition: ${tokens.transition.property} ${tokens.transition.duration} ${tokens.transition.easing};`);
  const selector = { button: ".bouton", "link-button": ".lien-bouton", field: ".champ", card: ".carte", navigation: ".navigation", hero: ".hero", footer: ".pied-de-page", badge: ".badge", form: ".formulaire", heading: ".titre" }[kind];
  const rest = `${selector} {\n${lines.join("\n")}\n}`;
  if (!hover) return rest;
  const changed = (Object.keys(HOVER_PROPERTY) as (keyof HoverStyle)[]).filter(
    (key) => hover.before[key] !== hover.after[key] && !(key === "boxShadow" && !visibleShadow(hover.before[key]) && !visibleShadow(hover.after[key])),
  );
  if (!changed.length) return rest;
  return `${rest}\n\n${selector}:hover {\n${changed.map((key) => `  ${HOVER_PROPERTY[key]}: ${hoverValue(key, hover.after[key])};`).join("\n")}\n}`;
}

export function analyseComponents(
  artifacts: CaptureArtifacts,
  hashes: Record<string, string>,
  roleOf: (key: RgbKey) => string | null,
): Finding<ComponentData>[] {
  const ref = (key: RgbKey | null): ColorRef | null => (key ? { hex: hexOfKey(key), role: roleOf(key) } : null);
  const viewOf = (component: DomComponent): ComponentTokenView => {
    const t = component.tokens;
    return {
      background: t.background ? ref(t.background) : null,
      foreground: ref(t.color),
      border: t.borderWidth > 0 ? { width: t.borderWidth, style: t.borderStyle, color: ref(t.borderColor) } : null,
      radius: t.radius,
      padding: t.padding,
      height: t.height,
      width: t.width,
      gap: t.gap,
      font: { family: t.fontFamily, size: t.fontSize, weight: t.fontWeight, lineHeight: t.lineHeight, letterSpacing: t.letterSpacing, transform: t.textTransform },
      shadow: visibleShadow(t.shadow),
      transition: t.transition,
    };
  };
  const groupKey = (component: DomComponent): string => {
    const t = component.tokens;
    return JSON.stringify([component.kind, t.background, t.color, t.borderWidth, t.borderColor, t.radius, t.padding, t.fontSize, t.fontWeight, Math.round(t.height / 2), t.shadow]);
  };

  const groups = new Map<string, DomComponent[]>();
  for (const component of artifacts.dom.components) {
    // Every component has a crop or is dropped (W3).
    if (!artifacts.media.crops[component.id]) continue;
    const key = component.kind === "card" || component.kind === "button" || component.kind === "link-button" || component.kind === "badge" || component.kind === "field" ? groupKey(component) : `${component.id}`;
    const list = groups.get(key) ?? [];
    list.push(component);
    groups.set(key, list);
  }

  const ordinals: Partial<Record<ComponentKind, number>> = {};
  const out: Finding<ComponentData>[] = [];
  const sorted = [...groups.values()].sort((a, b) => ORDER.indexOf(a[0].kind) - ORDER.indexOf(b[0].kind) || a[0].box.y - b[0].box.y);
  for (const members of sorted) {
    const first = members.find((m) => artifacts.media.crops[m.id]?.scale === 2) ?? members[0];
    const kind = first.kind;
    ordinals[kind] = (ordinals[kind] ?? 0) + 1;
    const kindLabel = COMPONENT_LABEL[kind];
    const name = members.map((m) => m.name.trim()).find(Boolean) ?? "";
    const label = name || `${kindLabel} ${ordinals[kind]}`;
    const tokens = viewOf(first);
    const hover = artifacts.hover.find((h) => members.some((m) => m.id === h.id) && h.file) ?? artifacts.hover.find((h) => members.some((m) => m.id === h.id));
    const changes = hover ? hoverChanges(hover.before, hover.after) : [];
    const crop = artifacts.media.crops[first.id].file;
    const dhash = hashes[crop] ?? null;
    const media = [crop, ...(hover?.file ? [hover.file] : [])];
    out.push({
      kind: "component",
      subkind: kind,
      title: name ? `${kindLabel} « ${name.length > 48 ? `${name.slice(0, 47)}…` : name} »` : label,
      confidence: artifacts.partial ? "probable" : "sure",
      evidence: [
        { origin: "dom", note: `styles calculés par Chrome${members.length > 1 ? ` ; ${members.length} occurrences aux jetons identiques` : ""}` },
        { origin: "pixels", note: artifacts.media.crops[first.id].scale === 2 ? "capture de l'élément à l'écran, densité 2" : "découpé dans la page assemblée" },
        ...(hover && changes.length ? [{ origin: "dom" as const, note: `survol : ${changes.map((c) => c.property).join(", ")} changent` }] : []),
      ],
      data: {
        kind,
        kindLabel,
        label,
        count: members.length,
        tokens,
        hover: hover ? { changes, crop: hover.file } : null,
        css: componentCss(kind, tokens, hover ?? null),
        dhash,
        crop,
      },
      media,
      locations: members.map((m) => m.box),
      signature: `component:${kind}:${dhash ?? groupKey(first)}`,
    });
  }
  return out;
}

const HOVER_LABEL: Record<keyof HoverStyle, string> = {
  background: "fond",
  color: "texte",
  borderColor: "bordure",
  boxShadow: "ombre",
  transform: "transformation",
  textDecoration: "soulignement",
  opacity: "opacité",
};

function hoverChanges(before: HoverStyle, after: HoverStyle): { property: string; from: string; to: string }[] {
  const out: { property: string; from: string; to: string }[] = [];
  for (const key of Object.keys(HOVER_LABEL) as (keyof HoverStyle)[]) {
    if (before[key] === after[key]) continue;
    if (key === "boxShadow" && !visibleShadow(before[key]) && !visibleShadow(after[key])) continue;
    const show = (value: string | null) => (value === null ? "aucun" : /^\d+,\d+,\d+$/.test(value) ? hexOfKey(value) : value);
    out.push({ property: HOVER_LABEL[key], from: show(before[key]), to: show(after[key]) });
  }
  return out;
}
