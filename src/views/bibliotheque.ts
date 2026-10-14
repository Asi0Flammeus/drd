/**
 * Bibliothèque: four typed libraries and the boards over them (§5). One
 * search field for all of them, filter chips, a list whose rows show the
 * extracted thing itself, and the fiche in a detail pane on the Fold's inner
 * screen (its own page on the phone).
 */

import { del, get, mediaUrl, patch, post } from "../api";
import type { Board, BoardTile, Item, Library, SearchResult } from "../api";
import { app, copyText, fullDate, relativeDate } from "../app";
import { confidenceDot } from "../ui/confidence";
import { h } from "../ui/controls";
import { hueRing } from "../ui/hue-ring";
import { icon } from "../ui/icons";
import { LIBRARY_LABEL, pickBoard } from "../ui/keep";
import { itemPreview } from "../ui/preview";
import { confirmSheet, openSheet } from "../ui/sheet";
import { tabs } from "../ui/tabs";

const LIBRARIES: Library[] = ["palettes", "typos", "composants", "ambiances"];
const TYPE_CLASSES = [
  ["serif", "Serif"],
  ["sans", "Sans"],
  ["mono", "Mono"],
  ["display", "Titrage"],
] as const;
const KIND_LABEL: Record<string, string> = { button: "Bouton", "link-button": "Lien-bouton", field: "Champ", card: "Carte", navigation: "Navigation", hero: "Hero", footer: "Pied de page", badge: "Badge", form: "Formulaire", heading: "Titre" };

const phone = () => window.matchMedia("(max-width: 700px)").matches;

let selectedId: string | null = null;

function rowFor(item: Item, options: { selecting: boolean; selected: boolean; current: boolean; onOpen(): void; onToggle(): void }): HTMLElement {
  const row = h("div", { class: `row${options.selected ? " selected" : ""}`, role: "button", tabindex: "0", "aria-current": options.current ? "true" : "false", "aria-label": `${item.title}${item.why ? "" : ", sans raison"}` });
  const date = relativeDate(item.createdAt);
  const source = item.sourceHost ? `${item.sourceHost} · ${date}` : `atelier · ${date}`;
  row.append(
    itemPreview(item, "row"),
    h("div", { class: "row-meta" }, [h("b", { text: item.title }), h("span", { class: "val", text: item.match ? `${item.match.hex} · Δ ${item.match.distance}` : source })]),
    item.why.trim() ? h("p", { class: "row-why", text: item.why }) : h("p", { class: "row-why missing", text: "Sans raison. Toucher pour dire pourquoi." }),
  );
  if (options.selecting) row.append(h("span", { class: "row-check", "aria-hidden": "true" }, options.selected ? [icon("check", 16)] : []));
  const act = () => (options.selecting ? options.onToggle() : options.onOpen());
  row.addEventListener("click", act);
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      act();
    }
  });
  return row;
}

