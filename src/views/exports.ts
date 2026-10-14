/**
 * Exports: past packs, and the "Nouvel export" wizard: source, formats,
 * warnings, files, then the ZIP (I-24). The server enforces the anti-copy
 * rules; this screen shows them before anything is saved.
 */

import { ApiFailure, del, get, post } from "../api";
import type { Board, ExportPack, ExportPreview } from "../api";
import { app, fullDate } from "../app";
import { h } from "../ui/controls";
import { icon } from "../ui/icons";
import { confirmSheet } from "../ui/sheet";

const FORMATS: { id: string; label: string; file: string }[] = [
  { id: "brief", label: "Pack agent", file: "BRIEF.md, DESIGN.md, images" },
  { id: "tokens", label: "Jetons DTCG", file: "tokens.json" },
  { id: "css", label: "Variables CSS", file: "tokens.css" },
  { id: "tailwind", label: "Tailwind v4", file: "theme.css" },
];

const size = (bytes: number) => (bytes > 1024 ? `${Math.round(bytes / 102.4) / 10} Ko` : `${bytes} o`);

function page(title: string, sub: string, children: Node[], actions: Node[] = []): HTMLElement {
  return h("div", { class: "page" }, [h("header", { class: "head" }, [h("div", { class: "head-text" }, [h("h1", { text: title }), h("span", { class: "val", text: sub })]), ...actions]), h("div", { class: "scroll" }, children)]);
}

export function buildExports(query: URLSearchParams): HTMLElement {
  if (query.has("items") || query.has("board") || query.has("new")) return wizard(query);
  const list = h("div", { class: "field" });
  const create = h("a", { class: "btn primary", href: "#/exports?new=1" }, [icon("plus", 18), h("span", { text: "Nouvel export" })]);
  void (async () => {
    try {
      const { data, stale } = await get<{ exports: ExportPack[] }>("/api/exports");
      list.replaceChildren(
        ...(stale ? [h("p", { class: "val muted", text: "hors ligne · cache" })] : []),
        ...data.exports.map((pack) => h("a", { class: "capture-row", href: `#/exports/${pack.id}` }, [h("span", { class: "badge-site" }, [icon("export", 20)]), h("div", { style: "min-width:0" }, [h("b", { text: pack.name }), h("span", { class: "val", text: `${pack.itemCount} élément${pack.itemCount > 1 ? "s" : ""} · ${pack.sources.join(", ")} · ${pack.formats.join(", ")}` })]), h("span", { class: "val muted", text: fullDate(pack.createdAt) })])),
      );
      if (!data.exports.length) list.replaceChildren(h("div", { class: "empty" }, [h("h2", { text: "Aucun export" }), h("p", { text: "Un export réunit des éléments gardés en jetons (DTCG, CSS, Tailwind) et en brief pour un agent, avec les règles anti-copie." })]));
    } catch (error) {
      list.replaceChildren(h("p", { class: "error-text", text: error instanceof Error ? error.message : "" }));
    }
  })();
  return page("Exports", "Des jetons et un brief, jamais une copie.", [list], [create]);
}

