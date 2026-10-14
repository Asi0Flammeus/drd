/**
 * Analyse d'une capture: the page on the left with Localiser outlines, the
 * findings on the right in six tabs, every finding one tap from its library.
 * Under 700 px the page pane gives way to a "localisé à N endroits" row that
 * opens a full-screen viewer.
 */

import { del, get, post } from "../api";
import type { Box, CaptureDetail, ComponentData, ElevationData, Finding, MoodData, PageData, PaletteColor, PaletteData, RadiusData, SpacingData, TextStyle, TypeFamilyData, TypePairData, TypeScaleData } from "../api";
import { app, copyText, fullDate, num, pct } from "../app";
import { bands } from "../ui/bands";
import { confidenceDot } from "../ui/confidence";
import { contrastRows } from "../ui/contrast-row";
import { h } from "../ui/controls";
import { icon } from "../ui/icons";
import { keepButton } from "../ui/keep";
import { plate } from "../ui/plate";
import { roleSpecimenRows } from "../ui/preview";
import { confirmSheet, openSheet } from "../ui/sheet";
import { tabs } from "../ui/tabs";
import { initials, siteName, stageRow } from "./captures";

export const ANALYSE_TABS = [
  { id: "palette", label: "Palette" },
  { id: "typo", label: "Typo" },
  { id: "composants", label: "Composants" },
  { id: "echelles", label: "Échelles" },
  { id: "ambiance", label: "Ambiance" },
  { id: "page", label: "Page" },
] as const;

type Selection = { label: string; locations: Box[] } | null;

const cache = new Map<string, CaptureDetail>();

function copyValue(text: string, label = text): HTMLElement {
  const button = h("button", { type: "button", class: "copy-val val", text: label, title: "Copier" });
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    void copyText(text);
  });
  return button;
}