export function buildLibrary(library: string, query: URLSearchParams): HTMLElement {
  const root = h("div", { class: "page" });
  const tab = library === "tableaux" ? "tableaux" : (LIBRARIES.includes(library as Library) ? library : "palettes");
  const params = new URLSearchParams(query);
  const search = h("input", { type: "search", value: params.get("q") ?? "", placeholder: "Nom, raison, tag, site ou #hex", "aria-label": "Chercher dans la bibliothèque", enterkeyhint: "search" });
  let selecting = false;
  const selection = new Set<string>();
  const list = h("div", { class: "lib-list", "aria-live": "polite" });
  const detail = h("aside", { class: "detail", "aria-label": "Fiche" });
  const filters = h("div", { class: "lib-filters" });
  const tabsHost = h("div");
  const status = h("p", { class: "val muted" });
  const bar = h("div", { class: "selection-bar", hidden: "" });
  const selectToggle = h("button", { type: "button", class: "btn square", "aria-label": "Sélectionner plusieurs", "aria-pressed": "false" }, [icon("checks", 20)]);

  const href = (next: URLSearchParams, lib = tab) => `#/bibliotheque/${lib}${next.toString() ? `?${next}` : ""}`;
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
    app.go(href(next));
  };

  root.append(
    h("div", { class: "lib-top" }, [h("div", { class: "lib-title" }, [h("h1", { text: "Bibliothèque" }), selectToggle]), h("label", { class: "search" }, [icon("magnifier", 18), search]), tabsHost]),
    filters,
    h("div", { class: "lib-split" }, [h("div", {}, [status, list]), detail]),
    bar,
  );

  let typing = 0;
  search.addEventListener("input", () => {
    window.clearTimeout(typing);
    typing = window.setTimeout(() => {
      const next = new URLSearchParams(params);
      if (search.value.trim()) next.set("q", search.value.trim());
      else next.delete("q");
      app.replace(href(next));
      params.delete("q");
      if (search.value.trim()) params.set("q", search.value.trim());
      void load();
    }, 250);
  });

  const chip = (label: string, pressed: boolean, onClick: () => void, before: Node[] = [], after: Node[] = []) => {
    const button = h("button", { type: "button", class: "fchip", "aria-pressed": pressed ? "true" : "false" }, [...before, h("span", { text: label }), ...after]);
    button.addEventListener("click", onClick);
    return button;
  };

  const renderFilters = (result: SearchResult | null) => {
    const row = h("div", { class: "fchips" });
    const hue = params.get("hue");
    const color = params.get("color");
    row.append(
      chip(color ? color : hue ? `Teinte ${hue}°` : "Teinte", Boolean(hue || color), () => {
        if (hue || color) {
          const next = new URLSearchParams(params);
          next.delete("hue");
          next.delete("color");
          app.go(href(next));
          return;
        }
        const sheet = openSheet({
          title: "Filtrer par teinte",
          body: [hueRing(null, (value) => {
            sheet.close();
            const next = new URLSearchParams(params);
            if ("hue" in value) next.set("hue", String(value.hue));
            else next.set("color", value.color);
            app.go(href(next));
          })],
        });
      }, [h("span", { class: "hue-dot", "aria-hidden": "true" })]),
    );
    if (tab !== "tableaux") {
      const noReason = params.get("noReason") === "1";
      row.append(chip("Sans raison", noReason, () => setParam("noReason", noReason ? null : "1"), [], [h("span", { class: "val", text: String(result?.counts.noReason ?? "") })]));
    }
    const host = params.get("host");
    row.append(
      chip(host ?? "Source", Boolean(host), () => {
        if (host) return setParam("host", null);
        const sheet = openSheet({ title: "Source", body: [h("div", { class: "picker" }, (result?.facets.hosts ?? []).map((value) => {
          const button = h("button", { type: "button", class: "btn", text: value });
          button.addEventListener("click", () => {
            sheet.close();
            setParam("host", value);
          });
          return button;
        }))] });
      }, [], [icon("caret-down", 14)]),
    );
    const board = params.get("board");
    row.append(
      chip(board ? (app.boards.find((b) => b.id === board)?.name ?? "Tableau") : "Tableau", Boolean(board), async () => {
        if (board) return setParam("board", null);
        const boards = await app.loadBoards();
        const sheet = openSheet({ title: "Tableau", body: [h("div", { class: "picker" }, boards.map((b) => {
          const button = h("button", { type: "button", class: "btn", text: `${b.path} · ${b.count}` });
          button.addEventListener("click", () => {
            sheet.close();
            setParam("board", b.id);
          });
          return button;
        }))] });
      }, [], [icon("caret-down", 14)]),
    );
    const theme = params.get("theme");
    row.append(chip(theme === "light" ? "Clair" : theme === "dark" ? "Sombre" : "Clair / sombre", Boolean(theme), () => setParam("theme", theme === "light" ? "dark" : theme === "dark" ? null : "light")));
    if (tab === "ambiances") {
      const moodboard = params.get("view") === "moodboard";
      row.append(chip("Moodboard images", moodboard, () => setParam("view", moodboard ? null : "moodboard"), [icon("squares", 14)]));
    }
    if (tab === "typos") {
      for (const [value, label] of TYPE_CLASSES) row.append(chip(label, params.get("typeClass") === value, () => setParam("typeClass", params.get("typeClass") === value ? null : value)));
    }
    if (tab === "composants") {
      for (const kind of result?.facets.componentKinds ?? []) row.append(chip(KIND_LABEL[kind] ?? kind, params.get("componentKind") === kind, () => setParam("componentKind", params.get("componentKind") === kind ? null : kind)));
      row.append(chip("Échelles", params.get("kind") === "scale", () => setParam("kind", params.get("kind") === "scale" ? null : "scale")));
    }
    const confidence = params.get("confidence");
    const WORD: Record<string, string> = { sure: "sûr", probable: "probable", check: "à vérifier" };
    row.append(chip(confidence ? `Confiance : ${WORD[confidence]}` : "Confiance", Boolean(confidence), () => setParam("confidence", confidence === "sure" ? "probable" : confidence === "probable" ? "check" : confidence === "check" ? null : "sure")));
    filters.replaceChildren(row);
  };

  const renderTabs = (result: SearchResult | null) => {
    const keep = new URLSearchParams(params);
    for (const k of ["typeClass", "componentKind", "kind"]) keep.delete(k);
    tabsHost.replaceChildren(
      tabs(
        [...LIBRARIES.map((lib) => ({ id: lib, label: lib === "typos" ? "Typos" : LIBRARY_LABEL[lib], count: result?.counts.libraries[lib] ?? null, href: href(keep, lib) })), { id: "tableaux", label: "Tableaux", count: result?.counts.libraries.tableaux ?? null, href: "#/bibliotheque/tableaux" }],
        tab,
        "lib-tabs",
      ),
    );
  };

  const paintBar = () => {
    bar.hidden = !selecting;
    if (!selecting) return;
    const add = h("button", { type: "button", class: "btn", text: "Ajouter au tableau" });
    const exp = h("button", { type: "button", class: "btn", text: "Exporter" });
    const remove = h("button", { type: "button", class: "btn", text: "Supprimer" });
    const done = h("button", { type: "button", class: "btn square", "aria-label": "Quitter la sélection" }, [icon("x", 18)]);
    for (const b of [add, exp, remove]) b.disabled = selection.size === 0;
    add.addEventListener("click", () => void pickBoard([...selection], () => void load()));
    exp.addEventListener("click", () => app.go(`#/exports?items=${[...selection].join(",")}`));
    remove.addEventListener("click", () =>
      confirmSheet(`Supprimer ${selection.size} élément${selection.size > 1 ? "s" : ""} ?`, "Ils disparaissent de la bibliothèque et de leurs tableaux. Les captures d'origine ne bougent pas.", "Supprimer", async () => {
        await post("/api/items/delete", { ids: [...selection] });
        app.toast(`${selection.size} supprimé${selection.size > 1 ? "s" : ""}`);
        selection.clear();
        await load();
      }),
    );
    done.addEventListener("click", () => {
      selecting = false;
      selection.clear();
      selectToggle.setAttribute("aria-pressed", "false");
      paintBar();
      void load();
    });
    bar.replaceChildren(h("strong", { text: `${selection.size} sélectionné${selection.size > 1 ? "s" : ""}` }), add, exp, remove, done);
  };
  selectToggle.addEventListener("click", () => {
    selecting = !selecting;
    selection.clear();
    selectToggle.setAttribute("aria-pressed", selecting ? "true" : "false");
    paintBar();
    void load();
  });

  const openItem = (item: Item) => {
    if (phone()) {
      app.go(`#/items/${item.id}`);
      return;
    }
    selectedId = item.id;
    for (const row of list.querySelectorAll(".row")) row.setAttribute("aria-current", row === list.querySelector(`[data-id="${item.id}"]`) ? "true" : "false");
    void renderDetail(detail, item.id, false, () => void load());
  };

  const load = async () => {
    if (tab === "tableaux") {
      await renderBoards(list, status);
      renderTabs(null);
      filters.replaceChildren();
      detail.replaceChildren(h("p", { class: "muted", text: "Un tableau réunit des éléments de toutes les bibliothèques." }));
      return;
    }
    const q = new URLSearchParams(params);
    q.set("library", tab);
    try {
      const { data, stale } = await get<SearchResult>(`/api/items?${q}`);
      renderTabs(data);
      renderFilters(data);
      status.textContent = [stale ? "hors ligne · cache" : "", data.mode === "any" ? "aucun élément ne porte tous les mots : résultats pour l'un d'eux" : ""].filter(Boolean).join(" · ");
      const moodboard = tab === "ambiances" && params.get("view") === "moodboard";
      const items = moodboard ? data.items.filter((item) => item.subkind === "image-original" || item.subkind === "image-derivative") : data.items;
      list.classList.toggle("moodboard", moodboard);
      list.replaceChildren(
        ...items.map((item) => {
          const row = rowFor(item, {
            selecting,
            selected: selection.has(item.id),
            current: item.id === selectedId,
            onOpen: () => openItem(item),
            onToggle: () => {
              if (selection.has(item.id)) selection.delete(item.id);
              else selection.add(item.id);
              paintBar();
              void load();
            },
          });
          row.dataset.id = item.id;
          return row;
        }),
      );
      if (!items.length) list.replaceChildren(h("div", { class: "empty" }, [h("h2", { text: moodboard ? "Aucune image conservée" : q.get("q") || data.counts.total ? "Rien ne correspond" : `Aucune ${tab === "typos" ? "typographie" : LIBRARY_LABEL[tab as Library].toLowerCase().replace(/s$/, "")} gardée` }), h("p", { text: moodboard ? "Ouvrez directement une URL d'image pour démarrer ce moodboard." : q.get("q") || data.counts.total ? "Essayez un autre mot, ou retirez un filtre." : "Ouvrez une capture et touchez Garder sur ce qui vous plaît." })]));
      if (!phone()) {
        const pick = items.find((i) => i.id === selectedId) ?? items[0];
        if (pick) {
          selectedId = pick.id;
          list.querySelector(`[data-id="${pick.id}"]`)?.setAttribute("aria-current", "true");
          void renderDetail(detail, pick.id, false, () => void load());
        } else detail.replaceChildren();
      }
    } catch (error) {
      list.replaceChildren(h("div", { class: "empty" }, [h("h2", { text: "Bibliothèque indisponible" }), h("p", { text: error instanceof Error ? error.message : "" })]));
    }
  };
  renderTabs(null);
  renderFilters(null);
  list.replaceChildren(...[1, 2, 3].map(() => h("div", { class: "row" }, [h("div", { class: "skel", style: "height:52px" }), h("div", { class: "skel", style: "width:50%" })])));
  void app.loadBoards();
  void load();
  return root;
}

