/**
 * Kept items as design tokens (§5.6): DTCG 2025.10 JSON, CSS custom
 * properties and a Tailwind v4 `@theme`. Pure functions over item views.
 *
 * One intermediate list of tokens feeds all three formats, so a colour is
 * named the same way in every file: by its role (`accent`), never by its
 * position (W15). With several sources the source's slug groups them.
 */

import { hexOfKey, keyOfHex, labOfKey, oklchOfLab } from "../analyse/color.ts";
import type { ItemView } from "../library/index.ts";

type Oklch = { l: number; c: number; h: number };
type Dimension = { value: number; unit: "px" | "em" };
type Shadow = { color: { oklch: Oklch; hex: string }; offsetX: Dimension; offsetY: Dimension; blur: Dimension; spread: Dimension; inset: boolean };

export type Token =
  | { type: "color"; value: { oklch: Oklch; hex: string } }
  | { type: "dimension"; value: Dimension }
  | { type: "fontFamily"; value: string[] }
  | { type: "fontWeight"; value: number }
  | { type: "number"; value: number }
  | { type: "typography"; value: { fontFamily: string[]; fontSize: Dimension; fontWeight: number; lineHeight: number; letterSpacing: Dimension } }
  | { type: "shadow"; value: Shadow[] }
  | { type: "border"; value: { color: { oklch: Oklch; hex: string }; width: Dimension; style: string } };

export type NamedToken = Token & { group: string | null; path: string[]; description: string; extensions: Record<string, unknown> };

export function slug(text: string, fallback = "x"): string {
  const out = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return out || fallback;
}

function colorOf(hex: string): { oklch: Oklch; hex: string } {
  const key = keyOfHex(hex);
  return { oklch: oklchOfLab(labOfKey(key)), hex: hexOfKey(key) };
}

const px = (value: number): Dimension => ({ value: Math.round(value * 100) / 100, unit: "px" });

const GENERIC_FALLBACK: Record<string, string> = { serif: "serif", "sans-serif": "sans-serif", monospace: "monospace", cursive: "cursive" };