export function buildAnalyse(captureId: string, tab: string): HTMLElement {
  const root = h("div", { class: "page" });
  const current = ANALYSE_TABS.some((t) => t.id === tab) ? tab : "palette";
  let timer = 0;

  const render = (detail: CaptureDetail) => {
    cache.set(captureId, detail);
    const { capture, findings } = detail;
    const palette = findings.find((f) => f.kind === "palette" && f.subkind === "interface") as Finding | undefined;
    const accent = (palette?.data as PaletteData | undefined)?.colors.find((c) => c.key === "accent");

    const menu = h("button", { type: "button", class: "btn square", "aria-label": "Plus d'actions" }, [icon("dots", 20)]);
    menu.addEventListener("click", () => pageActions(detail));
    const head = h("header", { class: "head" }, [
      h("span", { class: "badge-site", "aria-hidden": "true", text: initials(capture), style: accent ? `background:${accent.hex};color:${accent.value.l > 0.6 ? "oklch(0.2 0 0)" : "oklch(0.97 0 0)"}` : "" }),
      h("div", { class: "head-text" }, [
        h("h1", { text: capture.status === "ready" ? siteName(capture) : capture.requestedUrl }),
        h("span", { class: "val", text: [capture.host, fullDate(capture.createdAt), capture.width && capture.height ? `${capture.width} × ${capture.height}` : "", capture.analysis ? `analyse v${capture.analysis.version}${capture.analysis.partial ? " partielle" : ""}` : capture.status === "ready" ? "analyse v1" : ""].filter(Boolean).join(" · ") }),
      ]),
      h("a", { class: "btn hide-phone", href: capture.finalUrl ?? capture.requestedUrl, target: "_blank", rel: "noreferrer noopener" }, [icon("arrow-square-out", 18), h("span", { text: "Ouvrir le site" })]),
      menu,
    ]);

    if (capture.status === "pending" || capture.status === "running" || capture.analysis?.status === "running" || (capture.status === "ready" && capture.stage === "analyse" && !capture.analysis)) {
      root.replaceChildren(head, h("div", { class: "scroll" }, [h("div", { class: "field" }, [h("b", { text: "Analyse…" }), stageRow(capture)]), skeleton()]));
      timer = window.setTimeout(load, 1500);
      return;
    }
    if (capture.status === "failed") {
      const retry = h("button", { type: "button", class: "btn primary", text: "Réessayer" });
      retry.addEventListener("click", async () => {
        const created = await post<{ id: string }>(`/api/captures/${capture.id}/retry`);
        app.go(`#/captures/${created.id}/palette`);
      });
      root.replaceChildren(
        head,
        h("div", { class: "scroll" }, [
          h("div", { class: "banner" }, [icon("warning", 20), h("p", { class: "error-text", text: capture.error ?? "La capture a échoué." }), retry]),
          attemptsList(detail),
        ]),
      );
      return;
    }

    // The page pane and the Localiser.
    const shot = h("div", { class: "shot" });
    const hits = h("div");
    const note = h("p", { class: "pane-note", text: "Choisissez une couleur, un style ou un composant pour le localiser." });
    const paneScroll = h("div", { class: "pane-scroll" }, [shot]);
    if (capture.screenshot) {
      const img = h("img", { src: capture.screenshot, alt: `Page capturée de ${capture.host}`, loading: "lazy" });
      shot.append(img, hits);
    }
    const pane = h("section", { class: "page-pane", "aria-label": "La page capturée" }, [h("div", { class: "pane-label" }, [h("span", { text: "La page" }), h("span", { class: "val", text: capture.width && capture.height ? `${capture.width} × ${capture.height}` : "" })]), paneScroll, note]);
    const scale = () => (shot.clientWidth || 268) / (capture.width || 1280);
    const draw = (target: HTMLElement, selection: Selection, k: number) => {
      target.replaceChildren(...(selection?.locations ?? []).map((box) => h("span", { class: "hit", style: `left:${box.x * k}px;top:${box.y * k}px;width:${Math.max(4, box.width * k)}px;height:${Math.max(4, box.height * k)}px` })));
    };
    let selection: Selection = null;
    const localise = (next: Selection) => {
      selection = next;
      draw(hits, selection, scale());
      note.textContent = selection ? `${selection.label} localisé à ${selection.locations.length} endroit${selection.locations.length > 1 ? "s" : ""}.` : "";
      const first = hits.firstElementChild as HTMLElement | null;
      if (first) paneScroll.scrollTo({ top: Math.max(0, first.offsetTop - 40), behavior: "smooth" });
    };
    const viewer = (sel: Selection) => {
      if (!capture.screenshot || !sel) return;
      const layer = h("div");
      const box = h("div", { class: "shot" }, [h("img", { src: capture.screenshot, alt: `Page capturée de ${capture.host}` }), layer]);
      const sheet = openSheet({ title: `${sel.label} · ${sel.locations.length} endroit${sel.locations.length > 1 ? "s" : ""}`, body: [h("div", { class: "viewer" }, [box])], full: true });
      requestAnimationFrame(() => {
        draw(layer, sel, (box.clientWidth || 360) / (capture.width || 1280));
        const first = layer.firstElementChild as HTMLElement | null;
        if (first) sheet.body.scrollTo({ top: Math.max(0, first.offsetTop - 80) });
      });
    };
    const locateRow = (label: string, locations: Box[], what: string) => {
      const button = h("button", { type: "button", class: "locate-row" }, [h("div", {}, [h("b", { text: `${label} localisé à ${locations.length} endroit${locations.length > 1 ? "s" : ""}` }), h("span", { class: "val", text: what })]), icon("crosshair", 22)]);
      button.addEventListener("click", () => viewer({ label, locations }));
      return button;
    };
    const ctx: TabContext = { detail, localise, locateRow, reload: load };

    const content = h("div", { class: "scroll" });
    if (!capture.analysis) content.append(v1Banner(capture.id, load));
    else if (capture.analysis.status === "failed") content.append(h("div", { class: "banner" }, [icon("warning", 20), h("p", { class: "error-text", text: `Analyse en échec : ${capture.analysis.error ?? ""}` }), reanalyseButton(capture.id, load)]));
    else if (capture.analysis.partial) content.append(h("div", { class: "banner" }, [h("p", { text: "Analyse partielle : cette page a été capturée avec DRD v1 (pas de texte propre, pas de polices rendues, pas de survol). Recapturez-la pour l'analyse complète." }), recaptureButton(capture.finalUrl ?? capture.requestedUrl)]));
    const builders: Record<string, (ctx: TabContext) => Node[]> = { palette: paletteTab, typo: typoTab, composants: componentsTab, echelles: scalesTab, ambiance: moodTab, page: pageTab };
    content.append(...builders[current](ctx));

    const counts: Record<string, number | null> = {
      palette: (palette?.data as PaletteData | undefined)?.colors.length ?? null,
      typo: ((findings.find((f) => f.kind === "type" && f.subkind === "scale")?.data as TypeScaleData | undefined)?.styles.length) ?? null,
      composants: findings.filter((f) => f.kind === "component").length || null,
    };
    const findingsPane = h("section", { class: "findings", "aria-label": "Trouvailles" }, [
      tabs(ANALYSE_TABS.map((t) => ({ id: t.id, label: t.label, count: counts[t.id] ?? null, href: `#/captures/${captureId}/${t.id}` })), current),
      content,
    ]);
    root.replaceChildren(head, h("div", { class: "split" }, [pane, findingsPane]));
    new ResizeObserver(() => draw(hits, selection, scale())).observe(shot);
  };

  const load = async () => {
    window.clearTimeout(timer);
    try {
      // Stale data means the network failed, and the shell's offline banner already says so (D10).
      const { data } = await get<CaptureDetail>(`/api/captures/${captureId}`);
      if (!root.isConnected && root.childElementCount) return;
      render(data);
    } catch (error) {
      root.replaceChildren(h("div", { class: "scroll" }, [h("div", { class: "empty" }, [h("h2", { text: "Capture indisponible" }), h("p", { text: error instanceof Error ? error.message : "" }), h("a", { class: "btn", href: "#/captures", text: "Retour aux captures" })])]));
    }
  };
  const cached = cache.get(captureId);
  if (cached) render(cached);
  else root.replaceChildren(h("header", { class: "head" }, [h("span", { class: "badge-site skel" }), h("div", { class: "head-text" }, [h("div", { class: "skel", style: "width:40%;height:22px" })])]), h("div", { class: "scroll" }, [skeleton()]));
  window.addEventListener("hashchange", () => window.clearTimeout(timer), { once: true });
  void load();
  return root;
}