async function renderBoards(list: HTMLElement, status: HTMLElement): Promise<void> {
  const name = h("input", { class: "input", placeholder: "Nom du tableau", "aria-label": "Nom du nouveau tableau" });
  const create = h("button", { type: "button", class: "btn primary", text: "Nouveau tableau" });
  create.addEventListener("click", async () => {
    if (!name.value.trim()) {
      name.focus();
      return;
    }
    const created = await post<{ board: Board }>("/api/boards", { name: name.value.trim() });
    app.go(`#/tableaux/${created.board.id}`);
  });
  try {
    const { data, stale } = await get<{ boards: Board[] }>("/api/boards");
    status.textContent = stale ? "hors ligne · cache" : "";
    const grid = h("div", { class: "board-grid" }, data.boards.map((board) => h("a", { class: "board-card", href: `#/tableaux/${board.id}` }, [mosaic(board.tiles), h("div", { class: "row-meta" }, [h("b", { text: board.path }), h("span", { class: "val", text: `${board.count} élément${board.count > 1 ? "s" : ""}` })])])));
    list.replaceChildren(h("div", { class: "capture-form" }, [name, create]), grid);
    if (!data.boards.length) grid.append(h("p", { class: "muted", text: "Aucun tableau. Un tableau mélange palettes, typos, composants et ambiances de plusieurs sites." }));
  } catch (error) {
    list.replaceChildren(h("p", { class: "error-text", text: error instanceof Error ? error.message : "" }));
  }
}

