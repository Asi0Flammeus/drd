/**
 * The words of an agent pack (§5.6): BRIEF.md says what to take from each
 * item and why, DESIGN.md describes the resulting system the way Refero
 * Styles and Dembrandt hand one to an agent. Pure: items in, Markdown out.
 */

import type { ItemView } from "../library/index.ts";

export type PackInfo = { id: string; name: string; brief: string; createdAt: string };

export const ANTI_COPY = `## Règles d'usage

Ces références ne sont **pas** une maquette à reproduire. Chacune isole une
décision précise (un rythme typographique, une densité, un contraste, une
mécanique d'interaction) et dit *pourquoi* elle a été retenue.

1. **Mélanger, jamais décalquer.** Aucune page produite à partir de ce pack ne
   doit pouvoir être identifiée comme la copie d'un des sites cités. Croisez au
   minimum trois sources ; si une seule source domine le résultat, recommencez.
2. **Reprendre le principe, pas les pixels.** « Titre 4 fois le corps, un seul
   accent » se reprend ; la mise en page exacte d'un site, non.
3. **Ne jamais réutiliser les contenus.** Textes, photographies, logos,
   illustrations et polices sous licence appartiennent aux sites capturés. Les
   images de ce pack sont une référence visuelle privée.
4. **Adapter au métier du client.** Une référence choisie pour un institut ne
   se transpose pas telle quelle à un restaurant.
5. **Le « pourquoi » prime sur le « quoi ».** En cas d'arbitrage, respectez
   l'intention notée, pas la capture.
`;

type Data = Record<string, unknown>;
const list = (value: unknown): Data[] => (Array.isArray(value) ? value.filter((v): v is Data => Boolean(v) && typeof v === "object") : []);

const KIND_LABEL: Record<string, string> = { palette: "Palette", color: "Couleur", type: "Typographie", component: "Composant", scale: "Échelle", mood: "Ambiance", page: "Page" };

/** One line saying what to take from an item, from its data alone. */
export function whatToTake(item: ItemView): string {
  const d = (item.data ?? {}) as Data;
  switch (item.kind) {
    case "palette": {
      const colors = list(d.colors);
      const roles = colors.filter((c) => c.key || c.role).map((c) => `${c.role} ${c.hex}`).slice(0, 8);
      return roles.length ? `les rôles de couleur : ${roles.join(", ")}` : "la palette";
    }
    case "color": {
      const c = (d.color ?? {}) as Data;
      return `la couleur ${String(c.role ?? "")} ${String(c.hex ?? "")}`.trim();
    }
    case "type":
      if (item.subkind === "scale") return `l'échelle : corps ${String(d.body ?? "?")} px${d.ratio ? `, rapport ${String(d.ratio)} (${String(d.ratioName)})` : ", tailles libres"}`;
      if (item.subkind === "pair") return `la paire ${String((d.display as Data | undefined)?.family ?? "?")} (titres) + ${String((d.text as Data | undefined)?.family ?? "?")} (texte)`;
      if (typeof d.family === "string") return `la famille ${d.family}${Array.isArray(d.weights) ? ` (graisses ${d.weights.join(", ")})` : ""}`;
      return "le choix typographique";
    case "component":
      return `le ${String(d.kindLabel ?? "composant").toLowerCase()} « ${String(d.label ?? item.title)} » : ses jetons, pas son contenu`;
    case "scale":
      if (item.subkind === "spacing") return `l'espacement base ${String(d.base)} (${Array.isArray(d.steps) ? d.steps.join(" ") : ""})`;
      if (item.subkind === "radius") return `les rayons : ${String(d.rule ?? d.system ?? "")}`;
      return "les ombres";
    case "mood":
      if (item.subkind === "image-original") return "l'image de référence originale, ses palettes et ses tags validés";
      if (item.subkind === "image-derivative") return "la variation générée, reliée à son original et à sa consigne";
      return `l'ambiance : ${list(d.descriptors).map((x) => `${String(x.name).toLowerCase()} ${String(x.word)}`).join(", ")}`;
    case "page":
      return "la page comme ensemble (structure, rythme), jamais sa mise en page exacte";
    default:
      return item.title;
  }
}

export function buildBrief(pack: PackInfo, items: ItemView[], sources: string[]): string {
  const lines = [`# Brief de design : ${pack.name}`, ""];
  if (pack.brief.trim()) lines.push("## La demande", "", pack.brief.trim(), "");
  lines.push(
    `Tu construis une interface à partir de ${items.length} élément${items.length > 1 ? "s" : ""} venant de ${sources.length} source${sources.length > 1 ? "s" : ""}.`,
    "Les valeurs sont mesurées dans un vrai navigateur (styles calculés, pixels), pas estimées. Les jetons sont dans `tokens.json`, `tokens.css` et `theme.css` ; le système qu'ils décrivent est dans `DESIGN.md`.",
    "",
    "## Ce qu'il faut prendre, et pourquoi",
    "",
  );
  for (const item of items) {
    const source = item.sourceHost ?? "atelier";
    lines.push(`- **${KIND_LABEL[item.kind] ?? item.kind} · ${item.title}** (${source})`);
    lines.push(`  - Prendre : ${whatToTake(item)}`);
    lines.push(`  - Pourquoi : ${item.why.trim() || "_sans raison notée : à arbitrer avant usage_"}`);
    if (item.tags.length) lines.push(`  - Tags : ${item.tags.join(", ")}`);
  }
  lines.push(
    "",
    ANTI_COPY,
    "## Contrôle avant livraison",
    "",
    "- [ ] Au moins trois sources ont influencé le résultat.",
    "- [ ] Aucune section n'est reconnaissable comme venant d'un site précis.",
    "- [ ] Chaque décision de design se rattache à un « pourquoi » ci-dessus.",
    "- [ ] Aucun contenu (texte, image, logo, fichier de police sous licence) n'a été repris.",
    "- [ ] Les contrastes marqués « échec » dans DESIGN.md ne sont pas reproduits.",
    "",
  );
  return lines.join("\n");
}

