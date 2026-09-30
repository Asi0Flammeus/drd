/**
 * Spacing, radius and elevation (§4.5): what system, if any, the page's
 * layout values fall into, and how much of them it explains.
 */

import type { CaptureArtifacts } from "../capture/artifacts.ts";
import { round } from "./color.ts";
import { visibleShadow } from "./components.ts";
import { COMPONENT_LABEL } from "./findings.ts";
import type { Confidence, ElevationData, Finding, RadiusData, SpacingData } from "./findings.ts";

const BASES = [2, 4, 5, 6, 8];

function confidenceOf(explained: number): Confidence {
  if (explained >= 0.8) return "sure";
  if (explained >= 0.6) return "probable";
  return "check";
}

/** Share of weighted values within ±0.5 px of a multiple of `base`. */
export function explainedBy(values: { value: number; count: number }[], base: number): number {
  const total = values.reduce((sum, v) => sum + v.count, 0) || 1;
  let hit = 0;
  for (const { value, count } of values) {
    const remainder = value % base;
    if (remainder <= 0.5 || base - remainder <= 0.5) hit += count;
  }
  return hit / total;
}

/**
 * Every multiple of 8 is a multiple of 2, so the smallest base always
 * explains the most. The base is the largest one that explains within five
 * points of the best.
 */
export function spacingBase(values: { value: number; count: number }[]): { base: number; explained: number } {
  const shares = BASES.map((base) => ({ base, explained: explainedBy(values, base) }));
  const best = Math.max(...shares.map((s) => s.explained));
  const chosen = shares.filter((s) => s.explained >= best - 0.05).sort((a, b) => b.base - a.base)[0];
  return chosen;
}

const top = (record: Record<string, number>): number | null => {
  const entry = Object.entries(record).sort((a, b) => b[1] - a[1])[0];
  return entry ? Number(entry[0]) : null;
};

export function analyseScales(artifacts: CaptureArtifacts): Finding[] {
  const out: Finding[] = [];

  const values = Object.entries(artifacts.dom.spacing)
    .map(([value, count]) => ({ value: Number(value), count }))
    .filter((v) => v.value > 0)
    .sort((a, b) => a.value - b.value);
  if (values.length >= 3) {
    const { base, explained } = spacingBase(values);
    const multiples = new Map<number, number>();
    for (const { value, count } of values) {
      const n = Math.round(value / base);
      if (n >= 1 && Math.abs(value - n * base) <= 0.5) multiples.set(n * base, (multiples.get(n * base) ?? 0) + count);
    }
    const steps = [...multiples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([value]) => value).sort((a, b) => a - b);
    const data: SpacingData = {
      base,
      steps,
      explained: round(explained, 3),
      contentWidth: top(artifacts.dom.widths),
      columns: top(artifacts.dom.columns),
      values: values.slice().sort((a, b) => b.count - a.count).slice(0, 16),
    };
    out.push({
      kind: "scale",
      subkind: "spacing",
      title: `Espacement · base ${base} · ${steps.join(" ")}`,
      confidence: confidenceOf(explained),
      evidence: [{ origin: "dom", note: `${values.reduce((s, v) => s + v.count, 0)} marges, paddings et gouttières mesurés ; ${Math.round(explained * 100)} % sur la base ${base}` }],
      data,
      media: [],
      locations: [],
      signature: `spacing:${base}:${steps.join(",")}`,
    });
  }

  const byKind = new Map<string, Set<number>>();
  for (const component of artifacts.dom.components) {
    if (!artifacts.media.crops[component.id]) continue;
    const radius = Math.max(...component.tokens.radius);
    const pill = radius >= component.tokens.height / 2 - 1 && radius > 0;
    const value = pill ? 999 : Math.round(radius);
    const set = byKind.get(component.kind) ?? new Set<number>();
    set.add(value);
    byKind.set(component.kind, set);
  }
  if (byKind.size) {
    const kinds = [...byKind.entries()].map(([kind, set]) => ({ kind, kindLabel: COMPONENT_LABEL[kind as keyof typeof COMPONENT_LABEL] ?? kind, values: [...set].sort((a, b) => a - b) }));
    const all = kinds.flatMap((k) => k.values);
    const soft = [...new Set(all.filter((v) => v > 2 && v < 999))];
    const controls = kinds.filter((k) => k.kind === "button" || k.kind === "link-button" || k.kind === "field" || k.kind === "badge");
    let system: RadiusData["system"];
    if (all.every((v) => v <= 2)) system = "droit";
    else if (controls.length && controls.every((k) => k.values.every((v) => v === 999)) && soft.length === 0) system = "pilule";
    else if (soft.length === 1 && soft[0] >= 8 && soft[0] <= 16 && !all.includes(999)) system = "doux";
    else system = "mixte";
    const describe = (v: number) => (v === 999 ? "pilule" : v <= 2 ? "droits" : `${v} px`);
    const PLURAL: Record<string, string> = { button: "boutons", "link-button": "liens-boutons", card: "cartes", field: "champs", badge: "badges", navigation: "navigation", hero: "hero", footer: "pied de page", form: "formulaires", heading: "titres" };
    const rule = kinds.map((k) => `${PLURAL[k.kind] ?? k.kindLabel.toLowerCase()} ${k.values.map(describe).join(" / ")}`).join(", ");
    out.push({
      kind: "scale",
      subkind: "radius",
      title: `Rayons · ${system}`,
      confidence: kinds.length >= 2 ? "sure" : "probable",
      evidence: [{ origin: "dom", note: `rayons calculés de ${all.length} valeur${all.length > 1 ? "s" : ""} sur ${kinds.length} type${kinds.length > 1 ? "s" : ""} de composant` }],
      data: { system, rule, byKind: kinds } satisfies RadiusData,
      media: [],
      locations: [],
      signature: `radius:${system}:${rule}`,
    });
  }

  const shadows = Object.entries(artifacts.dom.shadows)
    .filter(([value]) => visibleShadow(value) !== null)
    .map(([value, count]) => {
      const lengths = (value.replace(/rgba?\([^)]*\)|oklch\([^)]*\)|#[0-9a-f]+/gi, "").match(/-?[\d.]+px/g) ?? []).map((n) => parseFloat(n));
      return { value, blur: lengths[2] ?? 0, count };
    })
    .sort((a, b) => a.blur - b.blur)
    .slice(0, 8);
  if (shadows.length) {
    out.push({
      kind: "scale",
      subkind: "elevation",
      title: `Élévation · ${shadows.length} ombre${shadows.length > 1 ? "s" : ""}`,
      confidence: "sure",
      evidence: [{ origin: "dom", note: "ombres portées calculées, triées par flou" }],
      data: { shadows } satisfies ElevationData,
      media: [],
      locations: [],
      signature: `elevation:${shadows.map((s) => s.value).join("|")}`,
    });
  }
  return out;
}