/** `rgba(0, 0, 0, 0.2) 0px 8px 24px 0px, …` → DTCG shadow layers. */
export function parseShadow(value: string): Shadow[] {
  const layers = value.split(/,(?![^(]*\))/).map((layer) => layer.trim()).filter(Boolean);
  const out: Shadow[] = [];
  for (const layer of layers) {
    const colorText = /(rgba?\([^)]*\)|#[0-9a-f]{3,8}|oklch\([^)]*\))/i.exec(layer)?.[1] ?? "rgb(0, 0, 0)";
    const lengths = layer.replace(colorText, "").match(/-?[\d.]+px|\b0\b/g)?.map((n) => parseFloat(n)) ?? [];
    const rgba = /rgba?\(([^)]*)\)/.exec(colorText);
    let hex = "#000000";
    let alpha = 1;
    if (rgba) {
      const parts = rgba[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      hex = `#${parts.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
      alpha = parts[3] ?? 1;
    } else if (colorText.startsWith("#")) hex = colorText.slice(0, 7);
    const color = colorOf(hex);
    out.push({
      color: alpha < 1 ? { oklch: color.oklch, hex: `${color.hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}` } : color,
      offsetX: px(lengths[0] ?? 0),
      offsetY: px(lengths[1] ?? 0),
      blur: px(lengths[2] ?? 0),
      spread: px(lengths[3] ?? 0),
      inset: /\binset\b/.test(layer),
    });
  }
  return out;
}

const ROLE_KEY: Record<string, string> = { fond: "background", background: "background", surface: "surface", texte: "text", text: "text", "texte 2": "text-muted", accent: "accent", "accent 2": "accent-2", bordure: "border", border: "border" };

type Data = Record<string, unknown>;
const list = (value: unknown): Data[] => (Array.isArray(value) ? value.filter((v): v is Data => Boolean(v) && typeof v === "object") : []);

/** Every token one item contributes, before naming by source. */
function tokensOfItem(item: ItemView): { path: string[]; token: Token }[] {
  const data = (item.data ?? {}) as Data;
  const out: { path: string[]; token: Token }[] = [];
  const used = new Set<string>();
  const unique = (name: string) => {
    let candidate = name;
    for (let n = 2; used.has(candidate); n += 1) candidate = `${name}-${n}`;
    used.add(candidate);
    return candidate;
  };
  const addColor = (name: string, hex: unknown) => {
    if (typeof hex === "string" && /^#[0-9a-f]{6}/i.test(hex)) out.push({ path: ["color", unique(name)], token: { type: "color", value: colorOf(hex.slice(0, 7)) } });
  };
  const familyStack = (family: string, generic: unknown) => [family, GENERIC_FALLBACK[String(generic)] ?? "sans-serif"];

  switch (item.kind) {
    case "palette":
      for (const color of list(data.colors)) {
        const key = typeof color.key === "string" && color.key !== "image" ? color.key : (ROLE_KEY[String(color.role ?? "").toLowerCase()] ?? slug(String(color.role || "color")));
        addColor(key, color.hex);
      }
      break;
    case "color": {
      const color = (data.color ?? {}) as Data;
      addColor(typeof color.key === "string" ? color.key : (ROLE_KEY[String(color.role ?? "").toLowerCase()] ?? "color"), color.hex);
      break;
    }
    case "mood":
      list(data.palette).forEach((color, index) => addColor(`mood-${index + 1}`, color.hex));
      break;
    case "type": {
      if (typeof data.family === "string") {
        out.push({ path: ["font", unique(slug(data.family))], token: { type: "fontFamily", value: familyStack(data.family, data.generic) } });
        for (const weight of Array.isArray(data.weights) ? data.weights : []) {
          if (typeof weight === "number") out.push({ path: ["font-weight", unique(`${slug(data.family)}-${weight}`)], token: { type: "fontWeight", value: weight } });
        }
      }
      for (const role of ["display", "text"] as const) {
        const part = data[role];
        if (part && typeof part === "object" && typeof (part as Data).family === "string") {
          const p = part as { family: string; generic?: string; size?: number; weight?: number };
          out.push({ path: ["font", unique(role)], token: { type: "fontFamily", value: familyStack(p.family, p.generic) } });
        }
      }
      for (const style of list(data.styles)) {
        if (typeof style.size !== "number" || typeof style.family !== "string") continue;
        out.push({
          path: ["text", unique(String(style.role ?? "style"))],
          token: {
            type: "typography",
            value: {
              fontFamily: familyStack(style.family, null),
              fontSize: px(style.size),
              fontWeight: typeof style.weight === "number" ? style.weight : 400,
              lineHeight: typeof style.lineRatio === "number" ? style.lineRatio : 1.2,
              letterSpacing: { value: typeof style.tracking === "number" ? style.tracking : 0, unit: "em" },
            },
          },
        });
      }
      // Atelier bench settings keep their own token tree.
      if (data.tokens && typeof data.tokens === "object" && !data.styles) {
        const tree = data.tokens as Data;
        for (const [name, value] of Object.entries((tree.font ?? {}) as Record<string, string>)) out.push({ path: ["font", unique(slug(name))], token: { type: "fontFamily", value: [String(value)] } });
      }
      break;
    }
    case "component": {
      const tokens = (data.tokens ?? {}) as {
        background?: { hex: string } | null;
        foreground?: { hex: string } | null;
        border?: { width: number; style: string; color: { hex: string } | null } | null;
        radius?: number[];
        padding?: number[];
        height?: number;
        font?: { family: string; size: number; weight: number; lineHeight: number | null; letterSpacing: number };
        shadow?: string | null;
      };
      const base = slug(`${String(data.kind ?? "component")}`);
      const name = unique(base);
      if (tokens.background) out.push({ path: ["component", name, "background"], token: { type: "color", value: colorOf(tokens.background.hex) } });
      if (tokens.foreground) out.push({ path: ["component", name, "foreground"], token: { type: "color", value: colorOf(tokens.foreground.hex) } });
      if (tokens.border && tokens.border.width > 0 && tokens.border.color) {
        out.push({ path: ["component", name, "border"], token: { type: "border", value: { color: colorOf(tokens.border.color.hex), width: px(tokens.border.width), style: tokens.border.style || "solid" } } });
      }
      if (tokens.radius) out.push({ path: ["component", name, "radius"], token: { type: "dimension", value: px(Math.max(...tokens.radius)) } });
      if (tokens.padding) {
        out.push({ path: ["component", name, "padding-block"], token: { type: "dimension", value: px(tokens.padding[0]) } });
        out.push({ path: ["component", name, "padding-inline"], token: { type: "dimension", value: px(tokens.padding[1]) } });
      }
      if (typeof tokens.height === "number") out.push({ path: ["component", name, "min-height"], token: { type: "dimension", value: px(tokens.height) } });
      if (tokens.font) {
        out.push({
          path: ["component", name, "typography"],
          token: { type: "typography", value: { fontFamily: tokens.font.family.split(",").map((f) => f.trim().replace(/^["']|["']$/g, "")), fontSize: px(tokens.font.size), fontWeight: tokens.font.weight, lineHeight: tokens.font.lineHeight ? Math.round((tokens.font.lineHeight / tokens.font.size) * 100) / 100 : 1.2, letterSpacing: px(tokens.font.letterSpacing) } },
        });
      }
      if (tokens.shadow) out.push({ path: ["component", name, "shadow"], token: { type: "shadow", value: parseShadow(tokens.shadow) } });
      break;
    }
    case "scale":
      if (item.subkind === "spacing" && typeof data.base === "number") {
        out.push({ path: ["spacing", "base"], token: { type: "dimension", value: px(data.base) } });
        for (const step of Array.isArray(data.steps) ? data.steps : []) if (typeof step === "number") out.push({ path: ["spacing", unique(String(step / data.base))], token: { type: "dimension", value: px(step) } });
        if (typeof data.contentWidth === "number") out.push({ path: ["size", "content"], token: { type: "dimension", value: px(data.contentWidth) } });
      }
      if (item.subkind === "radius") {
        for (const entry of list(data.byKind)) {
          const values = Array.isArray(entry.values) ? entry.values.filter((v): v is number => typeof v === "number") : [];
          values.forEach((value, index) => out.push({ path: ["radius", unique(`${slug(String(entry.kind))}${index ? `-${index + 1}` : ""}`)], token: { type: "dimension", value: px(value) } }));
        }
      }
      if (item.subkind === "elevation") {
        list(data.shadows).forEach((shadow, index) => {
          if (typeof shadow.value === "string") out.push({ path: ["shadow", String(index + 1)], token: { type: "shadow", value: parseShadow(shadow.value) } });
        });
      }
      break;
    default:
      break;
  }
  // Atelier palettes: the playground's resolved roles.
  if (item.kind === "palette" && data.roles && typeof data.roles === "object") {
    for (const [role, hex] of Object.entries(data.roles as Record<string, unknown>)) addColor(slug(role), hex);
  }
  return out;
}

/** Tokens of a selection, grouped by source unless there is only one item. */
export function collectTokens(items: ItemView[]): NamedToken[] {
  const flat = items.length === 1;
  const groups = new Map<string, string>();
  const out: NamedToken[] = [];
  for (const item of items) {
    const provenance = item.provenance as { site?: string; capturedAt?: string };
    const source = provenance.site ?? item.sourceHost ?? "atelier";
    let group = groups.get(item.sourceHost ?? `atelier:${item.id}`) ?? null;
    if (!flat && !group) {
      group = slug(source, "atelier");
      const taken = new Set(groups.values());
      for (let n = 2; taken.has(group); n += 1) group = `${slug(source, "atelier")}-${n}`;
      groups.set(item.sourceHost ?? `atelier:${item.id}`, group);
    }
    const seen = new Set(out.filter((t) => t.group === group).map((t) => t.path.join(".")));
    for (const { path, token } of tokensOfItem(item)) {
      let unique = path;
      for (let n = 2; seen.has(unique.join(".")); n += 1) unique = [...path.slice(0, -1), `${path.at(-1)}-${n}`];
      seen.add(unique.join("."));
      out.push({
        ...token,
        group: flat ? null : group,
        path: unique,
        description: item.why.trim(),
        extensions: { "cat.alysis.drd": { item: item.id, title: item.title, sourceUrl: item.sourceUrl, capturedAt: provenance.capturedAt ?? null, confidence: item.confidence } },
      } as NamedToken);
    }
  }
  return out;
}

function dtcgValue(token: NamedToken): unknown {
  const color = (c: { oklch: Oklch; hex: string }) => ({ colorSpace: "oklch", components: [c.oklch.l, c.oklch.c, c.oklch.h], hex: c.hex.slice(0, 7), ...(c.hex.length > 7 ? { alpha: Math.round((parseInt(c.hex.slice(7, 9), 16) / 255) * 1000) / 1000 } : {}) });
  switch (token.type) {
    case "color":
      return color(token.value);
    case "shadow":
      return token.value.map((s) => ({ color: color(s.color), offsetX: s.offsetX, offsetY: s.offsetY, blur: s.blur, spread: s.spread, ...(s.inset ? { inset: true } : {}) }));
    case "border":
      return { color: color(token.value.color), width: token.value.width, style: token.value.style };
    default:
      return token.value;
  }
}

/** DTCG 2025.10: nested groups, `$type`/`$value`, why as `$description`, provenance in `$extensions`. */
export function toDtcg(items: ItemView[]): string {
  const root: Record<string, unknown> = {};
  for (const token of collectTokens(items)) {
    let node = root;
    for (const segment of [...(token.group ? [token.group] : []), ...token.path.slice(0, -1)]) {
      node[segment] ??= {};
      node = node[segment] as Record<string, unknown>;
    }
    node[token.path.at(-1) as string] = {
      $type: token.type,
      $value: dtcgValue(token),
      ...(token.description ? { $description: token.description } : {}),
      $extensions: token.extensions,
    };
  }
  return `${JSON.stringify(root, null, 2)}\n`;
}

function cssValue(token: NamedToken): string {
  const color = (c: { oklch: Oklch; hex: string }) => (c.hex.length > 7 ? `oklch(${c.oklch.l} ${c.oklch.c} ${c.oklch.h} / ${Math.round((parseInt(c.hex.slice(7, 9), 16) / 255) * 100) / 100})` : `oklch(${c.oklch.l} ${c.oklch.c} ${c.oklch.h})`);
  const dim = (d: Dimension) => `${d.value}${d.unit}`;
  const family = (f: string[]) => f.map((name) => (/^(serif|sans-serif|monospace|cursive|system-ui)$/.test(name) ? name : `"${name}"`)).join(", ");
  switch (token.type) {
    case "color":
      return color(token.value);
    case "dimension":
      return dim(token.value);
    case "fontFamily":
      return family(token.value);
    case "fontWeight":
    case "number":
      return String(token.value);
    case "shadow":
      return token.value.map((s) => `${s.inset ? "inset " : ""}${dim(s.offsetX)} ${dim(s.offsetY)} ${dim(s.blur)} ${dim(s.spread)} ${color(s.color)}`).join(", ");
    case "border":
      return `${dim(token.value.width)} ${token.value.style} ${color(token.value.color)}`;
    case "typography":
      return `${token.value.fontWeight} ${dim(token.value.fontSize)}/${token.value.lineHeight} ${family(token.value.fontFamily)}`;
  }
}

/** `:root { --color-accent: oklch(…); }`, role names, grouped by source when several. */
export function toCss(items: ItemView[], title = "Jetons DRD"): string {
  const lines = [`/* ${title}: valeurs mesurées sur les sites cités, point de départ et non vérité. */`, ":root {"];
  let group: string | null | undefined;
  for (const token of collectTokens(items)) {
    if (token.group !== group) {
      group = token.group;
      if (group) lines.push(`  /* ${group} */`);
    }
    const name = [...(token.group ? [token.group] : []), ...token.path].join("-");
    if (token.type === "typography") {
      lines.push(`  --${name}-family: ${cssValue({ ...token, type: "fontFamily", value: token.value.fontFamily })};`);
      lines.push(`  --${name}-size: ${token.value.fontSize.value}${token.value.fontSize.unit};`);
      lines.push(`  --${name}-line-height: ${token.value.lineHeight};`);
      lines.push(`  --${name}-weight: ${token.value.fontWeight};`);
      if (token.value.letterSpacing.value) lines.push(`  --${name}-tracking: ${token.value.letterSpacing.value}${token.value.letterSpacing.unit};`);
    } else lines.push(`  --${name}: ${cssValue(token)};`);
  }
  lines.push("}", "");
  return lines.join("\n");
}

/** Tailwind v4 `@theme`: `--color-*`, `--font-*`, `--text-*` with line heights, `--radius-*`, `--shadow-*`, `--spacing`. */
export function toTailwind(items: ItemView[], title = "Thème DRD"): string {
  const lines = [`/* ${title}: thème Tailwind v4, valeurs mesurées. */`, "@theme {"];
  let spacingSet = false;
  for (const token of collectTokens(items)) {
    const tail = (path: string[]) => [...(token.group ? [token.group] : []), ...path].join("-");
    const [namespace, ...rest] = token.path;
    if (namespace === "color" && token.type === "color") lines.push(`  --color-${tail(rest)}: ${cssValue(token)};`);
    else if (namespace === "font" && token.type === "fontFamily") lines.push(`  --font-${tail(rest)}: ${cssValue(token)};`);
    else if (namespace === "font-weight" && token.type === "fontWeight") lines.push(`  --font-weight-${tail(rest)}: ${token.value};`);
    else if (namespace === "text" && token.type === "typography") {
      lines.push(`  --text-${tail(rest)}: ${token.value.fontSize.value}px;`);
      lines.push(`  --text-${tail(rest)}--line-height: ${token.value.lineHeight};`);
      if (token.value.letterSpacing.value) lines.push(`  --text-${tail(rest)}--letter-spacing: ${token.value.letterSpacing.value}em;`);
      lines.push(`  --text-${tail(rest)}--font-weight: ${token.value.fontWeight};`);
    } else if (namespace === "radius" && token.type === "dimension") lines.push(`  --radius-${tail(rest)}: ${cssValue(token)};`);
    else if (namespace === "shadow" && token.type === "shadow") lines.push(`  --shadow-${tail(rest)}: ${cssValue(token)};`);
    else if (namespace === "spacing" && rest[0] === "base" && token.type === "dimension" && !spacingSet) {
      lines.push(`  --spacing: ${cssValue(token)};`);
      spacingSet = true;
    } else if (namespace === "size" && token.type === "dimension") lines.push(`  --container-${tail(rest)}: ${cssValue(token)};`);
    else if (namespace === "component") {
      const [name, part] = rest;
      if (token.type === "color") lines.push(`  --color-${tail([name, part])}: ${cssValue(token)};`);
      if (part === "radius" && token.type === "dimension") lines.push(`  --radius-${tail([name])}: ${cssValue(token)};`);
      if (part === "shadow" && token.type === "shadow") lines.push(`  --shadow-${tail([name])}: ${cssValue(token)};`);
    }
  }
  lines.push("}", "");
  return lines.join("\n");
}

export type CopyFormat = "css" | "tailwind" | "json";

export function copyItem(item: ItemView, format: CopyFormat): string {
  if (format === "json") return toDtcg([item]);
  if (format === "tailwind") return toTailwind([item], item.title);
  // A component copies as its rule (Figma Dev Mode's snippet), everything else as variables.
  const data = item.data as { css?: unknown };
  if (item.kind === "component" && typeof data.css === "string") return `${data.css}\n`;
  return toCss([item], item.title);
}