export function buildDesignMd(pack: PackInfo, items: ItemView[], sources: string[]): string {
  const lines = [`# ${pack.name} · système de design`, "", `Assemblé avec DRD le ${pack.createdAt.slice(0, 10)} à partir de ${sources.join(", ")}.`, ""];
  const by = (kind: string) => items.filter((i) => i.kind === kind);

  const palettes = [...by("palette"), ...by("color")];
  if (palettes.length) {
    lines.push("## Couleurs", "", "| Rôle | OKLCH | Hex | Source | Pourquoi |", "|---|---|---|---|---|");
    for (const item of palettes) {
      const d = (item.data ?? {}) as Data;
      const colors = item.kind === "color" ? [d.color as Data] : list(d.colors);
      for (const c of colors) {
        if (!c) continue;
        const v = (c.value ?? {}) as { l?: number; c?: number; h?: number };
        lines.push(`| ${String(c.role ?? "")} | oklch(${v.l ?? "?"} ${v.c ?? "?"} ${v.h ?? "?"}) | ${String(c.hex ?? "")} | ${item.sourceHost ?? "atelier"} | ${item.why.replace(/\n/g, " ")} |`);
      }
    }
    lines.push("");
    const pairs = palettes.flatMap((item) => list(((item.data ?? {}) as Data).pairs).map((pair) => ({ pair, source: item.sourceHost })));
    if (pairs.length) {
      lines.push("### Contrastes observés (WCAG 2)", "");
      for (const { pair: p, source } of pairs) lines.push(`- ${String(p.label)} : ${String(p.fg)} sur ${String(p.bg)}, ${String(p.wcag)}, ${p.grade === "fail" ? "**échec, à ne pas reproduire**" : String(p.grade)} (${String(p.where)}, ${source ?? "atelier"})`);
      lines.push("");
    }
  }

  const types = by("type");
  if (types.length) {
    lines.push("## Typographie", "");
    for (const item of types) {
      const d = (item.data ?? {}) as Data;
      if (item.subkind === "scale") {
        lines.push(`### Échelle · ${item.sourceHost ?? "atelier"}`, "", `Corps ${String(d.body)} px, ${d.ratio ? `rapport ${String(d.ratio)} (${String(d.ratioName)}), erreur moyenne ${Math.round(Number(d.error ?? 0) * 1000) / 10} %` : "échelle libre"}.`, "", "| Rôle | Famille | Taille | Interligne | Graisse | Approche |", "|---|---|---|---|---|---|");
        for (const s of list(d.styles)) lines.push(`| ${String(s.role)} | ${String(s.family)} | ${String(s.size)} px | ${String(s.lineRatio)} | ${String(s.weight)} | ${String(s.tracking)} em |`);
        lines.push("");
      } else if (item.subkind === "pair") {
        lines.push(`- Paire : ${whatToTake(item)}. ${item.why}`);
      } else {
        const source = (d.source ?? {}) as Data;
        lines.push(`- ${String(d.family ?? item.title)} (${String(d.generic ?? "")}), source ${String(source.label ?? "inconnue")}, licence ${String(source.licence ?? "à vérifier")}. ${item.why}`);
        if (d.mismatch) lines.push(`  - Attention : police déclarée ${String((d.mismatch as Data).declared)} non chargée, le site affiche ${String((d.mismatch as Data).rendered)}.`);
      }
    }
    lines.push("");
  }

  const components = by("component");
  if (components.length) {
    lines.push("## Composants", "");
    for (const item of components) {
      const d = (item.data ?? {}) as Data;
      lines.push(`### ${String(d.kindLabel ?? "Composant")} · ${String(d.label ?? item.title)} (${item.sourceHost ?? "atelier"})`, "", item.why || "_Sans raison notée._", "");
      if (typeof d.css === "string") lines.push("```css", d.css, "```", "");
      const hover = d.hover as { changes?: { property: string; from: string; to: string }[] } | null;
      if (hover?.changes?.length) lines.push(`Survol : ${hover.changes.map((c) => `${c.property} ${c.from} → ${c.to}`).join(", ")}.`, "");
    }
  }

  const scales = by("scale");
  if (scales.length) {
    lines.push("## Échelles", "");
    for (const item of scales) lines.push(`- ${item.title} : ${whatToTake(item)}. ${item.why}`);
    lines.push("");
  }

  const moods = by("mood");
  if (moods.length) {
    lines.push("## Ambiance", "");
    for (const item of moods) {
      const d = (item.data ?? {}) as Data;
      lines.push(`- ${item.sourceHost ?? item.title} : ${list(d.descriptors).map((x) => `${String(x.name)} ${String(x.word)} (${String(x.value)})`).join(", ")}. ${item.why}`);
    }
    lines.push("");
  }

  lines.push(
    "## À faire",
    "",
    "- Nommer les couleurs par rôle (`accent`, `surface`), jamais par position.",
    "- Garder les rapports d'échelle et la base d'espacement ; recalculer les tailles pour le contenu du client.",
    "- Croiser les sources : chaque section du résultat emprunte à au moins deux éléments de sources différentes.",
    "",
    "## À ne pas faire",
    "",
    "- Reproduire une mise en page, un texte, une photo ou un logo d'une source.",
    "- Réutiliser un fichier de police dont la licence n'est pas OFL.",
    "- Reprendre une paire de couleurs marquée « échec ».",
    "",
  );
  return lines.join("\n");
}
