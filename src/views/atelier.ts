/**
 * Atelier: compose kept things, and the three benches carried over from the
 * playground. The Mélange sets a mini page with a kept palette and a kept
 * type item; "Garder le mélange" saves the combination as a board (I-25).
 */

import { get, mediaUrl, post } from "../api";
import type { Board, Item, PaletteData, SearchResult, TypeFamilyData, TypePairData } from "../api";
import { app } from "../app";
import { FAMILIES } from "../data/fonts";
import { loadWorkspace, saveWorkspace } from "../state";
import type { DimensionId, Workspace } from "../state";
import { miniBands } from "../ui/bands";
import { h } from "../ui/controls";
import { itemPreview } from "../ui/preview";
import { tabs } from "../ui/tabs";
import { buildColorPanel } from "./color";
import { buildComponentPanel } from "./components";
import { buildTypePanel } from "./type";
import type { Panel, ViewContext } from "./view";

const ws: Workspace = loadWorkspace();

type Roles = { background: string; surface: string; text: string; muted: string; accent: string; onAccent: string; border: string };

function rolesOf(item: Item | null): Roles {
  const fallback: Roles = { background: "#f4f4f4", surface: "#ffffff", text: "#1c1c1c", muted: "#5c5c5c", accent: "#3a3a3a", onAccent: "#ffffff", border: "#d9d9d9" };
  if (!item) return fallback;
  const data = (item.data ?? {}) as Partial<PaletteData> & { roles?: Record<string, string> };
  const colors = data.colors ?? [];
  const byKey = (key: string) => colors.find((c) => c.key === key)?.hex;
  const byRole = (role: string) => colors.find((c) => c.role.toLowerCase() === role)?.hex ?? data.roles?.[role];
  const background = byKey("background") ?? byRole("fond") ?? byRole("background") ?? fallback.background;
  const accent = byKey("accent") ?? byRole("accent") ?? colors.find((c) => c.value && c.value.c > 0.05)?.hex ?? fallback.accent;
  const l = (hex: string) => {
    const n = parseInt(hex.slice(1, 7), 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  };
  const dark = l(background) < 0.5;
  return {
    background,
    surface: byKey("surface") ?? byRole("surface") ?? background,
    text: byKey("text") ?? byRole("texte") ?? byRole("text") ?? (dark ? "#f2f2f2" : "#1c1c1c"),
    muted: byKey("text-muted") ?? byRole("texte 2") ?? (dark ? "#a8a8a8" : "#5c5c5c"),
    accent,
    onAccent: l(accent) > 0.6 ? "#161616" : "#ffffff",
    border: byKey("border") ?? byRole("bordure") ?? (dark ? "#333333" : "#dddddd"),
  };
}

type Faces = { display: string; text: string; note: string };

/** Live faces: kept OFL files, else the bench's self-hosted families, else the generic class. */
function facesOf(item: Item | null, lock: string | null): Faces {
  const pair = (item?.data ?? {}) as Partial<TypePairData>;
  const data = (item?.data ?? {}) as Partial<TypeFamilyData>;
  const loaded = (family: string, files: { file: string; weight: string; style: string }[] | undefined) => {
    if (!files?.length) return null;
    const name = `drd-mix-${family.replace(/[^a-z0-9]/gi, "")}`;
    if (!document.getElementById(name)) {
      document.head.append(h("style", { id: name, text: files.map((f) => `@font-face{font-family:"${name}";src:url("${mediaUrl(f.file)}");font-weight:${f.weight};font-style:${f.style}}`).join("\n") }));
    }
    return `"${name}"`;
  };
  const generic = (g: string | undefined) => (g === "serif" ? "Georgia, serif" : g === "monospace" ? "monospace" : "system-ui, sans-serif");
  let display = generic(undefined);
  let text = generic(undefined);
  let note = "Aucune typo choisie : police système.";
  if (item) {
    if (pair.display && pair.text && typeof pair.display === "object" && "generic" in pair.display) {
      display = generic(pair.display.generic);
      text = generic(pair.text.generic);
      note = `${pair.display.family} et ${pair.text.family} ne sont pas stockées (licence) : rendu dans leur classe (${pair.display.generic}, ${pair.text.generic}). Les découpes montrent les vraies.`;
    } else if (typeof data.family === "string") {
      const live = loaded(data.family, data.fontFiles);
      display = live ?? generic(data.generic);
      text = display;
      note = live ? `${data.family} en direct (fichier OFL gardé).` : `${data.family} n'est pas stockée (licence ${data.source?.licence ?? "à vérifier"}) : rendu dans sa classe ${data.generic}.`;
    } else if (pair.display && typeof pair.display === "object" && "family" in pair.display) {
      display = `"${pair.display.family}"`;
      text = `"${((pair as { body?: { family: string } }).body ?? pair.display).family}"`;
      note = "Paire de l'atelier, polices auto-hébergées.";
    }
  }
  if (lock) {
    text = `"${lock}"`;
    note += ` Corps essayé en ${lock}.`;
  }
  return { display, text, note };
}

function miniPage(roles: Roles, faces: Faces): HTMLElement {
  const style = `--bg:${roles.background};--sf:${roles.surface};--tx:${roles.text};--mu:${roles.muted};--ac:${roles.accent};--on:${roles.onAccent};--bd:${roles.border}`;
  const card = (title: string, body: string) => h("div", { style: `background:var(--sf);border:1px solid var(--bd);border-radius:10px;padding:16px;display:grid;gap:6px` }, [h("b", { style: `font-family:${faces.display};font-size:18px;color:var(--tx)`, text: title }), h("p", { style: "margin:0;color:var(--mu);font-size:14px;line-height:1.5", text: body })]);
  return h("div", { class: "mix-preview", style }, [
    h("div", { style: `background:var(--bg);color:var(--tx);font-family:${faces.text};padding:28px 24px;display:grid;gap:18px` }, [
      h("div", { style: "display:flex;gap:16px;align-items:center;font-size:13px;color:var(--mu)" }, [h("b", { style: `font-family:${faces.display};font-size:17px;color:var(--tx);margin-right:auto`, text: "Atelier Cour" }), h("span", { text: "Soins" }), h("span", { text: "Maison" }), h("span", { text: "Contact" })]),
      h("h2", { style: `margin:12px 0 0;font-family:${faces.display};font-size:clamp(28px,5vw,44px);line-height:1.1;color:var(--tx)`, text: "Un lieu calme, un seul accent." }),
      h("p", { style: "margin:0;max-width:52ch;font-size:16px;line-height:1.6;color:var(--mu)", text: "Le corps de texte porte l'essentiel : lisible, posé, jamais plus bruyant que le titre qu'il accompagne." }),
      h("div", { style: "display:flex;gap:10px;flex-wrap:wrap" }, [h("span", { style: "background:var(--ac);color:var(--on);padding:10px 18px;border-radius:999px;font-size:14px;font-weight:600", text: "Réserver" }), h("span", { style: "border:1px solid var(--ac);color:var(--ac);padding:10px 18px;border-radius:999px;font-size:14px", text: "Voir les soins" })]),
      h("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px" }, [card("Cuir chevelu", "Un massage lent, des huiles choisies."), card("Rituel visage", "Nettoyer, masser, laisser reposer.")]),
    ]),
  ]);
}

