/**
 * Palette (§4.2): DOM usage weighted by what is actually seen, confirmed by a
 * k-means of the page's pixels, then roles by rule, first match wins.
 */

import type { Box, CaptureArtifacts, RgbKey, TextRun } from "../capture/artifacts.ts";
import { contrast, deltaE, grade, hexOfKey, hexOfLab, hueDistance, labOfKey, labOfRgb, oklchOfLab, round } from "./color.ts";
import type { Lab } from "./color.ts";
import type { ColorData, ContrastPair, Evidence, Finding, Origin, PaletteColor, PaletteData, RoleKey } from "./findings.ts";
import { kmeans } from "./kmeans.ts";
import type { Cluster } from "./kmeans.ts";
import type { Raster } from "./pixels.ts";

type DomColor = {
  key: RgbKey;
  lab: Lab;
  bgShare: number;
  textShare: number;
  border: number;
  interactiveShare: number;
  otherShare: number;
  elements: number;
  where: Record<string, number>;
  boxes: Box[];
  states: Partial<Record<"error" | "warning" | "success", number>>;
  cluster: Cluster | null;
};

export type PaletteResult = {
  palette: Finding<PaletteData>;
  colors: Finding<ColorData>[];
  imagery: Finding<PaletteData> | null;
  /** Role label of a colour within ΔE_OK 0.02 of a role, for component tokens (§4.4). */
  roleOf(key: RgbKey): string | null;
  fond: Lab | null;
  pixels: { labs: Float32Array; inImage: Uint8Array };
};

const WHERE: Record<string, string> = {
  h1: "titres", h2: "titres", h3: "titres", h4: "titres", h5: "titres", h6: "titres",
  a: "liens", button: "boutons", input: "champs", select: "champs", textarea: "champs", label: "étiquettes",
  p: "texte", span: "texte", li: "listes", td: "tableaux", th: "tableaux", blockquote: "citations",
  nav: "navigation", header: "en-tête", footer: "pied de page", section: "sections", main: "sections", article: "blocs",
  div: "blocs", svg: "icônes", figure: "figures", form: "formulaires", body: "page", html: "page", small: "texte",
  strong: "texte", em: "texte",
};

function usedOn(where: Record<string, number>): string[] {
  const words: Record<string, number> = {};
  for (const [tag, count] of Object.entries(where)) {
    const word = WHERE[tag] ?? "autres";
    words[word] = (words[word] ?? 0) + count;
  }
  return Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([word]) => word);
}

function colorName(lab: Lab, hex: string): string {
  const c = Math.hypot(lab.a, lab.b);
  if (lab.l >= 0.98 && c < 0.01) return "Blanc";
  if (lab.l <= 0.12 && c < 0.02) return "Noir";
  return hex;
}

/** Downscaled page → OKLab points and a mask of which ones sit inside an image box. */
export function pagePixels(raster: Raster, images: { box: Box }[]): { labs: Float32Array; inImage: Uint8Array } {
  const count = raster.width * raster.height;
  const labs = new Float32Array(count * 3);
  const inImage = new Uint8Array(count);
  const cache = new Map<number, Lab>();
  for (let i = 0; i < count; i += 1) {
    const r = raster.data[i * 3];
    const g = raster.data[i * 3 + 1];
    const b = raster.data[i * 3 + 2];
    const packed = (r << 16) | (g << 8) | b;
    let lab = cache.get(packed);
    if (!lab) {
      lab = labOfRgb(r, g, b);
      cache.set(packed, lab);
    }
    labs[i * 3] = lab.l;
    labs[i * 3 + 1] = lab.a;
    labs[i * 3 + 2] = lab.b;
  }
  for (const image of images) {
    const x0 = Math.max(0, Math.floor(image.box.x * raster.scale));
    const y0 = Math.max(0, Math.floor(image.box.y * raster.scale));
    const x1 = Math.min(raster.width, Math.ceil((image.box.x + image.box.width) * raster.scale));
    const y1 = Math.min(raster.height, Math.ceil((image.box.y + image.box.height) * raster.scale));
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) inImage[y * raster.width + x] = 1;
  }
  return { labs, inImage };
}

/** Median colour of a CSS-pixel box of the page: what is behind text set on a photo. */
function medianBehind(raster: Raster, box: Box): RgbKey | null {
  const x0 = Math.max(0, Math.floor(box.x * raster.scale));
  const y0 = Math.max(0, Math.floor(box.y * raster.scale));
  const x1 = Math.min(raster.width, Math.ceil((box.x + box.width) * raster.scale));
  const y1 = Math.min(raster.height, Math.ceil((box.y + box.height) * raster.scale));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * raster.width + x) * 3;
      rs.push(raster.data[i]);
      gs.push(raster.data[i + 1]);
      bs.push(raster.data[i + 2]);
    }
  }
  if (!rs.length) return null;
  const mid = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return `${mid(rs)},${mid(gs)},${mid(bs)}`;
}