type TabContext = {
  detail: CaptureDetail;
  localise(selection: Selection): void;
  locateRow(label: string, locations: Box[], what: string): HTMLElement;
  reload(): Promise<void>;
};

export function skeleton(): HTMLElement {
  return h("div", { class: "field", "aria-busy": "true", "aria-label": "Chargement" }, [h("div", { class: "skel", style: "height:20px;width:30%" }), h("div", { class: "skel", style: "height:112px" }), h("div", { class: "skel", style: "height:64px" }), h("div", { class: "skel", style: "height:52px" }), h("div", { class: "skel", style: "height:52px" })]);
}

function reanalyseButton(captureId: string, reload: () => Promise<void>): HTMLElement {
  const button = h("button", { type: "button", class: "btn primary", text: "Réanalyser" });
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await post(`/api/captures/${captureId}/reanalyse`);
      app.toast("Analyse v2 lancée");
      await reload();
    } catch (error) {
      app.toast(error instanceof Error ? error.message : "Réanalyse impossible");
      button.disabled = false;
    }
  });
  return button;
}

function recaptureButton(url: string): HTMLElement {
  const button = h("button", { type: "button", class: "btn", text: "Recapturer" });
  button.addEventListener("click", async () => {
    const created = await post<{ id: string }>("/api/captures", { url, force: true });
    app.go(`#/captures/${created.id}/palette`);
  });
  return button;
}

function v1Banner(captureId: string, reload: () => Promise<void>): HTMLElement {
  return h("div", { class: "banner" }, [h("p", { text: "Capturée avec DRD v1 : aucune analyse v2 pour l'instant. Réanalyser construit palette, typo, composants et ambiance à partir de ce qui est stocké (analyse partielle)." }), reanalyseButton(captureId, reload)]);
}

function head(title: string, finding: Finding | undefined, detail: CaptureDetail, keepLabel?: string): HTMLElement {
  const row = h("div", { class: "finding-head" }, [h("h2", { text: title })]);
  if (finding) {
    row.append(confidenceDot(finding.confidence, finding.evidence));
    row.append(keepButton({ findingId: finding.id, itemId: detail.kept[finding.id] ?? null, label: keepLabel, ariaLabel: `Garder ${title}`, onChange: (id) => {
      if (id) detail.kept[finding.id] = id;
      else delete detail.kept[finding.id];
    } }));
  }
  return row;
}

function empty(message: string): HTMLElement {
  return h("p", { class: "muted", text: message });
}

/* ------------------------------------------------------------- palette ---- */

