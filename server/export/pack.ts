/**
 * Export packs: the deliverable.
 *
 * A pack is what you hand an agent — or a human — instead of a link to one
 * site you want copied. It is built from stored rows only: no model call, no
 * network, nothing that can be unavailable when you need the pack. If an LLM
 * is configured it can talk about a pack; it can never be required to produce
 * one.
 *
 * Determinism is a hard requirement: same rows in, same bytes out.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import { db } from "../db.ts";
import { zip } from "./zip.ts";
import type { ZipEntry } from "./zip.ts";

export type PackRow = { id: string; user_id: string; name: string; brief: string; ref_ids: string; created_at: string };

type RefRow = {
  id: string;
  type: string;
  title: string;
  source_url: string | null;
  source_host: string | null;
  image: string | null;
  payload: string;
  provenance: string;
  what: string;
  why: string;
  tags: string;
  created_at: string;
  capture_title: string | null;
  capture_url: string | null;
};

type Ref = Omit<RefRow, "payload" | "provenance" | "tags"> & {
  payload: Record<string, unknown>;
  provenance: Record<string, unknown>;
  tags: string[];
};

const ANTI_COPY = `## Comment utiliser ce pack

Ces références ne sont **pas** une maquette à reproduire. Chacune isole une
décision précise — un rythme typographique, une densité, un contraste, une
mécanique d'interaction — et dit *pourquoi* elle a été retenue.

Règles d'usage, non négociables :

1. **Mélanger, jamais décalquer.** Aucune page produite à partir de ce pack ne
   doit pouvoir être identifiée comme la copie d'un des sites cités. Croisez au
   minimum trois sources ; si une seule source domine le résultat, recommencez.
2. **Reprendre le principe, pas les pixels.** « Titre 4× le corps de texte, une
   seule couleur d'accent » se reprend ; la mise en page exacte d'un concurrent,
   non.
3. **Ne jamais réutiliser les contenus.** Textes, photographies, logos,
   illustrations et polices sous licence appartiennent aux sites capturés.
   Les captures d'écran de ce pack servent de référence visuelle privée.
4. **Adapter au métier du client.** Une référence choisie pour un studio de
   design ne transfère pas telle quelle à un restaurant ou à un cabinet.
5. **Le « pourquoi » prime sur le « quoi ».** En cas d'arbitrage, respectez
   l'intention notée, pas la capture.
`;

export function loadPackRefs(userId: string, refIds: string[]): Ref[] {
  if (refIds.length === 0) return [];
  const placeholders = refIds.map(() => "?").join(", ");
  const rows = db()
    .prepare(
      `SELECT r.id, r.type, r.title, r.source_url, r.source_host, r.image, r.payload, r.provenance,
              r.what, r.why, r.tags, r.created_at,
              c.title AS capture_title, c.final_url AS capture_url
       FROM refs r LEFT JOIN captures c ON c.id = r.capture_id
       WHERE r.user_id = ? AND r.id IN (${placeholders})`,
    )
    .all(userId, ...refIds) as RefRow[];

  const parsed = rows.map((row) => ({
    ...row,
    payload: safeObject(row.payload),
    provenance: safeObject(row.provenance),
    tags: safeArray(row.tags),
  }));
  // Stable order: the order the user saved them, never row order from SQLite.
  return parsed.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

function safeObject(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function safeArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function distinctSources(refs: Ref[]): string[] {
  return [...new Set(refs.map((ref) => ref.source_host ?? "atelier-local"))].sort();
}

function slug(text: string, fallback: string): string {
  const cleaned = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return cleaned || fallback;
}

const TYPE_LABEL: Record<string, string> = {
  site: "Site",
  component: "Composant",
  font: "Typographie",
  palette: "Palette",
  image: "Image",
};

function referencesMarkdown(pack: PackRow, refs: Ref[], sources: string[], imageNames: Record<string, string>): string {
  const lines: string[] = [
    `# ${pack.name}`,
    "",
    `Pack de références DRD — ${refs.length} référence(s), ${sources.length} source(s) distincte(s).`,
    `Créé le ${pack.created_at.slice(0, 10)}.`,
    "",
  ];
  if (pack.brief.trim()) lines.push("## Intention", "", pack.brief.trim(), "");
  lines.push(ANTI_COPY, "## Sources citées", "");
  for (const source of sources) lines.push(`- ${source}`);
  lines.push("", "## Références", "");

  for (const ref of refs) {
    lines.push(`### ${ref.title}`, "");
    lines.push(`- **Type** : ${TYPE_LABEL[ref.type] ?? ref.type}`);
    if (ref.source_url) lines.push(`- **Provenance** : ${ref.source_url}`);
    if (ref.capture_title) lines.push(`- **Page capturée** : ${ref.capture_title}`);
    lines.push(`- **Capturé le** : ${ref.created_at.slice(0, 10)}`);
    if (ref.tags.length) lines.push(`- **Tags** : ${ref.tags.join(", ")}`);
    const image = imageNames[ref.id];
    if (image) lines.push(`- **Visuel** : \`${image}\``);
    lines.push("");
    if (ref.what.trim()) lines.push(`**Ce que c'est** — ${ref.what.trim()}`, "");
    if (ref.why.trim()) lines.push(`**Pourquoi c'est retenu** — ${ref.why.trim()}`, "");
    const styles = ref.payload.styles;
    if (styles && typeof styles === "object" && !Array.isArray(styles)) {
      const entries = Object.entries(styles).filter(
        ([, value]) => typeof value === "string" && value !== "none" && value !== "",
      );
      if (entries.length) {
        lines.push("Valeurs observées dans le navigateur :", "");
        lines.push("```");
        for (const [key, value] of entries.slice(0, 18)) lines.push(`${key}: ${String(value)}`);
        lines.push("```", "");
      }
    }
    if (image) lines.push(`![${ref.title}](${image})`, "");
    lines.push("---", "");
  }
  return lines.join("\n");
}

function promptMarkdown(pack: PackRow, refs: Ref[], sources: string[]): string {
  const byType: Record<string, Ref[]> = {};
  for (const ref of refs) (byType[ref.type] ??= []).push(ref);

  const lines: string[] = [
    "# Brief de design — à donner tel quel à un agent",
    "",
    `Projet : **${pack.name}**`,
    "",
  ];
  if (pack.brief.trim()) lines.push(pack.brief.trim(), "");
  lines.push(
    "Tu construis une interface à partir des références ci-dessous. Elles viennent",
    `de ${sources.length} site(s) différent(s), observés dans un vrai navigateur :`,
    "les valeurs citées sont mesurées, pas estimées.",
    "",
    "**Interdit** : reproduire la mise en page d'une source. **Attendu** : croiser",
    "les principes retenus pour produire quelque chose qui n'existe pas encore.",
    "",
  );
  for (const [type, group] of Object.entries(byType).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`## ${TYPE_LABEL[type] ?? type}`, "");
    for (const ref of group) {
      const source = ref.source_host ? ` — ${ref.source_host}` : "";
      lines.push(`- **${ref.title}**${source}`);
      if (ref.what.trim()) lines.push(`  - Ce que c'est : ${ref.what.trim()}`);
      if (ref.why.trim()) lines.push(`  - Pourquoi : ${ref.why.trim()}`);
      if (ref.tags.length) lines.push(`  - Tags : ${ref.tags.join(", ")}`);
    }
    lines.push("");
  }
  lines.push(
    "## Contrôle avant livraison",
    "",
    "- [ ] Au moins trois sources ont influencé le résultat.",
    "- [ ] Aucune section n'est reconnaissable comme venant d'un site précis.",
    "- [ ] Chaque décision de design peut être rattachée à un « pourquoi » ci-dessus.",
    "- [ ] Aucun contenu (texte, image, logo) n'a été repris d'une source.",
    "",
  );
  return lines.join("\n");
}

function tokensCss(pack: PackRow, refs: Ref[]): string {
  const lines: string[] = [
    `/* ${pack.name} — jetons extraits des références DRD.`,
    "   Valeurs observées sur les sites cités : point de départ, pas vérité. */",
    "",
  ];
  for (const ref of refs) {
    const prefix = `--drd-${slug(ref.title, ref.id.slice(0, 8))}`;
    const block: string[] = [];

    const css = ref.payload.css;
    if (typeof css === "string" && css.trim()) {
      lines.push(`/* ${ref.title} — jetons du playground */`, css.trim(), "");
      continue;
    }

    const ramp = ref.payload.ramp;
    if (Array.isArray(ramp)) {
      ramp.forEach((value, index) => {
        if (typeof value === "string") block.push(`  ${prefix}-step-${index + 1}: ${value};`);
      });
    }
    const colors = ref.payload.colors;
    if (Array.isArray(colors)) {
      colors.forEach((entry, index) => {
        if (!entry || typeof entry !== "object" || !("hex" in entry)) return;
        const hex = entry.hex;
        if (typeof hex === "string") block.push(`  ${prefix}-color-${index + 1}: ${hex};`);
      });
    }
    const styles = ref.payload.styles;
    if (styles && typeof styles === "object" && !Array.isArray(styles)) {
      const wanted: Record<string, string> = {
        fontFamily: "font-family",
        fontSize: "font-size",
        fontWeight: "font-weight",
        lineHeight: "line-height",
        letterSpacing: "letter-spacing",
        color: "color",
        backgroundColor: "background",
        borderRadius: "radius",
        borderWidth: "border-width",
        boxShadow: "shadow",
        padding: "padding",
      };
      for (const [key, value] of Object.entries(styles)) {
        const name = wanted[key];
        if (name && typeof value === "string" && value && value !== "none") block.push(`  ${prefix}-${name}: ${value};`);
      }
    }
    if (block.length) {
      lines.push(`/* ${ref.title}${ref.source_host ? ` — ${ref.source_host}` : ""} */`, ":root {", ...block, "}", "");
    }
  }
  return lines.join("\n");
}

