/**
 * Agent packs (§5.6): the deliverable handed to an agent or a codebase.
 *
 * Built from stored items only: no model call, no network, nothing that can
 * be unavailable when the pack is needed. Deterministic: same items in, same
 * bytes out. The anti-copy rules are enforced here, not in the client: a
 * pack from a single host is refused unless confirmed, fewer than three hosts
 * and items without a reason are warned about.
 */

import { readFileSync } from "node:fs";
import { blobPath } from "../library/blobs.ts";
import type { ItemView } from "../library/index.ts";
import { buildBrief, buildDesignMd, whatToTake } from "./brief.ts";
import type { PackInfo } from "./brief.ts";
import { slug, toCss, toDtcg, toTailwind } from "./tokens.ts";
import { zip } from "./zip.ts";
import type { ZipEntry } from "./zip.ts";

export const FORMATS = ["tokens", "css", "tailwind", "brief"] as const;
export type Format = (typeof FORMATS)[number];

export type Warning = { level: "refuse" | "warn"; message: string };

export function distinctSources(items: ItemView[]): string[] {
  return [...new Set(items.map((item) => item.sourceHost ?? "atelier"))].sort();
}

/** The export's rules, in the order the wizard shows them. */
export function packWarnings(items: ItemView[], allowSingleSource: boolean): Warning[] {
  const warnings: Warning[] = [];
  const sources = distinctSources(items);
  const hosts = sources.filter((s) => s !== "atelier");
  if (sources.length === 1 && hosts.length === 1 && !allowSingleSource) {
    warnings.push({ level: "refuse", message: `Tout vient de ${hosts[0]}. Un brief tiré d'un seul site produit une copie : ajoutez une autre source, ou confirmez explicitement.` });
  }
  if (sources.length < 3) warnings.push({ level: "warn", message: `Seulement ${sources.length} source${sources.length > 1 ? "s" : ""} (${sources.join(", ")}). En dessous de trois, le résultat tend vers la copie.` });
  const silent = items.filter((item) => !item.why.trim());
  if (silent.length) warnings.push({ level: "warn", message: `${silent.length} élément${silent.length > 1 ? "s" : ""} sans raison : ${silent.map((i) => `« ${i.title} »`).join(", ")}. L'agent ne saura pas quoi en retenir.` });
  return warnings;
}

export type BuiltPack = { entries: ZipEntry[]; warnings: Warning[]; sources: string[]; itemCount: number };

export function buildPack(pack: PackInfo, items: ItemView[], formats: readonly Format[], allowSingleSource = true): BuiltPack {
  const sources = distinctSources(items);
  const warnings = packWarnings(items, allowSingleSource);
  const entries: ZipEntry[] = [];
  const want = new Set(formats);

  const images: ZipEntry[] = [];
  const imageNames: Record<string, string> = {};
  items.forEach((item, index) => {
    if (!item.cover) return;
    let data: Buffer;
    try {
      data = readFileSync(blobPath(item.cover));
    } catch {
      warnings.push({ level: "warn", message: `Image introuvable pour « ${item.title} » : l'élément reste dans le pack sans image.` });
      return;
    }
    const extension = data[0] === 0x89 ? "png" : data.subarray(8, 12).toString("latin1") === "WEBP" ? "webp" : "jpg";
    const name = `images/${String(index + 1).padStart(2, "0")}-${slug(item.title, item.id.slice(0, 8))}.${extension}`;
    imageNames[item.id] = name;
    images.push({ name, data });
  });

  if (want.has("brief")) {
    entries.push({ name: "BRIEF.md", data: Buffer.from(buildBrief(pack, items, sources), "utf8") });
    entries.push({ name: "DESIGN.md", data: Buffer.from(buildDesignMd(pack, items, sources), "utf8") });
  }
  if (want.has("tokens")) entries.push({ name: "tokens.json", data: Buffer.from(toDtcg(items), "utf8") });
  if (want.has("css")) entries.push({ name: "tokens.css", data: Buffer.from(toCss(items, pack.name), "utf8") });
  if (want.has("tailwind")) entries.push({ name: "theme.css", data: Buffer.from(toTailwind(items, pack.name), "utf8") });

  const manifest = {
    pack: { id: pack.id, name: pack.name, brief: pack.brief, createdAt: pack.createdAt, formats: [...want] },
    sources,
    warnings,
    antiCopy: { rule: "mix-do-not-clone", minimumSources: 3, statement: "Aucun rendu issu de ce pack ne doit être identifiable comme la copie d'une source." },
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      subkind: item.subkind,
      title: item.title,
      take: whatToTake(item),
      why: item.why,
      what: item.what,
      tags: item.tags,
      sourceUrl: item.sourceUrl,
      sourceHost: item.sourceHost,
      confidence: item.confidence,
      keptAt: item.createdAt,
      image: imageNames[item.id] ?? null,
      provenance: item.provenance,
      data: item.data,
    })),
  };
  entries.push({ name: "pack.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") });

  const readme = [
    `# ${pack.name}`,
    "",
    `Pack DRD du ${pack.createdAt.slice(0, 10)} : ${items.length} élément${items.length > 1 ? "s" : ""}, ${sources.length} source${sources.length > 1 ? "s" : ""}.`,
    "",
    "## Fichiers",
    "",
    ...(want.has("brief") ? ["- `BRIEF.md` : la demande, quoi prendre dans chaque élément et pourquoi, les règles, la liste de contrôle.", "- `DESIGN.md` : le système décrit (couleurs, typographie, composants, échelles, ambiance)."] : []),
    ...(want.has("tokens") ? ["- `tokens.json` : jetons au format DTCG 2025.10 (couleurs en OKLCH, hex en secours)."] : []),
    ...(want.has("css") ? ["- `tokens.css` : les mêmes jetons en propriétés CSS, nommées par rôle."] : []),
    ...(want.has("tailwind") ? ["- `theme.css` : un bloc `@theme` Tailwind v4."] : []),
    "- `pack.json` : le manifeste complet, provenance comprise.",
    ...(images.length ? ["- `images/` : l'élément extrait de chaque référence (découpe, spécimen), jamais une page entière."] : []),
    "",
    "## Provenance",
    "",
    ...items.map((item) => {
      const p = item.provenance as { capturedAt?: string };
      return `- ${item.title} : ${item.sourceUrl ?? "atelier"}${p.capturedAt ? `, capturé le ${p.capturedAt.slice(0, 10)}` : ""}${imageNames[item.id] ? ` · \`${imageNames[item.id]}\`` : ""}`;
    }),
    "",
    ...(warnings.length ? ["## Avertissements", "", ...warnings.map((w) => `- ${w.message}`), ""] : []),
  ];
  entries.push({ name: "README.md", data: Buffer.from(readme.join("\n"), "utf8") });
  if (want.has("brief")) entries.push(...images);

  return { entries, warnings, sources, itemCount: items.length };
}

export function packZip(built: BuiltPack): Buffer {
  return zip(built.entries);
}