function paletteTab(ctx: TabContext): Node[] {
  const { detail } = ctx;
  const out: Node[] = [];
  const finding = detail.findings.find((f) => f.kind === "palette" && f.subkind === "interface");
  if (!finding) return [empty("Pas de palette dans cette analyse.")];
  const data = finding.data as PaletteData;
  const colorFinding = (color: PaletteColor) => detail.findings.find((f) => f.kind === "color" && f.signature === `color:${color.hex}`);
  let picked = Math.max(0, data.colors.findIndex((c) => c.key === "accent"));
  const pickedBox = h("div");
  const bandHost = h("div");
  const paint = () => {
    bandHost.replaceChildren(bands(data.colors.map((c) => ({ role: c.role, hex: c.hex, value: c.value, share: Math.max(c.share, c.textShare * 0.2) })), { selected: picked, label: "Couleurs de la palette", onSelect: (index) => {
      picked = index;
      paint();
    } }));
    const color = data.colors[picked];
    if (!color) return;
    const cf = colorFinding(color);
    const oklch = `oklch(${color.value.l} ${color.value.c} ${color.value.h})`;
    const uses = [color.share > 0.0005 ? `${pct(color.share)} de la surface` : "", color.textShare > 0.001 ? `${pct(color.textShare)} du texte` : "", color.usedOn.join(", ")].filter(Boolean).join(" · ");
    const copy = h("button", { type: "button", class: "btn square", "aria-label": "Copier la valeur" }, [icon("copy", 18)]);
    copy.addEventListener("click", () => void copyText(`${oklch} /* ${color.hex} */`));
    pickedBox.replaceChildren(
      h("div", { class: "picked" }, [
        h("span", { class: "picked-chip", style: `background:${color.hex}`, "aria-hidden": "true" }),
        h("div", { class: "picked-text" }, [
          h("b", { text: color.role }),
          h("span", { class: "val" }, [copyValue(oklch), h("span", { text: " · " }), copyValue(color.hex)]),
          h("span", { class: "val", text: `${uses}${color.declaredAs ? ` · ${color.declaredAs}` : ""}` }),
        ]),
        confidenceDot(color.confidence, color.evidence),
        copy,
        ...(cf ? [keepButton({ findingId: cf.id, itemId: detail.kept[cf.id] ?? null, iconOnly: true, ariaLabel: `Garder la couleur ${color.role}` })] : []),
      ]),
      ctx.locateRow(color.role, color.locations, color.usedOn.join(" · ")),
    );
    ctx.localise({ label: `${color.role} ${color.hex}`, locations: color.locations });
  };
  paint();
  out.push(h("article", {}, [head("Palette d'interface", finding, detail), bandHost, pickedBox]));

  if (data.pairs.length) out.push(h("article", {}, [h("div", { class: "finding-head" }, [h("h2", { text: "Contrastes observés" }), confidenceDot(finding.confidence, [{ origin: "dom", note: "paires texte / fond réellement rencontrées, pondérées par surface de texte ; WCAG 2.x" }])]), contrastRows(data.pairs)]));

  const imagery = detail.findings.find((f) => f.kind === "palette" && f.subkind === "imagery");
  if (imagery) {
    const d = imagery.data as PaletteData;
    out.push(h("article", {}, [head("Couleurs des photos", imagery, detail), h("div", { class: "strip", role: "img", "aria-label": d.colors.map((c) => c.hex).join(", ") }, d.colors.map((c) => h("span", { style: `background:${c.hex};--w:${Math.max(0.3, c.share * 20)}`, title: c.hex }))), h("p", { class: "subtle", text: "Vues seulement dans les pixels des photos, jamais dans le CSS : elles vont dans l'ambiance, pas dans la palette d'interface." })]));
  }
  if (data.others.length) {
    out.push(h("article", {}, [h("div", { class: "finding-head" }, [h("h2", { text: "Autres couleurs vues" })]), h("div", { class: "others" }, data.others.map((o) => h("span", { class: "other" }, [h("i", { style: `background:${o.hex}` }), copyValue(o.hex), h("span", { class: "val muted", text: o.share > 0.0005 ? pct(o.share) : o.origins.join("+") })])))]));
  }
  return out;
}

/* ---------------------------------------------------------------- typo ---- */

function styleMeta(style: TextStyle): string {
  return `${num(style.size, style.size % 1 ? 1 : 0)} px / ${num(style.lineHeight, style.lineHeight % 1 ? 1 : 0)} · ${style.weight} · ${style.tracking ? `${num(style.tracking, 3)} em` : "0 em"}${style.transform !== "none" ? ` · ${style.transform}` : ""}`;
}