export type BuiltPack = { entries: ZipEntry[]; warnings: string[]; sources: string[]; refCount: number };

export function buildPack(pack: PackRow, refs: Ref[]): BuiltPack {
  const sources = distinctSources(refs);
  const warnings: string[] = [];
  if (sources.length < 3) {
    warnings.push(
      `Ce pack ne cite que ${sources.length} source(s). Un brief construit sur moins de trois inspirations produit une copie, pas une synthèse.`,
    );
  }

  const imageNames: Record<string, string> = {};
  const images: ZipEntry[] = [];
  refs.forEach((ref, index) => {
    if (!ref.image) return;
    const absolute = join(config.mediaDir, ref.image);
    let data: Buffer;
    try {
      data = readFileSync(absolute);
    } catch {
      warnings.push(`Visuel introuvable pour « ${ref.title} » — la référence reste dans le pack sans image.`);
      return;
    }
    const extension = ref.image.endsWith(".png") ? "png" : "jpg";
    const name = `images/${String(index + 1).padStart(2, "0")}-${slug(ref.title, ref.id.slice(0, 8))}.${extension}`;
    imageNames[ref.id] = name;
    images.push({ name, data });
  });

  const manifest = {
    pack: { id: pack.id, name: pack.name, brief: pack.brief, createdAt: pack.created_at },
    sources,
    warnings,
    antiCopy: {
      rule: "mix-do-not-clone",
      minimumSources: 3,
      statement: "Aucun rendu issu de ce pack ne doit être identifiable comme la copie d'une source.",
    },
    references: refs.map((ref) => ({
      id: ref.id,
      type: ref.type,
      title: ref.title,
      what: ref.what,
      why: ref.why,
      tags: ref.tags,
      sourceUrl: ref.source_url,
      sourceHost: ref.source_host,
      capturedAt: ref.created_at,
      image: imageNames[ref.id] ?? null,
      provenance: ref.provenance,
      payload: ref.payload,
    })),
  };

  const entries: ZipEntry[] = [
    { name: "README.md", data: Buffer.from(referencesMarkdown(pack, refs, sources, imageNames), "utf8") },
    { name: "prompt.md", data: Buffer.from(promptMarkdown(pack, refs, sources), "utf8") },
    { name: "tokens.css", data: Buffer.from(tokensCss(pack, refs), "utf8") },
    { name: "pack.json", data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8") },
    ...images,
  ];

  return { entries, warnings, sources, refCount: refs.length };
}

export function packZip(built: BuiltPack): Buffer {
  return zip(built.entries);
}