function mix(): HTMLElement {
  const palettesHost = h("div", { class: "pick-list", role: "group", "aria-label": "Palettes gardées" });
  const typesHost = h("div", { class: "pick-list", role: "group", "aria-label": "Typos gardées" });
  const lockHost = h("div", { class: "fchips", role: "group", "aria-label": "Essayer le corps en" });
  const stage = h("div", { class: "field" });
  const save = h("button", { type: "button", class: "btn primary", text: "Garder le mélange" });
  let palette: Item | null = null;
  let type: Item | null = null;
  let lock: string | null = null;
  const paint = () => {
    const faces = facesOf(type, lock);
    stage.replaceChildren(miniPage(rolesOf(palette), faces), h("p", { class: "subtle", text: faces.note }));
    save.disabled = !palette || !type;
  };
  const pick = (host: HTMLElement, items: Item[], onPick: (item: Item) => void, current: () => Item | null) => {
    host.replaceChildren(
      ...items.map((item) => {
        const button = h("button", { type: "button", class: "pick", "aria-pressed": "false" }, [item.kind === "palette" ? miniBands(((item.data as PaletteData).colors ?? []).map((c) => ({ role: c.role, hex: c.hex, value: c.value ?? null })), false) : itemPreview(item, "row"), h("span", { class: "row-meta" }, [h("b", { text: item.title }), h("span", { class: "val", text: item.sourceHost ?? "atelier" })])]);
        button.addEventListener("click", () => {
          onPick(item);
          for (const other of host.children) other.setAttribute("aria-pressed", other === button ? "true" : "false");
          paint();
        });
        if (current()?.id === item.id) button.setAttribute("aria-pressed", "true");
        return button;
      }),
    );
    if (!items.length) host.replaceChildren(h("p", { class: "muted", text: "Rien de gardé ici pour l'instant." }));
  };
  for (const family of [null, ...FAMILIES.map((f) => f.name)]) {
    const chip = h("button", { type: "button", class: "fchip", "aria-pressed": family === null ? "true" : "false", text: family ?? "Corps d'origine", style: family ? `font-family:"${family}"` : "" });
    chip.addEventListener("click", () => {
      lock = family;
      for (const other of lockHost.children) other.setAttribute("aria-pressed", other === chip ? "true" : "false");
      paint();
    });
    lockHost.append(chip);
  }
  save.addEventListener("click", async () => {
    if (!palette || !type) return;
    const created = await post<{ board: Board }>("/api/boards", { name: `Mélange · ${palette.title} + ${type.title}`.slice(0, 120), description: lock ? `Corps essayé en ${lock}.` : "", itemIds: [palette.id, type.id] });
    app.toast(`Tableau « ${created.board.name} » créé`, { label: "Ouvrir", run: () => app.go(`#/tableaux/${created.board.id}`) });
  });
  void (async () => {
    try {
      const [palettes, types] = await Promise.all([get<SearchResult>("/api/items?library=palettes&kind=palette"), get<SearchResult>("/api/items?library=typos")]);
      pick(palettesHost, palettes.data.items, (item) => (palette = item), () => palette);
      pick(typesHost, types.data.items, (item) => (type = item), () => type);
    } catch {
      palettesHost.replaceChildren(h("p", { class: "muted", text: "Bibliothèque indisponible hors ligne." }));
    }
  })();
  paint();
  return h("div", { class: "atelier-split" }, [
    h("div", { class: "field" }, [h("h2", { class: "section-title", text: "Palette" }), palettesHost, h("h2", { class: "section-title", text: "Typo" }), typesHost]),
    h("div", { class: "field" }, [stage, h("span", { class: "muted", text: "Essayer le corps en :" }), lockHost, save]),
  ]);
}