export function analysePalette(artifacts: CaptureArtifacts, raster: Raster): PaletteResult {
  const pixels = pagePixels(raster, artifacts.dom.images);
  const { clusters, assignment } = kmeans(pixels.labs, { k: 12, iterations: 25, merge: 0.02 });
  const imageShare = clusters.map(() => 0);
  for (let i = 0; i < assignment.length; i += 1) if (pixels.inImage[i]) imageShare[assignment[i]] += 1;
  clusters.forEach((cluster, index) => {
    imageShare[index] = cluster.count ? imageShare[index] / cluster.count : 0;
  });

  // DOM usage, rounding twins merged.
  const totalText = artifacts.dom.colors.reduce((sum, c) => sum + c.textArea, 0) || 1;
  const totalInteractive = artifacts.dom.colors.reduce((sum, c) => sum + c.interactive, 0) || 1;
  const totalBorder = artifacts.dom.colors.reduce((sum, c) => sum + c.border, 0) || 1;
  const samples = artifacts.samples;
  const dom: DomColor[] = [];
  const add = (key: RgbKey): DomColor => {
    const lab = labOfKey(key);
    let entry = dom.find((d) => deltaE(d.lab, lab) < 0.006);
    if (!entry) {
      entry = { key, lab, bgShare: 0, textShare: 0, border: 0, interactiveShare: 0, otherShare: 0, elements: 0, where: {}, boxes: [], states: {}, cluster: null };
      dom.push(entry);
    }
    return entry;
  };
  for (const usage of artifacts.dom.colors) {
    const entry = add(usage.rgb);
    entry.textShare += usage.textArea / totalText;
    entry.border += usage.border / totalBorder;
    entry.interactiveShare += usage.interactive / totalInteractive;
    entry.otherShare += (usage.svg + usage.gradient) / (artifacts.page.width * artifacts.page.height || 1);
    entry.elements += usage.bgCount + usage.textCount;
    for (const [tag, n] of Object.entries(usage.where)) entry.where[tag] = (entry.where[tag] ?? 0) + n;
    for (const box of [...usage.bgBoxes, ...usage.textBoxes]) if (entry.boxes.length < 40) entry.boxes.push(box);
    for (const [state, n] of Object.entries(usage.states)) entry.states[state as "error"] = (entry.states[state as "error"] ?? 0) + (n ?? 0);
  }
  if (samples.total > 0) {
    for (const [key, n] of Object.entries(samples.bg)) add(key).bgShare += n / samples.total;
  }
  // Text roles rank by line length (characters × size), not glyph area:
  // area grows with size², and three large teal headings would outweigh
  // every paragraph; characters alone would crown the tiny UI labels.
  const totalLine = artifacts.dom.runs.reduce((sum, run) => sum + run.chars * run.size, 0);
  if (totalLine > 0) {
    for (const entry of dom) entry.textShare = 0;
    for (const run of artifacts.dom.runs) add(run.color).textShare += (run.chars * run.size) / totalLine;
  }
  // Each pixel cluster confirms one DOM colour: the nearest within ΔE_OK 0.03.
  for (const cluster of clusters) {
    let owner: DomColor | null = null;
    let bestD = 0.03;
    for (const entry of dom) {
      const d = deltaE(entry.lab, cluster.lab);
      if (d <= bestD) {
        bestD = d;
        owner = entry;
      }
    }
    if (owner && (!owner.cluster || owner.cluster.share < cluster.share)) owner.cluster = cluster;
  }
  for (const entry of dom) {
    const best = entry.cluster;
    // A version-1 capture has no grid samples: its background area is the pixel share of what it paints.
    if (samples.total === 0 && best && artifacts.dom.colors.some((c) => c.rgb === entry.key && c.bgCount > 0)) entry.bgShare = best.share;
  }

  const assigned = new Set<DomColor>();
  const roles: { entry: DomColor; role: string; key: RoleKey; note: string; runnerUp: boolean }[] = [];
  const assign = (entry: DomColor | undefined, role: string, key: RoleKey, note: string, runnerUp = false) => {
    if (!entry || assigned.has(entry) || roles.length >= 8) return;
    assigned.add(entry);
    roles.push({ entry, role, key, note, runnerUp });
  };

  const byBg = dom.filter((d) => d.bgShare > 0).sort((a, b) => b.bgShare - a.bgShare);
  const fond = byBg[0];
  assign(fond, "Fond", "background", "plus grande surface de fond");
  if (fond) {
    const surface = byBg.find((d) => d !== fond && Math.abs(d.lab.l - fond.lab.l) <= 0.08 && d.bgShare >= 0.03 && deltaE(d.lab, fond.lab) >= 0.01);
    assign(surface, "Surface", "surface", "fond voisin du fond, au moins 3 % de la page");
  }
  const fondHex = fond ? hexOfKey(fond.key) : "#ffffff";
  // A colour that fills a button is the accent even when headings also use it.
  const fillsControl = (d: DomColor) =>
    artifacts.dom.components.some((c) => (c.kind === "button" || c.kind === "link-button") && c.tokens.background && deltaE(labOfKey(c.tokens.background), d.lab) < 0.02) &&
    Math.hypot(d.lab.a, d.lab.b) >= 0.04;
  const byText = dom.filter((d) => d.textShare > 0 && !fillsControl(d)).sort((a, b) => b.textShare - a.textShare);
  const texte = byText.find((d) => !assigned.has(d) && contrast(hexOfKey(d.key), fondHex) >= 4.5);
  assign(texte, "Texte", "text", "plus grande part du texte, contraste ≥ 4,5 sur le fond");
  if (texte) {
    const texte2 = byText.find((d) => !assigned.has(d) && deltaE(d.lab, texte.lab) >= 0.05 && d.textShare >= 0.05);
    assign(texte2, "Texte 2", "text-muted", "second texte, au moins 5 % du texte");
  }
  const chroma = (d: DomColor) => Math.hypot(d.lab.a, d.lab.b);
  const chromatic = dom.filter((d) => !assigned.has(d) && chroma(d) >= 0.04);
  const interactive = chromatic.filter((d) => d.interactiveShare > 0).sort((a, b) => chroma(b) * b.interactiveShare - chroma(a) * a.interactiveShare);
  const accents = interactive.length
    ? interactive
    : chromatic.sort((a, b) => chroma(b) * (b.bgShare + b.textShare + b.otherShare) - chroma(a) * (a.bgShare + a.textShare + a.otherShare));
  const accent = accents[0];
  assign(accent, "Accent", "accent", interactive.length ? "chroma × part interactive la plus haute" : "aucune couleur vive sur un élément interactif : chroma × usage", !interactive.length);
  if (accent) {
    const accentLch = oklchOfLab(accent.lab);
    const second = accents.find((d) => d !== accent && !assigned.has(d) && (hueDistance(oklchOfLab(d.lab).h, accentLch.h) >= 30 || Math.abs(d.lab.l - accent.lab.l) >= 0.15));
    assign(second, "Accent 2", "accent-2", "second accent, teinte ou clarté distincte", !interactive.length);
  }
  const pageWidth = artifacts.page.width || 1280;
  const border = dom
    .filter((d) => !assigned.has(d) && d.border > 0)
    .sort((a, b) => b.border - a.border)
    .find((d) => artifacts.dom.colors.some((c) => deltaE(labOfKey(c.rgb), d.lab) < 0.006 && c.border >= pageWidth));
  assign(border, "Bordure", "border", "couleur de bordure la plus longue");
  for (const [state, key, label, hues] of [
    ["error", "error", "Erreur", [0, 40]],
    ["warning", "warning", "Avertissement", [40, 100]],
    ["success", "success", "Succès", [120, 175]],
  ] as const) {
    const hit = dom.find((d) => {
      if (assigned.has(d) || !(d.states[state] ?? 0) || chroma(d) < 0.06) return false;
      const h = oklchOfLab(d.lab).h;
      return state === "error" ? h <= hues[1] || h >= 340 : h >= hues[0] && h <= hues[1];
    });
    assign(hit, `État · ${label}`, key, "vue sur un élément marqué erreur, alerte ou succès");
  }

  const toColor = (entry: DomColor, role: string, key: RoleKey | null, note: string, runnerUp: boolean): PaletteColor => {
    const origins: Origin[] = ["dom"];
    const evidence: Evidence[] = [{ origin: "dom", note: `vu dans le DOM : ${entry.elements} élément${entry.elements > 1 ? "s" : ""}${entry.bgShare > 0 ? ` ; ${Math.round(entry.bgShare * 1000) / 10} % des points de la grille` : ""}` }];
    if (entry.cluster) {
      origins.push("pixels");
      evidence.push({ origin: "pixels", note: `vu dans les pixels : ${Math.round(entry.cluster.share * 1000) / 10} % de la page` });
    }
    const declared = artifacts.customProperties.find((p) => p.color && deltaE(labOfKey(p.color), entry.lab) < 0.006);
    if (declared) {
      origins.push("declared");
      evidence.push({ origin: "declared", note: `déclarée : ${declared.name}` });
    }
    evidence.push({ origin: "dom", note: `rôle : ${note}` });
    const confidence = runnerUp || artifacts.partial ? "check" : entry.cluster || declared ? "sure" : "probable";
    return {
      role,
      key,
      value: oklchOfLab(entry.lab),
      hex: hexOfKey(entry.key),
      share: round(entry.cluster ? Math.max(entry.cluster.share, entry.bgShare) : entry.bgShare, 4),
      textShare: round(entry.textShare, 4),
      usedOn: usedOn(entry.where),
      ...(declared ? { declaredAs: declared.name } : {}),
      origins,
      confidence,
      evidence,
      locations: entry.boxes,
    };
  };

  const colors = roles.map((r) => toColor(r.entry, r.role, r.key, r.note, r.runnerUp));
  const roleLabs = roles.map((r) => ({ lab: r.entry.lab, role: r.role }));
  const roleOf = (key: RgbKey): string | null => {
    const lab = labOfKey(key);
    let best: string | null = null;
    let bestD = 0.02;
    for (const r of roleLabs) {
      const d = deltaE(lab, r.lab);
      if (d < bestD) {
        bestD = d;
        best = r.role;
      }
    }
    return best;
  };

  // Everything else seen: unassigned DOM colours that matter, and pixel-only
  // clusters outside images (icons, canvas, gradients drawn in pixels).
  const others: PaletteData["others"] = [];
  for (const entry of dom) {
    if (assigned.has(entry)) continue;
    const share = entry.cluster ? entry.cluster.share : entry.bgShare;
    if (share < 0.002 && entry.textShare < 0.01 && entry.interactiveShare < 0.02) continue;
    others.push({ value: oklchOfLab(entry.lab), hex: hexOfKey(entry.key), share: round(share, 4), origins: entry.cluster ? ["dom", "pixels"] : ["dom"] });
  }
  const imageryClusters: { cluster: Cluster; index: number }[] = [];
  clusters.forEach((cluster, index) => {
    if (dom.some((d) => d.cluster === cluster)) return;
    if (imageShare[index] >= 0.5) imageryClusters.push({ cluster, index });
    else if (cluster.share >= 0.005) others.push({ value: oklchOfLab(cluster.lab), hex: hexOfLab(cluster.lab), share: round(cluster.share, 4), origins: ["pixels"] });
  });
  others.sort((a, b) => b.share - a.share);

  const pairs = contrastPairs(artifacts.dom.runs, raster, roleLabs);

  const theme = fond && fond.lab.l > 0.6 ? "light" : "dark";
  const confirmed = (role: string) => colors.find((c) => c.role === role)?.origins.includes("pixels") ?? false;
  const paletteConfidence = artifacts.partial ? "check" : confirmed("Fond") && confirmed("Texte") ? "sure" : "probable";
  const palette: Finding<PaletteData> = {
    kind: "palette",
    subkind: "interface",
    title: "Palette d'interface",
    confidence: paletteConfidence,
    evidence: [
      { origin: "dom", note: `${dom.length} couleurs distinctes dans le DOM, pondérées par surface, texte, bordure et usage interactif` },
      { origin: "pixels", note: `k-means OKLab (k = 12, graine fixe, 25 itérations) sur ${raster.width} × ${raster.height} pixels : ${clusters.length} groupes` },
      ...(samples.total ? [{ origin: "dom" as const, note: `grille de 24 px : ${samples.total} points, ${Math.round((samples.img / samples.total) * 100)} % sur une image` }] : []),
    ],
    data: { colors, pairs, others: others.slice(0, 12), theme },
    media: [],
    locations: [],
    signature: `palette:${colors.map((c) => `${c.key}=${c.hex}`).join(",")}`,
  };

  const colorFindings: Finding<ColorData>[] = colors.map((color) => ({
    kind: "color",
    subkind: color.key,
    title: `${color.role} ${color.hex}`,
    confidence: color.confidence,
    evidence: color.evidence,
    data: { color, palette: palette.signature },
    media: [],
    locations: color.locations,
    signature: `color:${color.hex}`,
  }));

  let imagery: Finding<PaletteData> | null = null;
  if (imageryClusters.length) {
    const imageryColors: PaletteColor[] = imageryClusters.slice(0, 6).map(({ cluster }, i) => ({
      role: `Image ${i + 1}`,
      key: "image",
      value: oklchOfLab(cluster.lab),
      hex: hexOfLab(cluster.lab),
      share: round(cluster.share, 4),
      textShare: 0,
      usedOn: ["images"],
      origins: ["pixels"],
      confidence: "probable",
      evidence: [{ origin: "pixels", note: `vu seulement dans les pixels des images : ${Math.round(cluster.share * 1000) / 10} % de la page` }],
      locations: [],
    }));
    imagery = {
      kind: "palette",
      subkind: "imagery",
      title: "Couleurs des photos",
      confidence: "probable",
      evidence: [{ origin: "pixels", note: "groupes de pixels sans couleur CSS correspondante, à plus de 50 % dans des boîtes d'image" }],
      data: { colors: imageryColors, pairs: [], others: [], theme },
      media: [],
      locations: artifacts.dom.images.map((image) => image.box).slice(0, 40),
      signature: `imagery:${imageryColors.map((c) => c.hex).join(",")}`,
    };
  }

  return { palette, colors: colorFindings, imagery, roleOf, fond: fond?.lab ?? null, pixels };
}