function mosaic(tiles: BoardTile[]): HTMLElement {
  const cells = tiles
    .slice(0, 4)
    .map((tile) =>
      "blob" in tile
        ? h("div", {}, [h("img", { src: mediaUrl(tile.blob) ?? "", alt: "", loading: "lazy" })])
        : h("div", { class: "mosaic-colors" }, tile.colors.map((hex) => h("span", { style: `background:${hex}` }))),
    );
  while (cells.length < 4) cells.push(h("div"));
  return h("div", { class: "mosaic", "aria-hidden": "true" }, cells);
}

/* --------------------------------------------------------------- fiche ---- */

async function renderDetail(host: HTMLElement, itemId: string, standalone: boolean, onChanged: () => void): Promise<void> {
  host.replaceChildren(h("div", { class: "skel", style: "height:22px;width:60%" }), h("div", { class: "skel", style: "height:112px" }));
  try {
    const { data, stale } = await get<{ item: Item }>(`/api/items/${itemId}`);
    host.replaceChildren(...fiche(data.item, { standalone, stale, onChanged }));
    const image = data.item.data as ImageReferenceData;
    if (image.tagAnalysis?.status === "pending" || image.generation?.status === "pending") {
      window.setTimeout(() => {
        if (host.isConnected) void renderDetail(host, itemId, standalone, onChanged);
      }, 1200);
    }
  } catch (error) {
    host.replaceChildren(h("p", { class: "error-text", text: error instanceof Error ? error.message : "Fiche indisponible." }));
  }
}

type ImageCandidate = { tag: string; probability: number; status: "suggested" | "accepted" | "rejected" | "edited"; evidence: string; editedTag?: string };
type ImageReferenceData = {
  width?: number;
  height?: number;
  mime?: string;
  contentHash?: string;
  tagAnalysis?: {
    status: "pending" | "ready" | "unavailable" | "failed";
    vision: { model: string; version: string; evidence: string } | null;
    jev: { model: string; version: string } | null;
    candidates: ImageCandidate[];
    error?: string;
  };
  generation?: { parentId: string; prompt: string; model: string; version: string; status: "pending" | "failed" | "complete"; attempts: number; error?: string };
};