function typoTab(ctx: TabContext): Node[] {
  const { detail } = ctx;
  const out: Node[] = [];
  const scale = detail.findings.find((f) => f.kind === "type" && f.subkind === "scale");
  const cap = detail.capture.id;
  if (scale) {
    const d = scale.data as TypeScaleData;
    const verdict = h("div", { class: "scale-verdict" }, [
      h("strong", { text: d.ratio ? `${d.ratioName} ≈ ${num(d.ratio, 3)}` : "Échelle libre" }),
      h("span", { class: "val muted", text: d.ratio && d.error !== null ? `erreur moyenne ${num(d.error * 100)} % · ${d.verdict} · corps ${d.body} px` : `corps ${d.body} px · tailles ${d.steps.map((s) => num(s.size, s.size % 1 ? 1 : 0)).join(" ")}${d.error !== null ? ` · meilleur rapport à ${num(d.error * 100)} %, non retenu` : ""}` }),
    ]);
    const rows = h("div", { class: "styles" });
    for (const style of d.styles) {
      const row = h("button", { type: "button", class: "style-row", "aria-pressed": "false" }, [
        plate(style.crop ? `/media/${cap}/${style.crop}` : null, `${style.sample} en ${style.family}`),
        h("div", { class: "style-meta" }, [h("b", { text: style.role }), h("span", { class: "val", text: styleMeta(style) }), h("span", { class: "val", text: `${style.family} · ${pct(style.share)}` })]),
      ]);
      row.addEventListener("click", () => {
        for (const other of rows.querySelectorAll(".style-row")) other.setAttribute("aria-pressed", other === row ? "true" : "false");
        ctx.localise({ label: `${style.role} ${style.family} ${style.size} px`, locations: style.locations });
        void copyText(`font: ${style.italic ? "italic " : ""}${style.weight} ${style.size}px/${style.lineRatio} "${style.family}"; letter-spacing: ${style.tracking}em;`);
      });
      rows.append(row);
    }
    const first = d.styles[0];
    out.push(h("article", {}, [head("Échelle typographique", scale, detail), verdict, rows, ...(first ? [ctx.locateRow(`${first.role} ${first.family}`, first.locations, styleMeta(first))] : [])]));
  }
  const pair = detail.findings.find((f) => f.kind === "type" && f.subkind === "pair");
  if (pair) {
    const d = pair.data as TypePairData;
    out.push(h("article", {}, [head(`Paire · ${pair.title}`, pair, detail), h("div", { class: "specimens" }, [d.display, d.text].map((part) => h("div", { class: "field" }, [plate(part.crop ? `/media/${cap}/${part.crop}` : null, `${part.family} ${part.size} px`), h("span", { class: "val muted", text: `${part.family} · ${part.generic} · ${part.size} px · ${part.weight}` })])))]));
  }
  for (const family of detail.findings.filter((f) => f.kind === "type" && f.subkind === "family")) {
    const d = family.data as TypeFamilyData;
    const card = h("article", { class: "family" }, [head(d.family, family, detail)]);
    if (d.mismatch) card.append(h("p", { class: "flag" }, [icon("warning", 16), h("span", { text: `Police déclarée non chargée : ${d.mismatch.declared}, rendue en ${d.mismatch.rendered}` })]));
    card.append(
      h("dl", { class: "kv" }, [
        h("dt", { text: "Source" }),
        h("dd", { text: `${d.source.label} · licence ${d.source.licence === "OFL probable" ? "probable : OFL" : "à vérifier"}` }),
        h("dt", { text: "Graisses" }),
        h("dd", { class: "val", text: `${d.weights.join(" ")}${d.italic ? " · italique" : ""}` }),
        h("dt", { text: "Classe" }),
        h("dd", { text: `${d.generic}${d.display ? " · titrage" : ""} · ${d.roles.join(", ")}` }),
        h("dt", { text: "Déclarée" }),
        h("dd", { class: "val", text: d.declared.join(" | ") }),
      ]),
    );
    if (d.roleSpecimens?.length) card.append(roleSpecimenRows(d.roleSpecimens, d.family, cap));
    if (d.specimens.length) card.append(h("div", { class: "specimens" }, d.specimens.map((s) => plate(`/media/${cap}/${s.file}`, `${d.family} graisse ${s.weight}`, "checker"))));
    out.push(card);
  }
  if (!out.length) out.push(empty(detail.capture.analysis?.partial ? "Analyse partielle : la typographie demande une capture v2 (texte propre et polices rendues)." : "Pas de texte mesuré."));
  return out;
}

/* ---------------------------------------------------------- components ---- */