const BENCHES: { id: DimensionId; label: string }[] = [
  { id: "type", label: "Banc typo" },
  { id: "color", label: "Banc couleur" },
  { id: "components", label: "Banc composants" },
];

export function buildAtelier(section: string | null): HTMLElement {
  const current = section && BENCHES.some((b) => b.id === section) ? section : "melange";
  let panel: Panel | null = null;
  const body = h("div", { class: "scroll" });
  const ctx: ViewContext = {
    ws,
    commit() {
      saveWorkspace(ws);
      panel?.sync();
    },
    rebuild() {
      saveWorkspace(ws);
      render();
    },
    go: (route) => app.go(route),
    toast: (message) => app.toast(message),
  };
  const render = () => {
    if (current === "melange") {
      body.replaceChildren(h("p", { class: "subtle", text: "Choisissez une palette et une typo gardées : la page d'essai se recompose avec elles." }), mix());
      return;
    }
    ws.dimension = current as DimensionId;
    panel = current === "color" ? buildColorPanel(ctx) : current === "components" ? buildComponentPanel(ctx) : buildTypePanel(ctx);
    body.replaceChildren(panel.el);
  };
  render();
  return h("div", { class: "page" }, [
    h("header", { class: "head" }, [h("div", { class: "head-text" }, [h("h1", { text: "Atelier" }), h("span", { class: "val", text: "Mélanger ce qui est gardé, essayer sur des bancs." })])]),
    tabs([{ id: "melange", label: "Mélange", href: "#/atelier" }, ...BENCHES.map((b) => ({ id: b.id, label: b.label, href: `#/atelier/${b.id}` }))], current),
    body,
  ]);
}