function imageReferenceControls(item: Item, options: { stale: boolean; onChanged(): void }): HTMLElement {
  const root = h("section", { class: "image-reference-controls" });
  const paint = () => {
    const data = item.data as ImageReferenceData;
    const parts: Node[] = [];
    if (options.stale || !app.online()) {
      parts.push(h("p", { class: "offline is-live", text: "Les tags et la génération demandent le serveur. Les métadonnées et l'image en cache restent lisibles." }));
    }
    if (data.tagAnalysis) {
      const analysis = data.tagAnalysis;
      const heading = h("div", { class: "finding-head" }, [h("h3", { text: "Tags sémantiques" }), h("span", { class: "val muted", text: analysis.status === "pending" ? "analyse en cours" : analysis.status === "unavailable" ? "modèles non configurés" : analysis.status === "failed" ? "analyse en échec" : "à valider" })]);
      const tagList = h("div", { class: "image-tag-list" });
      for (const candidate of analysis.candidates) {
        const accept = h("button", { type: "button", class: "btn", text: candidate.status === "accepted" ? "Accepté" : "Accepter" });
        const reject = h("button", { type: "button", class: "btn", text: candidate.status === "rejected" ? "Rejeté" : "Rejeter" });
        const edit = h("button", { type: "button", class: "btn", text: candidate.status === "edited" ? `Corrigé : ${candidate.editedTag}` : "Corriger" });
        for (const button of [accept, reject, edit]) button.disabled = options.stale || !app.online();
        const review = async (status: "accepted" | "rejected" | "edited", editedTag?: string) => {
          const result = await post<{ item: Item }>(`/api/items/${item.id}/image-tags`, { tag: candidate.tag, status, editedTag });
          Object.assign(item, result.item);
          paint();
          options.onChanged();
        };
        accept.addEventListener("click", () => void review("accepted"));
        reject.addEventListener("click", () => void review("rejected"));
        edit.addEventListener("click", () => {
          const input = h("input", { class: "input", value: candidate.editedTag ?? "", placeholder: "Tag corrigé", "aria-label": "Tag corrigé" });
          const save = h("button", { type: "button", class: "btn primary", text: "Enregistrer" });
          const sheet = openSheet({ title: "Corriger la suggestion", body: [input], actions: [save] });
          save.addEventListener("click", () => void review("edited", input.value).then(() => sheet.close()));
        });
        tagList.append(h("article", { class: `image-tag ${candidate.status}` }, [
          h("div", {}, [h("b", { text: candidate.tag }), h("span", { class: "val", text: `${Math.round(candidate.probability * 100)} %` }), h("p", { class: "muted", text: candidate.evidence })]),
          h("div", { class: "actions" }, [accept, reject, edit]),
        ]));
      }
      parts.push(heading);
      if (analysis.vision || analysis.jev) parts.push(h("p", { class: "muted", text: `Vision ${analysis.vision?.model ?? "indisponible"} produit les indices textuels. Jev ${analysis.jev?.model ?? "indisponible"} évalue seulement les candidats.` }));
      if (analysis.error) parts.push(h("p", { class: "error-text", text: analysis.error }));
      parts.push(tagList);
    }
    if (item.subkind === "image-original") {
      const prompt = h("textarea", { class: "input", rows: "3", placeholder: "Conserver la composition, passer le paysage en hiver.", "aria-label": "Consigne de variation" });
      const generate = h("button", { type: "button", class: "btn primary", text: "Générer une variation" });
      generate.disabled = options.stale || !app.online();
      generate.addEventListener("click", async () => {
        if (!prompt.value.trim()) return prompt.focus();
        generate.disabled = true;
        try {
          const result = await post<{ item: Item }>(`/api/items/${item.id}/derivatives`, { prompt: prompt.value });
          app.go(`#/items/${result.item.id}`);
        } catch (error) {
          app.toast(error instanceof Error ? error.message : "Génération impossible");
          generate.disabled = false;
        }
      });
      parts.push(h("div", { class: "generation-box" }, [h("h3", { text: "Variation générée" }), prompt, generate]));
    } else if (data.generation) {
      const generation = data.generation;
      const status = generation.status === "complete" ? "terminée" : generation.status === "failed" ? "en échec" : "en cours";
      const details = h("div", { class: "generation-box" }, [
        h("h3", { text: "Média généré" }),
        h("p", { text: generation.prompt }),
        h("p", { class: "muted", text: `${generation.model}${generation.version ? `, version ${generation.version}` : ""} · ${status} · essai ${generation.attempts}` }),
        h("a", { class: "source-link", href: `#/items/${generation.parentId}`, text: "Ouvrir l'original immuable" }),
      ]);
      if (generation.error) details.append(h("p", { class: "error-text", text: generation.error }));
      if (generation.status === "failed") {
        const retry = h("button", { type: "button", class: "btn primary", text: "Réessayer" });
        retry.disabled = options.stale || !app.online();
        retry.addEventListener("click", async () => {
          const result = await post<{ item: Item }>(`/api/items/${item.id}/derivatives/retry`);
          Object.assign(item, result.item);
          paint();
        });
        details.append(retry);
      }
      parts.push(details);
    }
    if (data.width && data.height) parts.push(h("p", { class: "val muted", text: `${data.width} × ${data.height} px · ${data.mime ?? "format inconnu"} · empreinte ${data.contentHash?.slice(0, 12) ?? "indisponible"}` }));
    root.replaceChildren(...parts);
  };
  paint();
  return root;
}