function tokenTable(d: ComponentData): HTMLElement {
  const t = d.tokens;
  const color = (c: { hex: string; role: string | null } | null) => (c ? h("span", {}, [h("i", { class: "swatch-inline", style: `background:${c.hex}` }), copyValue(c.hex), h("span", { text: c.role ? ` · ${c.role}` : "" })]) : h("span", { class: "muted", text: "aucun" }));
  const rows: [string, Node][] = [
    ["fond", color(t.background)],
    ["texte", color(t.foreground)],
    ["bordure", t.border ? h("span", {}, [copyValue(`${t.border.width}px ${t.border.style}`), h("span", { text: " " }), color(t.border.color)]) : h("span", { class: "muted", text: "aucune" })],
    ["rayon", copyValue(t.radius.every((r) => r === t.radius[0]) ? `${t.radius[0]}px` : t.radius.map((r) => `${r}px`).join(" "))],
    ["padding", copyValue(t.padding.map((p) => `${p}px`).join(" "))],
    ["hauteur", copyValue(`${t.height}px`)],
    ["police", copyValue(`${t.font.weight} ${t.font.size}px ${t.font.family.split(",")[0]}`)],
    ...(t.gap ? ([["gouttière", copyValue(`${t.gap}px`)]] as [string, Node][]) : []),
    ...(t.shadow ? ([["ombre", copyValue(t.shadow)]] as [string, Node][]) : []),
    ...(t.transition ? ([["transition", copyValue(`${t.transition.property} ${t.transition.duration} ${t.transition.easing}`)]] as [string, Node][]) : []),
  ];
  return h("table", { class: "token-table" }, [h("tbody", {}, rows.map(([k, v]) => h("tr", {}, [h("th", { text: k }), h("td", {}, [v])])))]);
}

function inspect(finding: Finding, detail: CaptureDetail): void {
  const d = finding.data as ComponentData;
  const cap = detail.capture.id;
  const copy = h("button", { type: "button", class: "btn" }, [icon("copy", 18), h("span", { text: "Copier le CSS" })]);
  copy.addEventListener("click", () => void copyText(d.css));
  const body: Node[] = [
    d.hover?.crop
      ? h("div", { class: "hover-pair" }, [h("figure", {}, [plate(`/media/${cap}/${d.crop}`, "Au repos", "checker"), h("figcaption", { text: "Au repos" })]), h("figure", {}, [plate(`/media/${cap}/${d.hover.crop}`, "Au survol", "checker"), h("figcaption", { text: "Au survol" })])])
      : plate(`/media/${cap}/${d.crop}`, d.label, "checker"),
  ];
  if (d.hover?.changes.length) body.push(h("p", { class: "val muted", text: `Survol : ${d.hover.changes.map((c) => `${c.property} ${c.from} → ${c.to}`).join(" · ")}` }));
  body.push(tokenTable(d), h("pre", { class: "code", text: d.css }));
  openSheet({ title: finding.title, body, actions: [copy, keepButton({ findingId: finding.id, itemId: detail.kept[finding.id] ?? null, ariaLabel: `Garder ${finding.title}`, onChange: (id) => {
    if (id) detail.kept[finding.id] = id;
    else delete detail.kept[finding.id];
  } })] });
}

function componentsTab(ctx: TabContext): Node[] {
  const { detail } = ctx;
  const components = detail.findings.filter((f) => f.kind === "component");
  if (!components.length) return [empty("Aucun composant détecté avec une capture exploitable.")];
  const kinds = [...new Set(components.map((c) => (c.data as ComponentData).kindLabel))];
  let filter: string | null = null;
  const grid = h("div", { class: "comp-grid" });
  const chips = h("div", { class: "fchips", role: "group", "aria-label": "Filtrer par type" });
  const paint = () => {
    for (const chip of chips.children) chip.setAttribute("aria-pressed", chip.textContent?.startsWith(filter ?? "Tous") ? "true" : "false");
    grid.replaceChildren(
      ...components
        .filter((c) => !filter || (c.data as ComponentData).kindLabel === filter)
        .map((finding) => {
          const d = finding.data as ComponentData;
          const card = h("button", { type: "button", class: "comp", "aria-pressed": "false" }, [plate(`/media/${detail.capture.id}/${d.crop}`, d.label), h("span", { class: "comp-meta" }, [h("b", { text: d.label }), h("span", { class: "val muted", text: `${d.kindLabel}${d.count > 1 ? ` · ×${d.count}` : ""}${detail.kept[finding.id] ? " · gardé" : ""}` })])]);
          card.addEventListener("click", () => {
            for (const other of grid.children) other.setAttribute("aria-pressed", other === card ? "true" : "false");
            ctx.localise({ label: d.label, locations: finding.locations });
            inspect(finding, detail);
          });
          return card;
        }),
    );
  };
  for (const kind of ["Tous", ...kinds]) {
    const count = kind === "Tous" ? components.length : components.filter((c) => (c.data as ComponentData).kindLabel === kind).length;
    const chip = h("button", { type: "button", class: "fchip", "aria-pressed": "false" }, [h("span", { text: kind }), h("span", { class: "val", text: String(count) })]);
    chip.addEventListener("click", () => {
      filter = kind === "Tous" ? null : kind;
      paint();
    });
    chips.append(chip);
  }
  paint();
  return [h("article", {}, [h("div", { class: "finding-head" }, [h("h2", { text: `${components.length} composants` }), h("span", { class: "val muted", text: "toucher pour inspecter" })]), chips]), grid];
}

