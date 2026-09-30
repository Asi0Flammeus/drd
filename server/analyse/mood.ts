/**
 * Imagery and mood (§4.6): numbers measured inside image boxes, then words
 * chosen by fixed thresholds. The words are only ever as good as the
 * thresholds, so every word is shown with its number.
 */

import type { CaptureArtifacts } from "../capture/artifacts.ts";
import { deltaE, hexOfLab, oklchOfLab, round } from "./color.ts";
import type { Lab } from "./color.ts";
import type { Finding, MoodData, MoodImage, PageData } from "./findings.ts";
import { kmeans } from "./kmeans.ts";
import type { Raster } from "./pixels.ts";

export function words(meanL: number, meanC: number, meanB: number, stdL: number): MoodData["descriptors"] {
  return [
    { name: "Luminosité", word: meanL < 0.4 ? "sombre" : meanL > 0.7 ? "lumineuse" : "moyenne", value: round(meanL, 3), unit: "L moyen" },
    { name: "Saturation", word: meanC < 0.03 ? "sourde" : meanC > 0.08 ? "vive" : "mesurée", value: round(meanC, 3), unit: "C moyen" },
    { name: "Température", word: meanB > 0.01 ? "chaude" : meanB < -0.01 ? "froide" : "neutre", value: round(meanB, 3), unit: "b moyen (OKLab)" },
    { name: "Contraste", word: stdL < 0.12 ? "doux" : stdL > 0.22 ? "marqué" : "moyen", value: round(stdL, 3), unit: "écart-type de L" },
  ];
}

export function densityWord(share: number): string {
  if (share > 0.55) return "aérée";
  if (share >= 0.3) return "équilibrée";
  return "dense";
}