function wizard(query: URLSearchParams): HTMLElement {
  const itemIds = (query.get("items") ?? "").split(",").filter(Boolean);
  type Source = { kind: "items" } | { kind: "board"; id: string } | { kind: "library"; library: string };
  let source: Source = itemIds.length ? { kind: "items" } : query.get("board") ? { kind: "board", id: query.get("board") as string } : { kind: "library", library: "palettes" };
  const formats = new Set(FORMATS.map((f) => f.id));
  const name = h("input", { class: "input", placeholder: "Refonte Institut Lumen", "aria-label": "Nom de l'export" });
  const brief = h("textarea", { class: "textarea", placeholder: "La demande, en une phrase ou deux : pour qui, quoi, quel ton.", "aria-label": "La demande" });
  const confirmSingle = h("input", { type: "checkbox" });
  const sourceHost = h("div", { class: "checks" });
  const warnings = h("div", { class: "warnings", "aria-live": "polite" });
  const files = h("div", { class: "files" });
  const create = h("button", { type: "button", class: "btn primary" }, [icon("download", 18), h("span", { text: "Créer et télécharger" })]);
  let boards: Board[] = [];

  const body = () => ({
    ...(source.kind === "items" ? { itemIds } : source.kind === "board" ? { boardId: source.id } : { library: source.library }),
    formats: [...formats],
    name: name.value,
    brief: brief.value,
    allowSingleSource: confirmSingle.checked,
  });

  let previewTimer = 0;
  const preview = () => {
    window.clearTimeout(previewTimer);
    previewTimer = window.setTimeout(async () => {
      try {
        const result = await post<ExportPreview & { source: string }>("/api/exports/preview", body());
        const refused = result.warnings.some((w) => w.level === "refuse");
        warnings.replaceChildren(
          h("p", { text: `${result.itemCount} élément${result.itemCount > 1 ? "s" : ""} · ${result.source} · sources : ${result.sources.join(", ")}` }),
          ...result.warnings.map((w) => h("p", { class: `warning${w.level === "refuse" ? " refuse" : ""}` }, [icon("warning", 18), h("span", { text: `${w.level === "refuse" ? "Refusé : " : ""}${w.message}` })])),
          ...(result.warnings.length ? [] : [h("p", { class: "warning" }, [icon("check", 18), h("span", { text: "Aucun avertissement." })])]),
        );
        if (refused || confirmSingle.checked) warnings.append(h("label", { class: "opt" }, [confirmSingle, h("span", { text: "Je confirme : cet export vient d'un seul site, je l'assume." })]));
        files.replaceChildren(...result.files.map((f) => h("span", { class: "val" }, [h("span", { text: f.name }), h("span", { class: "muted", text: ` · ${size(f.bytes)}` })])));
        create.disabled = refused || result.itemCount === 0 || formats.size === 0;
      } catch (error) {
        warnings.replaceChildren(h("p", { class: "error-text", text: error instanceof Error ? error.message : "Aperçu impossible" }));
        create.disabled = true;
      }
    }, 200);
  };

  const paintSources = () => {
    const option = (label: string, checked: boolean, onPick: () => void, extra?: Node) => {
      const radio = h("input", { type: "radio", name: "export-source" });
      radio.checked = checked;
      radio.addEventListener("change", () => {
        onPick();
        paintSources();
        preview();
      });
      return h("label", { class: "opt" }, [radio, h("span", { text: label }), ...(extra ? [extra] : [])]);
    };
    sourceHost.replaceChildren();
    if (itemIds.length) sourceHost.append(option(`La sélection (${itemIds.length} élément${itemIds.length > 1 ? "s" : ""})`, source.kind === "items", () => (source = { kind: "items" })));
    for (const board of boards) sourceHost.append(option(`Tableau « ${board.name} » · ${board.count}`, source.kind === "board" && source.id === board.id, () => (source = { kind: "board", id: board.id })));
    for (const lib of ["palettes", "typos", "composants", "ambiances"]) sourceHost.append(option(`Toute la bibliothèque ${lib}`, source.kind === "library" && source.library === lib, () => (source = { kind: "library", library: lib })));
  };

  const formatHost = h("div", { class: "checks" }, FORMATS.map((f) => {
    const box = h("input", { type: "checkbox" });
    box.checked = true;
    box.addEventListener("change", () => {
      if (box.checked) formats.add(f.id);
      else formats.delete(f.id);
      preview();
    });
    return h("label", { class: "opt" }, [box, h("span", { text: f.label }), h("span", { class: "val muted", text: f.file })]);
  }));
  confirmSingle.addEventListener("change", preview);
  for (const field of [name, brief]) field.addEventListener("input", preview);

  create.addEventListener("click", async () => {
    create.disabled = true;
    try {
      const created = await post<{ export: ExportPack }>("/api/exports", body());
      app.toast("Export créé");
      window.location.assign(`/api/exports/${created.export.id}/download`);
      app.go(`#/exports/${created.export.id}`);
    } catch (error) {
      app.toast(error instanceof ApiFailure ? error.message : "Export impossible");
      create.disabled = false;
    }
  });

  void app.loadBoards().then((list) => {
    boards = list;
    paintSources();
    preview();
  });
  paintSources();
  preview();
  const back = h("a", { class: "btn square", href: "#/exports", "aria-label": "Retour aux exports" }, [icon("caret-left", 20)]);
  return page("Nouvel export", "Source, formats, avertissements, fichiers.", [
    h("section", { class: "steps" }, [
      h("div", { class: "field" }, [h("h2", { class: "section-title", text: "1. Source" }), sourceHost]),
      h("div", { class: "field" }, [h("h2", { class: "section-title", text: "2. Formats" }), formatHost, h("label", { class: "field" }, [h("span", { text: "Nom" }), name]), h("label", { class: "field" }, [h("span", { text: "La demande (BRIEF.md)" }), brief])]),
      h("div", { class: "field" }, [h("h2", { class: "section-title", text: "3. Avertissements" }), warnings]),
      h("div", { class: "field" }, [h("h2", { class: "section-title", text: "4. Fichiers" }), files, create]),
    ]),
  ], [back]);
}