/* -------------------------------------------------------------- scales ---- */

function scalesTab(ctx: TabContext): Node[] {
  const { detail } = ctx;
  const out: Node[] = [];
  const spacing = detail.findings.find((f) => f.kind === "scale" && f.subkind === "spacing");
  if (spacing) {
    const d = spacing.data as SpacingData;
    out.push(h("article", {}, [
      head(`Espacement · base ${d.base}`, spacing, detail),
      h("div", { class: "spacing-bars" }, d.steps.map((step) => h("span", {}, [h("i", { style: `height:${Math.min(step, 120)}px` }), copyValue(`${step}px`, String(step))]))),
      h("p", { class: "subtle", text: `${pct(d.explained)} des marges et paddings tombent sur la base ${d.base}.${d.contentWidth ? ` Largeur de contenu ${d.contentWidth} px.` : ""}${d.columns ? ` Grille principale : ${d.columns} colonnes.` : ""}` }),
    ]));
  }
  const radius = detail.findings.find((f) => f.kind === "scale" && f.subkind === "radius");
  if (radius) {
    const d = radius.data as RadiusData;
    out.push(h("article", {}, [head(`Rayons · ${d.system}`, radius, detail), h("div", { class: "radius-row" }, d.byKind.flatMap((k) => k.values.map((v) => h("span", {}, [h("i", { style: `border-radius:${v === 999 ? "999px" : `${v}px`}` }), h("span", { class: "val", text: `${k.kindLabel} ${v === 999 ? "pilule" : `${v} px`}` })])))), h("p", { class: "subtle", text: d.rule })]));
  }
  const elevation = detail.findings.find((f) => f.kind === "scale" && f.subkind === "elevation");
  if (elevation) {
    const d = elevation.data as ElevationData;
    out.push(h("article", {}, [head("Élévation", elevation, detail), h("div", { class: "shadow-row" }, d.shadows.map((s) => h("div", { class: "shadow-cell" }, [h("div", { class: "shadow-plate", style: `box-shadow:${s.value}` }), copyValue(s.value)]))), h("p", { class: "subtle", text: "Chaque ombre est rejouée ici avec le CSS de DRD sur une plaque neutre." })]));
  }
  return out.length ? out : [empty("Pas assez de valeurs pour dégager une échelle.")];
}

/* ------------------------------------------------------------- ambiance ---- */

function moodTab(ctx: TabContext): Node[] {
  const { detail } = ctx;
  const mood = detail.findings.find((f) => f.kind === "mood");
  if (!mood) return [empty("Pas d'ambiance mesurée.")];
  const d = mood.data as MoodData;
  const cap = detail.capture.id;
  const out: Node[] = [head("Ambiance", mood, detail)];
  const crops = d.images.filter((i) => i.crop);
  if (crops.length) out.push(h("div", { class: "mood-images" }, crops.map((i) => plate(`/media/${cap}/${i.crop}`, `Image, ${i.nature}`))));
  if (d.palette.length) out.push(h("div", { class: "strip", role: "img", "aria-label": `Palette des images : ${d.palette.map((c) => c.hex).join(", ")}` }, d.palette.map((c) => h("span", { style: `background:${c.hex};--w:${Math.max(0.3, c.share * 6)}`, title: c.hex }))));
  out.push(
    h("div", { class: "descriptors" }, [
      ...d.descriptors.map((x) => h("div", {}, [h("span", { class: "muted", text: x.name }), h("b", { text: x.word }), h("span", { class: "val", text: `${x.unit} ${num(x.value, 3)}` })])),
      h("div", {}, [h("span", { class: "muted", text: "Densité de page" }), h("b", { text: d.density.word }), h("span", { class: "val", text: `${pct(d.density.share)} des pixels proches du fond` })]),
      ...(d.nature ? [h("div", {}, [h("span", { class: "muted", text: "Nature" }), h("b", { text: d.nature }), h("span", { class: "val", text: `couleurs distinctes par image : ${d.images.map((i) => i.distinct).join(" ")}` })])] : []),
    ]),
    h("p", { class: "subtle", text: "Les nombres sont exacts, les mots sont des seuils fixes (§4.6), d'où « probable »." }),
  );
  if (d.images.length) out.push(ctx.locateRow("Images", d.images.map((i) => i.box), `${d.images.length} images mesurées`));
  ctx.localise({ label: "Images", locations: d.images.map((i) => i.box) });
  return [h("article", {}, out)];
}