export function analyseMood(
  artifacts: CaptureArtifacts,
  raster: Raster,
  pixels: { labs: Float32Array },
  fond: Lab | null,
): { mood: Finding<MoodData>; page: Finding<PageData> } {
  const images: MoodImage[] = [];
  const all: number[] = [];
  const boxes = artifacts.dom.images
    .slice()
    .sort((a, b) => b.box.width * b.box.height - a.box.width * a.box.height)
    .slice(0, 24);
  for (const image of boxes) {
    const x0 = Math.max(0, Math.floor(image.box.x * raster.scale));
    const y0 = Math.max(0, Math.floor(image.box.y * raster.scale));
    const x1 = Math.min(raster.width, Math.ceil((image.box.x + image.box.width) * raster.scale));
    const y1 = Math.min(raster.height, Math.ceil((image.box.y + image.box.height) * raster.scale));
    const indices: number[] = [];
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) indices.push(y * raster.width + x);
    if (indices.length < 16) continue;
    const labs = new Float32Array(indices.length * 3);
    let sumL = 0;
    let sumC = 0;
    let sumB = 0;
    const bins = new Map<number, number>();
    indices.forEach((index, i) => {
      const l = pixels.labs[index * 3];
      const a = pixels.labs[index * 3 + 1];
      const b = pixels.labs[index * 3 + 2];
      labs[i * 3] = l;
      labs[i * 3 + 1] = a;
      labs[i * 3 + 2] = b;
      sumL += l;
      sumC += Math.hypot(a, b);
      sumB += b;
      // 16 levels per channel; a colour counts when it holds ≥ 0.2 % of the image.
      const r = raster.data[index * 3] >> 4;
      const g = raster.data[index * 3 + 1] >> 4;
      const bl = raster.data[index * 3 + 2] >> 4;
      const bin = (r << 8) | (g << 4) | bl;
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
      all.push(index);
    });
    const n = indices.length;
    const meanL = sumL / n;
    let variance = 0;
    for (let i = 0; i < n; i += 1) variance += (labs[i * 3] - meanL) ** 2;
    const distinct = [...bins.values()].filter((count) => count / n >= 0.002).length;
    const { clusters } = kmeans(labs, { k: 5, iterations: 15, merge: 0.03 });
    images.push({
      box: image.box,
      palette: clusters.map((c) => hexOfLab(c.lab)),
      meanL: round(meanL, 3),
      meanC: round(sumC / n, 3),
      meanB: round(sumB / n, 3),
      stdL: round(Math.sqrt(variance / n), 3),
      distinct,
      nature: distinct < 32 ? "aplat" : "photo",
      crop: null,
    });
  }

  let data: MoodData;
  const total = raster.width * raster.height;
  let nearFond = 0;
  if (fond) {
    for (let i = 0; i < total; i += 1) {
      if (deltaE({ l: pixels.labs[i * 3], a: pixels.labs[i * 3 + 1], b: pixels.labs[i * 3 + 2] }, fond) <= 0.02) nearFond += 1;
    }
  }
  const density = { share: round(nearFond / (total || 1), 3), word: densityWord(nearFond / (total || 1)) };
  if (all.length) {
    const labs = new Float32Array(all.length * 3);
    let sumL = 0;
    let sumC = 0;
    let sumB = 0;
    all.forEach((index, i) => {
      labs[i * 3] = pixels.labs[index * 3];
      labs[i * 3 + 1] = pixels.labs[index * 3 + 1];
      labs[i * 3 + 2] = pixels.labs[index * 3 + 2];
      sumL += labs[i * 3];
      sumC += Math.hypot(labs[i * 3 + 1], labs[i * 3 + 2]);
      sumB += labs[i * 3 + 2];
    });
    const meanL = sumL / all.length;
    let variance = 0;
    for (let i = 0; i < all.length; i += 1) variance += (labs[i * 3] - meanL) ** 2;
    const { clusters } = kmeans(labs, { k: 6, iterations: 20, merge: 0.03 });
    const photoArea = images.filter((i) => i.nature === "photo").reduce((s, i) => s + i.box.width * i.box.height, 0);
    const flatArea = images.filter((i) => i.nature === "aplat").reduce((s, i) => s + i.box.width * i.box.height, 0);
    data = {
      images: images.slice(0, 6),
      palette: clusters.map((c) => ({ hex: hexOfLab(c.lab), value: oklchOfLab(c.lab), share: round(c.share, 3) })),
      descriptors: words(meanL, sumC / all.length, sumB / all.length, Math.sqrt(variance / all.length)),
      density,
      nature: photoArea >= flatArea ? "photo" : "aplat",
    };
  } else {
    data = { images: [], palette: [], descriptors: [], density, nature: null };
  }

  const mood: Finding<MoodData> = {
    kind: "mood",
    subkind: null,
    title: data.descriptors.length ? `Ambiance ${data.descriptors.map((d) => d.word).join(", ")}` : `Ambiance sans image, page ${density.word}`,
    confidence: "probable",
    evidence: [
      { origin: "pixels", note: `${images.length} image${images.length > 1 ? "s" : ""} mesurée${images.length > 1 ? "s" : ""} dans la page assemblée` },
      { origin: "pixels", note: `densité : ${Math.round(density.share * 100)} % des pixels à ΔE ≤ 0,02 du fond` },
      { origin: "dom", note: "les mots sont des seuils fixes sur ces nombres" },
    ],
    data,
    media: [],
    locations: data.images.map((i) => i.box),
    signature: `mood:${data.images.map((i) => `${i.box.x},${i.box.y}`).join("|")}`,
  };

  const meta = artifacts.meta;
  const page: Finding<PageData> = {
    kind: "page",
    subkind: null,
    title: meta.title || new URL(artifacts.url).hostname,
    confidence: "sure",
    evidence: [{ origin: "dom", note: "balises du document et dimensions mesurées" }],
    data: {
      url: artifacts.url,
      title: meta.title ?? "",
      description: meta.description ?? "",
      lang: meta.lang ?? "",
      siteName: meta.siteName ?? "",
      themeColor: meta.themeColor ?? "",
      favicon: meta.favicon ?? "",
      generator: meta.generator ?? "",
      width: artifacts.page.width,
      height: artifacts.page.height,
      darkScheme: artifacts.darkScheme,
      capturedAt: artifacts.capturedAt,
      partial: artifacts.partial,
    },
    media: [artifacts.media.page],
    locations: [],
    signature: `page:${artifacts.url}`,
  };
  return { mood, page };
}
