/**
 * Typography (§4.3): text styles from own-text runs, the family Chrome really
 * painted with (CDP), where it came from (network), and a type scale fitted
 * to the sizes the page actually uses.
 */

import type { CaptureArtifacts, TextRun } from "../capture/artifacts.ts";
import { FONT_SOURCE_LABEL, isOflSource } from "../capture/artifacts.ts";
import { round } from "./color.ts";
import type { Evidence, Finding, FontSourceInfo, Origin, ScaleStep, TextStyle, TypeFamilyData, TypePairData, TypeRole, TypeScaleData } from "./findings.ts";

const GENERIC = ["serif", "sans-serif", "monospace", "cursive", "system-ui", "fantasy", "ui-serif", "ui-sans-serif", "ui-monospace", "-apple-system", "blinkmacsystemfont"];

const bare = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

function stackOf(declared: string): string[] {
  return declared.split(",").map((part) => part.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

/**
 * A platform font name ("Montserrat Thin Light", "DM Sans 9pt") back to the
 * family a designer names: the declared family it starts with, else the name
 * with its style words removed.
 */
export function familyName(rendered: string, declared: string): string {
  const flat = bare(rendered);
  for (const candidate of stackOf(declared)) {
    if (GENERIC.includes(candidate.toLowerCase())) continue;
    if (bare(candidate).length > 1 && flat.startsWith(bare(candidate))) return candidate;
  }
  const cleaned = rendered
    .replace(/\b(Thin|Hairline|ExtraLight|Extra Light|UltraLight|Light|Book|Regular|Normal|Medium|SemiBold|Semi Bold|DemiBold|Bold|ExtraBold|Extra Bold|UltraBold|Black|Heavy|Italic|Oblique|Variable|VF|\d+pt)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || rendered;
}

function genericOf(declared: string, family: string): TypeFamilyData["generic"] {
  const stack = stackOf(declared).map((s) => s.toLowerCase());
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const word = stack[i];
    if (word === "serif" || word === "ui-serif") return "serif";
    if (word === "monospace" || word === "ui-monospace") return "monospace";
    if (word === "cursive") return "cursive";
    if (word === "sans-serif" || word === "system-ui" || word === "ui-sans-serif" || word === "-apple-system") return "sans-serif";
  }
  const name = family.toLowerCase();
  if (/mono|code|courier/.test(name)) return "monospace";
  if (/sans|grotesk|grotesque|gothic/.test(name)) return "sans-serif";
  if (/serif|garamond|playfair|times|georgia|lora|merriweather|baskerville|bodoni|caslon|didot|libre|crimson|cormorant|fraunces|newsreader/.test(name)) return "serif";
  return "sans-serif";
}

/** French interval names of the ratios a type scale is usually built on. */
export const RATIOS: { ratio: number; name: string }[] = [
  { ratio: 1.067, name: "seconde mineure" },
  { ratio: 1.125, name: "seconde majeure" },
  { ratio: 1.2, name: "tierce mineure" },
  { ratio: 1.25, name: "tierce majeure" },
  { ratio: 1.333, name: "quarte juste" },
  { ratio: 1.414, name: "quarte augmentée" },
  { ratio: 1.5, name: "quinte juste" },
  { ratio: 1.618, name: "nombre d'or" },
];

/**
 * Fits sizes to `body × r^n`. A small ratio fits anything (every size is
 * within half a step of some power of 1.067), so ratios compete on their
 * error relative to the error chance alone would give them, (r − 1) / 4;
 * the error reported is the plain mean relative error of the winner.
 */
export function fitScale(body: number, sizes: number[]): { ratio: number; name: string; error: number; informative: boolean } | null {
  const distinct = [...new Set(sizes.map((s) => Math.round(s * 2) / 2))].filter((s) => s !== body);
  if (distinct.length < 2) return null;
  let best: { ratio: number; name: string; error: number; score: number } | null = null;
  for (const { ratio, name } of RATIOS) {
    let sum = 0;
    for (const size of distinct) {
      const n = Math.round(Math.log(size / body) / Math.log(ratio));
      const predicted = body * ratio ** n;
      sum += Math.abs(size - predicted) / size;
    }
    const error = sum / distinct.length;
    const score = error / ((ratio - 1) / 4);
    if (!best || score < best.score) best = { ratio, name, error, score };
  }
  if (!best) return null;
  return { ratio: best.ratio, name: best.name, error: best.error, informative: best.score < 0.6 };
}

function roleOf(runs: TextRun[], size: number, body: number): TypeRole {
  const votes: Partial<Record<TypeRole, number>> = {};
  for (const run of runs) {
    let role: TypeRole;
    if (run.context.heading === 1) role = size >= 40 ? "display" : "h1";
    else if (run.context.heading === 2) role = "h2";
    else if (run.context.heading >= 3) role = "h3";
    else if (run.context.button) role = "bouton";
    else if (run.context.mono) role = "mono";
    else if (run.context.label) role = "label";
    else if (run.context.nav && size <= body * 1.2) role = "nav";
    else if (size >= 40) role = "display";
    else if (size >= body * 1.5) role = "h3";
    else if (run.context.small || size < body * 0.87) role = "petit";
    else role = "corps";
    votes[role] = (votes[role] ?? 0) + run.glyph;
  }
  return (Object.entries(votes).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] as TypeRole) ?? "corps";
}

export type TypeResult = {
  scale: Finding<TypeScaleData> | null;
  families: Finding<TypeFamilyData>[];
  pair: Finding<TypePairData> | null;
};

export function analyseType(artifacts: CaptureArtifacts): TypeResult {
  const runs = artifacts.dom.runs;
  if (!runs.length) return { scale: null, families: [], pair: null };

  // DOM style key → the family CDP says painted it.
  const renderedByKey = new Map<string, { family: string; custom: boolean }>();
  for (const style of artifacts.dom.textStyles) {
    const answer = artifacts.fonts.rendered.find((r) => r.style === style.id)?.families[0];
    if (answer) renderedByKey.set(style.key, { family: answer.family, custom: answer.custom });
  }
  const cropByKey = new Map<string, string>();
  for (const style of artifacts.dom.textStyles) {
    const crop = artifacts.media.typeCrops[style.id];
    if (crop) cropByKey.set(style.key, crop.file);
  }

  type Group = { runs: TextRun[]; glyph: number; family: string; origin: Origin; declared: string; crop: string | null; cropGlyph: number };
  const groups = new Map<string, Group>();
  let totalGlyph = 0;
  for (const run of runs) {
    const rendered = renderedByKey.get(run.style);
    const family = rendered ? familyName(rendered.family, run.family) : familyName(stackOf(run.family)[0] ?? run.family, run.family);
    const lineRatio = Math.round((run.lineHeight / run.size) * 20) / 20;
    const trackingEm = Math.round((run.tracking / run.size) * 200) / 200;
    const id = [family, run.weight, Math.round(run.size * 2) / 2, lineRatio, trackingEm, run.transform, run.italic].join("|");
    let group = groups.get(id);
    if (!group) {
      group = { runs: [], glyph: 0, family, origin: rendered ? "cdp" : "declared", declared: run.family, crop: null, cropGlyph: -1 };
      groups.set(id, group);
    }
    group.runs.push(run);
    group.glyph += run.glyph;
    totalGlyph += run.glyph;
    const crop = cropByKey.get(run.style);
    if (crop && run.glyph > group.cropGlyph) {
      group.crop = crop;
      group.cropGlyph = run.glyph;
    }
  }

  // Body: the size with the largest glyph share between 14 and 20 px.
  const bySize = new Map<number, number>();
  for (const run of runs) bySize.set(Math.round(run.size * 2) / 2, (bySize.get(Math.round(run.size * 2) / 2) ?? 0) + run.glyph);
  const bodyCandidates = [...bySize.entries()].filter(([size]) => size >= 14 && size <= 20).sort((a, b) => b[1] - a[1]);
  const body = bodyCandidates[0]?.[0] ?? [...bySize.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const styles: TextStyle[] = [...groups.values()]
    .sort((a, b) => b.glyph - a.glyph)
    .map((group) => {
      const first = group.runs.reduce((a, b) => (b.glyph > a.glyph ? b : a));
      return {
        family: group.family,
        declared: group.declared,
        size: first.size,
        lineHeight: round(first.lineHeight, 1),
        lineRatio: round(first.lineHeight / first.size, 2),
        tracking: round(first.tracking / first.size, 3),
        weight: first.weight,
        transform: first.transform,
        italic: first.italic,
        role: roleOf(group.runs, first.size, body),
        share: round(group.glyph / (totalGlyph || 1), 4),
        sample: first.text.slice(0, 60),
        crop: group.crop,
        locations: group.runs.map((run) => run.box).slice(0, 40),
        runs: group.runs.length,
        origin: group.origin,
      };
    });

  const shown = styles.filter((style) => style.share >= 0.003).slice(0, 14);
  const scaleSizes = [...new Set(styles.filter((style) => style.share >= 0.005).map((style) => style.size))];
  const fit = fitScale(body, scaleSizes);
  const verdict: TypeScaleData["verdict"] = fit && fit.informative ? (fit.error < 0.04 ? "sûr" : fit.error < 0.1 ? "probable" : "échelle libre") : "échelle libre";
  const steps: ScaleStep[] = [...new Set(scaleSizes.concat(body))]
    .sort((a, b) => b - a)
    .map((size) => {
      const style = styles.find((s) => s.size === size);
      return {
        size,
        n: fit && verdict !== "échelle libre" ? Math.round(Math.log(size / body) / Math.log(fit.ratio)) : null,
        lineHeight: style?.lineHeight ?? round(size * 1.2, 1),
        role: style?.role ?? "corps",
      };
    });

  const familyNames = [...new Set(styles.map((s) => s.family))];
  const hasCdp = styles.some((s) => s.origin === "cdp");
  const scale: Finding<TypeScaleData> = {
    kind: "type",
    subkind: "scale",
    title: verdict === "échelle libre" ? "Échelle typographique libre" : `Échelle ${fit?.name} ≈ ${String(fit?.ratio).replace(".", ",")}`,
    confidence: verdict === "sûr" && !artifacts.partial ? "sure" : verdict === "probable" ? "probable" : "check",
    evidence: [
      { origin: "dom", note: `${runs.length} passages de texte (texte propre, sans script ni style), ${styles.length} styles` },
      ...(fit ? [{ origin: "dom" as const, note: `corps ${body} px ; meilleur rapport ${fit.ratio} (${fit.name}), erreur moyenne ${round(fit.error * 100, 1)} %` }] : []),
      ...(hasCdp ? [{ origin: "cdp" as const, note: "familles rendues lues par CSS.getPlatformFontsForNode" }] : []),
    ],
    data: {
      body,
      ratio: fit && verdict !== "échelle libre" ? fit.ratio : null,
      ratioName: fit && verdict !== "échelle libre" ? fit.name : null,
      error: fit ? round(fit.error, 4) : null,
      verdict,
      steps,
      styles: shown,
      families: familyNames,
    },
    media: shown.map((s) => s.crop).filter((file): file is string => Boolean(file)),
    locations: [],
    signature: `scale:${familyNames.slice(0, 3).join("+")}:${body}:${fit && verdict !== "échelle libre" ? fit.ratio : "libre"}`,
  };

  // Families.
  const familyGroups = new Map<string, { styles: TextStyle[]; glyph: number; declared: Map<string, number> }>();
  for (const style of styles) {
    let entry = familyGroups.get(style.family);
    if (!entry) {
      entry = { styles: [], glyph: 0, declared: new Map() };
      familyGroups.set(style.family, entry);
    }
    entry.styles.push(style);
    entry.glyph += style.share;
    entry.declared.set(style.declared, (entry.declared.get(style.declared) ?? 0) + style.share);
  }
  const families: Finding<TypeFamilyData>[] = [];
  for (const [family, entry] of [...familyGroups.entries()].sort((a, b) => b[1].glyph - a[1].glyph)) {
    if (families.length >= 5 || (entry.glyph < 0.01 && families.length > 0)) continue;
    const declaredStacks = [...entry.declared.entries()].sort((a, b) => b[1] - a[1]).map(([stack]) => stack);
    const topStack = declaredStacks[0] ?? family;
    const firstDeclared = stackOf(topStack).find((name) => !GENERIC.includes(name.toLowerCase())) ?? null;
    const origin = entry.styles.some((s) => s.origin === "cdp") ? "cdp" : "declared";
    const mismatch = origin === "cdp" && firstDeclared && bare(firstDeclared) !== bare(family) ? { declared: firstDeclared, rendered: family } : null;
    const network = artifacts.fonts.network.filter((font) => font.family && bare(font.family) === bare(family));
    const sourceKind = network[0]?.source ?? null;
    const source: FontSourceInfo = sourceKind
      ? { label: sourceKind === "other" ? network[0].host : FONT_SOURCE_LABEL[sourceKind], host: network[0].host, licence: isOflSource(sourceKind) ? "OFL probable" : "à vérifier" }
      : { label: "police système ou source inconnue", host: null, licence: "à vérifier" };
    const specimens = artifacts.media.specimens.filter((s) => bare(familyName(s.family, topStack)) === bare(family)).map(({ weight, italic, file }) => ({ weight, italic, file }));
    const fontFiles = network.filter((font) => font.file && isOflSource(font.source)).map((font) => ({ file: font.file as string, weight: font.weight ?? "400", style: font.style ?? "normal" }));
    const roles = [...new Set(entry.styles.map((s) => s.role))];
    const generic = genericOf(topStack, family);
    const evidence: Evidence[] = [
      { origin, note: origin === "cdp" ? `rendue par Chrome : ${family}` : `déclarée : ${topStack} (rendu non mesuré)` },
      { origin: "dom", note: `${entry.styles.length} style${entry.styles.length > 1 ? "s" : ""}, ${round(entry.glyph * 100, 1)} % de la surface de texte` },
    ];
    if (network.length) evidence.push({ origin: "network", note: `${network.length} fichier${network.length > 1 ? "s" : ""} depuis ${network[0].host}` });
    if (mismatch) evidence.push({ origin: "cdp", note: `Police déclarée non chargée : ${mismatch.declared}, rendue en ${mismatch.rendered}` });
    families.push({
      kind: "type",
      subkind: "family",
      title: family,
      confidence: mismatch || artifacts.partial ? "check" : origin === "cdp" && (network.length || specimens.length) ? "sure" : "probable",
      evidence,
      data: {
        family,
        declared: declaredStacks.slice(0, 3),
        generic,
        display: roles.every((role) => role === "display" || role === "h1" || role === "h2"),
        weights: [...new Set(entry.styles.map((s) => s.weight))].sort((a, b) => a - b),
        italic: entry.styles.some((s) => s.italic),
        variation: [...new Set(runs.filter((run) => run.variation && familyName(renderedByKey.get(run.style)?.family ?? run.family, run.family) === family).map((run) => run.variation))].slice(0, 4),
        source,
        mismatch,
        specimens,
        fontFiles,
        share: round(entry.glyph, 4),
        roles,
        bodySize: entry.styles.some((s) => s.size === body) ? body : null,
      },
      media: [...specimens.map((s) => s.file), ...fontFiles.map((f) => f.file), ...entry.styles.map((s) => s.crop).filter((f): f is string => Boolean(f)).slice(0, 4)],
      locations: entry.styles.flatMap((s) => s.locations).slice(0, 40),
      signature: `family:${bare(family)}`,
    });
  }

  // Pair: one family owns the display roles, another the body.
  const DISPLAY: TypeRole[] = ["display", "h1", "h2", "h3"];
  const displayStyle = styles.filter((s) => DISPLAY.includes(s.role)).sort((a, b) => b.share - a.share)[0];
  const textStyle = styles.filter((s) => s.role === "corps").sort((a, b) => b.share - a.share)[0];
  let pair: Finding<TypePairData> | null = null;
  if (displayStyle && textStyle && bare(displayStyle.family) !== bare(textStyle.family)) {
    const genericFor = (family: string) => families.find((f) => f.data.family === family)?.data.generic ?? "sans-serif";
    pair = {
      kind: "type",
      subkind: "pair",
      title: `${displayStyle.family} + ${textStyle.family}`,
      confidence: displayStyle.origin === "cdp" && textStyle.origin === "cdp" ? "sure" : "probable",
      evidence: [{ origin: displayStyle.origin, note: `titres en ${displayStyle.family} (${displayStyle.size} px), corps en ${textStyle.family} (${textStyle.size} px)` }],
      data: {
        display: { family: displayStyle.family, generic: genericFor(displayStyle.family), size: displayStyle.size, weight: displayStyle.weight, crop: displayStyle.crop },
        text: { family: textStyle.family, generic: genericFor(textStyle.family), size: textStyle.size, weight: textStyle.weight, crop: textStyle.crop },
      },
      media: [displayStyle.crop, textStyle.crop, ...families.filter((f) => f.data.family === displayStyle.family || f.data.family === textStyle.family).flatMap((f) => f.media)].filter((f): f is string => Boolean(f)),
      locations: [...displayStyle.locations, ...textStyle.locations].slice(0, 40),
      signature: `pair:${bare(displayStyle.family)}+${bare(textStyle.family)}:${body}`,
    };
  }

  return { scale, families, pair };
}