/* ----------------------------------------------------------------- page ---- */

function attemptsList(detail: CaptureDetail): HTMLElement {
  if (detail.attempts.length < 2) return h("span");
  return h("article", {}, [
    h("div", { class: "finding-head" }, [h("h2", { text: "Essais" })]),
    h("div", { class: "field" }, detail.attempts.map((a) => h("a", { class: "board-chip", href: `#/captures/${a.id}/page`, text: `${fullDate(a.created_at)} · ${a.status === "ready" ? "réussi" : a.status === "failed" ? `échec : ${a.error ?? ""}` : "en cours"}${a.id === detail.capture.id ? " · celui-ci" : ""}` }))),
  ]);
}

function pageActions(detail: CaptureDetail): void {
  const { capture } = detail;
  const reanalyse = reanalyseButton(capture.id, async () => app.go(`#/captures/${capture.id}/page`));
  const recapture = recaptureButton(capture.finalUrl ?? capture.requestedUrl);
  const remove = h("button", { type: "button", class: "btn danger" }, [icon("trash", 18), h("span", { text: "Supprimer la capture" })]);
  const sheet = openSheet({ title: "Actions", body: [h("div", { class: "picker" }, [reanalyse, recapture, remove])] });
  remove.addEventListener("click", () => {
    sheet.close();
    confirmSheet("Supprimer la capture ?", "La page, ses mesures et ses trouvailles disparaissent. Les éléments déjà gardés restent dans la bibliothèque avec leurs propres images.", "Supprimer", async () => {
      await del(`/api/captures/${capture.id}`);
      cache.delete(capture.id);
      app.toast("Capture supprimée");
      app.go("#/captures");
    });
  });
}

function pageTab(ctx: TabContext): Node[] {
  const { detail } = ctx;
  const page = detail.findings.find((f) => f.kind === "page");
  const { capture } = detail;
  const d = page?.data as PageData | undefined;
  const rows: [string, string][] = [
    ["Titre", d?.title || capture.title || ""],
    ["Description", d?.description || capture.description || ""],
    ["Adresse", capture.finalUrl ?? capture.requestedUrl],
    ["Langue", d?.lang ?? ""],
    ["Couleur de thème", d?.themeColor ?? ""],
    ["Généré par", d?.generator ?? ""],
    ["Dimensions", capture.width && capture.height ? `${capture.width} × ${capture.height}` : ""],
    ["Thème sombre", d?.darkScheme ? "Le site a un thème sombre (prefers-color-scheme)" : "non déclaré"],
    ["Capturée le", fullDate(capture.finishedAt ?? capture.createdAt)],
  ];
  const actions = h("div", { class: "fchips" }, [reanalyseButton(capture.id, ctx.reload), recaptureButton(capture.finalUrl ?? capture.requestedUrl)]);
  const remove = h("button", { type: "button", class: "btn danger" }, [icon("trash", 18), h("span", { text: "Supprimer la capture" })]);
  remove.addEventListener("click", () =>
    confirmSheet("Supprimer la capture ?", "La page, ses mesures et ses trouvailles disparaissent. Les éléments déjà gardés restent dans la bibliothèque avec leurs propres images.", "Supprimer", async () => {
      await del(`/api/captures/${capture.id}`);
      cache.delete(capture.id);
      app.toast("Capture supprimée");
      app.go("#/captures");
    }),
  );
  actions.append(remove);
  return [
    h("article", {}, [head("Page", page, detail, "Garder la page"), h("dl", { class: "kv" }, rows.filter(([, v]) => v).flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })]))]),
    actions,
    attemptsList(detail),
  ];
}