/**
 * Pairs that really occur: each text run's colour on what is behind it (the
 * DOM backdrop, or the photo's own pixels when the text sits on an image),
 * summed by text area.
 */
function contrastPairs(runs: TextRun[], raster: Raster, roles: { lab: Lab; role: string }[]): ContrastPair[] {
  type Snapped = { key: RgbKey; lab: Lab; role: string | null };
  const snap = (key: RgbKey): Snapped => {
    const lab = labOfKey(key);
    const role = roles.find((r) => deltaE(r.lab, lab) < 0.02);
    return { key, lab, role: role?.role ?? null };
  };
  type Acc = { fg: Snapped; bg: Snapped; glyph: number; large: boolean; where: Record<string, number>; button: string | null };
  const pairs = new Map<string, Acc>();
  let total = 0;
  for (const run of runs) {
    const behind = run.onImage || !run.background ? medianBehind(raster, run.box) : run.background;
    if (!behind) continue;
    const fg = snap(run.color);
    const bg = snap(behind);
    if (deltaE(fg.lab, bg.lab) < 0.01) continue;
    const id = `${fg.role ?? hexOfKey(fg.key)}|${bg.role ?? hexOfKey(bg.key)}`;
    let acc = pairs.get(id);
    if (!acc) {
      acc = { fg, bg, glyph: 0, large: true, where: {}, button: null };
      pairs.set(id, acc);
    }
    acc.glyph += run.glyph;
    total += run.glyph;
    const large = run.size >= 24 || (run.size >= 18.66 && run.weight >= 700);
    if (!large) acc.large = false;
    acc.where[run.tag] = (acc.where[run.tag] ?? 0) + 1;
    if (run.context.button && !acc.button) acc.button = run.text.slice(0, 40);
  }
  const all = [...pairs.values()].map((acc) => {
    const fgHex = hexOfKey(acc.fg.key);
    const bgHex = hexOfKey(acc.bg.key);
    const ratio = contrast(fgHex, bgHex);
    // "Blanc sur accent", not "Surface sur accent": a background role names a text colour badly.
    const fgRole = acc.fg.role && !["Fond", "Surface"].includes(acc.fg.role) ? acc.fg.role : null;
    const fgName = fgRole ?? colorName(acc.fg.lab, fgHex);
    const bgName = acc.bg.role ? acc.bg.role.toLowerCase() : colorName(acc.bg.lab, bgHex).replace(/^[BN]/, (c) => c.toLowerCase());
    return {
      fg: fgHex,
      bg: bgHex,
      label: `${fgName} sur ${bgName}`,
      wcag: round(ratio, 1),
      grade: grade(ratio, acc.large),
      where: acc.button ? `bouton « ${acc.button} »` : usedOn(acc.where).join(", "),
      share: round(acc.glyph / (total || 1), 4),
    } satisfies ContrastPair;
  });
  all.sort((a, b) => b.share - a.share);
  const top = all.slice(0, 6);
  // A failing pair is worth surfacing even when it is small: it is exactly
  // what an agent would copy without noticing (the sand button, 2.0).
  for (const pair of all.slice(6, 16)) if (pair.grade === "fail" && top.length < 9) top.push(pair);
  return top;
}