function fiche(item: Item, options: { standalone: boolean; stale: boolean; onChanged(): void }): Node[] {
  const provenance = item.provenance as { site?: string; sourceUrl?: string; capturedAt?: string; keptAt?: string; finding?: { evidence?: { origin: string; note: string }[] }; sources?: { url: string; host: string }[]; source?: string; partial?: boolean };
  const out: Node[] = [];
  if (options.stale) out.push(h("p", { class: "offline is-live", text: "Hors ligne · cache. Modifications désactivées." }));
  out.push(h("div", { class: "finding-head" }, [h("h2", { text: item.title }), confidenceDot(item.confidence, provenance.finding?.evidence ?? [])]));
  out.push(itemPreview(item, "detail"));
  if (item.subkind === "image-original" || item.subkind === "image-derivative") out.push(imageReferenceControls(item, options));

  // Why: the most valuable field, editable in place.
  const why = h("textarea", { id: `why-${item.id}`, rows: String(Math.min(8, Math.max(2, Math.ceil(item.why.length / 38)))), placeholder: "Sans raison. Dites pourquoi vous le gardez." });
  why.value = item.why;
  why.disabled = options.stale || !app.online();
  let saving = 0;
  const saveWhy = async () => {
    if (why.value.trim() === item.why.trim()) return;
    try {
      await patch(`/api/items/${item.id}`, { why: why.value });
      item.why = why.value.trim();
      app.toast("Raison enregistrée");
      options.onChanged();
    } catch (error) {
      app.toast(error instanceof Error ? error.message : "Non enregistré");
    }
  };
  why.addEventListener("input", () => {
    window.clearTimeout(saving);
    saving = window.setTimeout(() => void saveWhy(), 900);
  });
  why.addEventListener("blur", () => {
    window.clearTimeout(saving);
    void saveWhy();
  });
  out.push(h("div", { class: "why-block" }, [h("label", { for: why.id, text: "Pourquoi je le garde" }), why]));

  // Tags.
  const tagRow = h("div", { class: "tagrow", "aria-label": "Tags" });
  const paintTags = () => {
    const input = h("input", { class: "tag-input", placeholder: "+ tag", "aria-label": "Ajouter un tag" });
    input.disabled = options.stale || !app.online();
    input.addEventListener("keydown", async (event) => {
      if (event.key !== "Enter" || !input.value.trim()) return;
      const result = await patch<{ item: Item }>(`/api/items/${item.id}`, { tags: [...item.tags, input.value.trim()] });
      item.tags = result.item.tags;
      paintTags();
      tagRow.querySelector<HTMLInputElement>(".tag-input")?.focus();
      options.onChanged();
    });
    tagRow.replaceChildren(
      ...item.tags.map((tag) => {
        const remove = h("button", { type: "button", "aria-label": `Retirer le tag ${tag}` }, [icon("x", 14)]);
        remove.disabled = options.stale || !app.online();
        remove.addEventListener("click", async () => {
          const result = await patch<{ item: Item }>(`/api/items/${item.id}`, { tags: item.tags.filter((t) => t !== tag) });
          item.tags = result.item.tags;
          paintTags();
          options.onChanged();
        });
        return h("span", { class: "tag" }, [h("span", { text: tag }), remove]);
      }),
      input,
    );
  };
  paintTags();
  out.push(tagRow);

  // Boards, provenance, duplicates.
  const boardsCell = h("dd", { class: "tagrow" }, [...item.boards.map((b) => h("a", { class: "board-chip", href: `#/tableaux/${b.id}`, text: b.name }))]);
  const addBoard = h("button", { type: "button", class: "fchip", "aria-pressed": "false" }, [icon("plus", 14), h("span", { text: "Ranger" })]);
  addBoard.disabled = options.stale || !app.online();
  addBoard.addEventListener("click", () => void pickBoard([item.id], () => {
    options.onChanged();
    if (options.standalone) app.go(location.hash);
  }));
  boardsCell.append(addBoard);
  const source = provenance.sourceUrl ?? item.sourceUrl;
  const sourceCell = h("dd", {}, [
    source ? h("a", { class: "source-link", href: source, target: "_blank", rel: "noreferrer noopener", text: item.sourceHost ?? source }) : h("span", { text: provenance.source === "atelier" ? "Atelier" : "inconnue" }),
    h("span", { class: "val muted", text: provenance.capturedAt ? `, capturée le ${fullDate(provenance.capturedAt)}` : "" }),
  ]);
  if (item.captureId) sourceCell.append(h("a", { class: "source-link", href: `#/captures/${item.captureId}/palette`, text: " · ouvrir la capture" }));
  const dupCell = h("dd", {});
  const neighbours = item.neighbours ?? [];
  if (!neighbours.length) dupCell.textContent = "Aucun";
  for (const n of neighbours) {
    const merge = h("button", { type: "button", class: "link-btn", text: "Fusionner" });
    merge.addEventListener("click", async () => {
      const merged = await post<{ item: Item }>(`/api/items/${item.id}/merge`, { with: n.id });
      app.toast("Fusionnés : les deux raisons et les deux sources restent");
      options.onChanged();
      app.go(`#/items/${merged.item.id}`);
    });
    dupCell.append(h("div", {}, [h("a", { class: "source-link", href: `#/items/${n.id}`, text: `${n.title} (${LIBRARY_LABEL[n.library]})` }), merge]));
  }
  const sources = (provenance.sources ?? []).filter((s) => s.url && s.url !== source);
  out.push(
    h("dl", { class: "kv" }, [
      h("dt", { text: "Tableaux" }),
      boardsCell,
      h("dt", { text: "Source" }),
      sourceCell,
      ...(sources.length ? [h("dt", { text: "Autres sources" }), h("dd", {}, sources.map((s) => h("a", { class: "source-link", href: s.url, target: "_blank", rel: "noreferrer noopener", text: s.host })))] : []),
      h("dt", { text: "Gardé le" }),
      h("dd", { class: "val", text: fullDate(provenance.keptAt ?? item.createdAt) }),
      h("dt", { text: "Doublons" }),
      dupCell,
    ]),
  );

  // Copy as CSS / Tailwind / JSON.
  const snippet = h("pre", { class: "code", hidden: "" });
  const copyRow = h("div", { class: "copyrow" });
  for (const [format, label] of [
    ["css", "CSS"],
    ["tailwind", "Tailwind"],
    ["json", "JSON"],
  ] as const) {
    const button = h("button", { type: "button", class: "btn" }, [icon("copy", 16), h("span", { text: label })]);
    button.addEventListener("click", async () => {
      try {
        const { data } = await get<{ text: string }>(`/api/items/${item.id}/copy?format=${format}`);
        snippet.hidden = false;
        snippet.textContent = data.text;
        await copyText(data.text);
      } catch (error) {
        app.toast(error instanceof Error ? error.message : "Copie impossible");
      }
    });
    copyRow.append(button);
  }
  out.push(copyRow, snippet);

  const exportButton = h("a", { class: "btn", href: `#/exports?items=${item.id}` }, [icon("export", 18), h("span", { text: "Exporter" })]);
  const remove = h("button", { type: "button", class: "btn danger" }, [icon("trash", 18), h("span", { text: "Supprimer" })]);
  remove.disabled = options.stale || !app.online();
  remove.addEventListener("click", () =>
    confirmSheet("Supprimer cet élément ?", "Il disparaît de la bibliothèque et de ses tableaux, avec sa raison.", "Supprimer", async () => {
      await del(`/api/items/${item.id}`);
      app.toast("Élément supprimé");
      selectedId = null;
      options.onChanged();
      if (options.standalone) app.go(`#/bibliotheque/${item.library}`);
    }),
  );
  out.push(h("div", { class: "fchips" }, [exportButton, remove]));
  return out;
}