export function buildExport(id: string): HTMLElement {
  const root = h("div", { class: "page" });
  void (async () => {
    try {
      const { data } = await get<{ export: ExportPack; warnings: { level: string; message: string }[]; files: { name: string; bytes: number }[]; preview: { brief: string; design: string; theme: string } }>(`/api/exports/${id}`);
      const pack = data.export;
      const download = h("a", { class: "btn primary", href: `/api/exports/${id}/download`, download: "" }, [icon("download", 18), h("span", { text: "Télécharger" })]);
      const remove = h("button", { type: "button", class: "btn square danger", "aria-label": "Supprimer l'export" }, [icon("trash", 18)]);
      remove.addEventListener("click", () => confirmSheet("Supprimer cet export ?", "Les éléments restent dans la bibliothèque.", "Supprimer", async () => {
        await del(`/api/exports/${id}`);
        app.go("#/exports");
      }));
      const code = h("pre", { class: "code", text: data.preview.brief });
      const views: Record<string, string> = { brief: data.preview.brief, design: data.preview.design, theme: data.preview.theme };
      const switcher = h("div", { class: "fchips" }, [
        ["brief", "BRIEF.md"],
        ["design", "DESIGN.md"],
        ["theme", "theme.css"],
      ].filter(([k]) => views[k]).map(([k, label]) => {
        const chip = h("button", { type: "button", class: "fchip", "aria-pressed": k === "brief" ? "true" : "false", text: label });
        chip.addEventListener("click", () => {
          code.textContent = views[k];
          for (const other of chip.parentElement?.children ?? []) other.setAttribute("aria-pressed", other === chip ? "true" : "false");
        });
        return chip;
      }));
      const back = h("a", { class: "btn square", href: "#/exports", "aria-label": "Retour aux exports" }, [icon("caret-left", 20)]);
      root.replaceChildren(
        h("header", { class: "head" }, [back, h("div", { class: "head-text" }, [h("h1", { text: pack.name }), h("span", { class: "val", text: `${fullDate(pack.createdAt)} · ${pack.source} · ${pack.itemCount} éléments · ${pack.sources.join(", ")}` })]), download, remove]),
        h("div", { class: "scroll" }, [
          h("div", { class: "warnings" }, data.warnings.map((w) => h("p", { class: "warning" }, [icon("warning", 18), h("span", { text: w.message })]))),
          h("div", { class: "files" }, data.files.map((f) => h("span", { class: "val" }, [h("span", { text: f.name }), h("span", { class: "muted", text: ` · ${size(f.bytes)}` })]))),
          switcher,
          code,
        ]),
      );
    } catch (error) {
      root.replaceChildren(h("div", { class: "scroll" }, [h("p", { class: "error-text", text: error instanceof Error ? error.message : "Export introuvable." })]));
    }
  })();
  return root;
}