export function buildItemPage(itemId: string): HTMLElement {
  const detail = h("div", { class: "detail standalone" });
  const back = h("button", { type: "button", class: "btn square", "aria-label": "Retour" }, [icon("caret-left", 20)]);
  back.addEventListener("click", () => (history.length > 1 ? history.back() : app.go("#/bibliotheque/palettes")));
  const root = h("div", { class: "page" }, [h("header", { class: "head" }, [back, h("div", { class: "head-text" }, [h("h1", { text: "Fiche" })])]), h("div", { class: "scroll" }, [detail])]);
  void renderDetail(detail, itemId, true, () => {});
  return root;
}

/* -------------------------------------------------------------- board ---- */

export function buildBoard(boardId: string): HTMLElement {
  const root = h("div", { class: "page" });
  const load = async () => {
    try {
      const { data, stale } = await get<{ board: Board & { items: Item[] } }>(`/api/boards/${boardId}`);
      const board = data.board;
      await app.loadBoards();
      const back = h("a", { class: "btn square", href: "#/bibliotheque/tableaux", "aria-label": "Tous les tableaux" }, [icon("caret-left", 20)]);
      const rename = h("button", { type: "button", class: "btn", text: "Renommer" });
      const remove = h("button", { type: "button", class: "btn square danger", "aria-label": "Supprimer le tableau" }, [icon("trash", 18)]);
      const exp = h("a", { class: "btn", href: `#/exports?board=${board.id}` }, [icon("export", 18), h("span", { class: "hide-phone", text: "Exporter" })]);
      const createChild = h("button", { type: "button", class: "btn", text: "Nouveau sous-tableau" });
      createChild.disabled = stale || !app.online();
      createChild.addEventListener("click", () => {
        const input = h("input", { class: "input", placeholder: "Nom du sous-tableau", "aria-label": "Nom du sous-tableau" });
        const save = h("button", { type: "button", class: "btn primary", text: "Créer" });
        const sheet = openSheet({ title: `Sous-tableau de ${board.name}`, body: [input], actions: [save] });
        save.addEventListener("click", async () => {
          if (!input.value.trim()) return input.focus();
          const created = await post<{ board: Board }>("/api/boards", { name: input.value, parentId: board.id });
          sheet.close();
          app.go(`#/tableaux/${created.board.id}`);
        });
      });
      rename.addEventListener("click", () => {
        const input = h("input", { class: "input", value: board.name, "aria-label": "Nom du tableau" });
        const save = h("button", { type: "button", class: "btn primary", text: "Enregistrer" });
        const sheet = openSheet({ title: "Renommer le tableau", body: [input], actions: [save] });
        save.addEventListener("click", async () => {
          await patch(`/api/boards/${board.id}`, { name: input.value });
          sheet.close();
          await load();
        });
      });
      remove.addEventListener("click", () =>
        confirmSheet("Supprimer le tableau ?", "Ses éléments restent dans leurs bibliothèques.", "Supprimer", async () => {
          await del(`/api/boards/${board.id}`);
          app.go("#/bibliotheque/tableaux");
        }),
      );
      const kinds = [...new Set(board.items.map((i) => LIBRARY_LABEL[i.library]))].join(", ");
      const grid = h("div", { class: "mixed-grid" }, board.items.map((item) => {
        const row = rowFor(item, { selecting: false, selected: false, current: false, onOpen: () => app.go(`#/items/${item.id}`), onToggle: () => {} });
        return row;
      }));
      const children = app.boards.filter((candidate) => candidate.parentId === board.id);
      const childGrid = h("div", { class: "board-grid" }, children.map((child) => h("a", { class: "board-card", href: `#/tableaux/${child.id}` }, [mosaic(child.tiles), h("b", { text: child.name }), h("span", { class: "val", text: `${child.count} élément${child.count > 1 ? "s" : ""}` })])));
      root.replaceChildren(
        h("header", { class: "head" }, [back, h("div", { class: "head-text" }, [h("h1", { text: board.path }), h("span", { class: "val", text: `${board.count} élément${board.count > 1 ? "s" : ""}${kinds ? ` · ${kinds}` : ""}${stale ? " · hors ligne · cache" : ""}` })]), exp, createChild, rename, remove]),
        h("div", { class: "scroll" }, [
          board.items.length ? h("div", { style: "max-width:420px" }, [mosaic(board.tiles)]) : h("span"),
          ...(children.length ? [h("section", { class: "field" }, [h("h2", { text: "Sous-tableaux" }), childGrid])] : []),
          grid,
          ...(board.items.length ? [] : [h("div", { class: "empty" }, [h("h2", { text: "Tableau vide" }), h("p", { text: "Dans une fiche, « Ranger » ; dans la bibliothèque, sélectionnez plusieurs éléments puis « Ajouter au tableau »." })])]),
        ]),
      );
    } catch (error) {
      root.replaceChildren(h("div", { class: "scroll" }, [h("p", { class: "error-text", text: error instanceof Error ? error.message : "Tableau introuvable." })]));
    }
  };
  root.replaceChildren(h("div", { class: "scroll" }, [h("div", { class: "skel", style: "height:26px;width:40%" }), h("div", { class: "skel", style: "height:180px" })]));
  void load();
  return root;
}

