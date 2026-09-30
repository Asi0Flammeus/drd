/**
 * Garder, the central gesture (§5.2), and what follows it.
 *
 * One tap creates the item at once and turns the button into Gardé; a toast
 * rises asking "Pourquoi ?" without blocking; long-press or the chevron opens
 * the board picker; tapping Gardé opens the item. Offline, the button is
 * disabled and says why.
 */

import { ApiFailure, del, patch, post } from "../api";
import type { Item, KeepResult, Library, Neighbour } from "../api";
import { app } from "../app";
import { h } from "./controls";
import { icon } from "./icons";
import { openSheet } from "./sheet";

export const LIBRARY_LABEL: Record<Library, string> = { palettes: "Palettes", typos: "Typographies", composants: "Composants", ambiances: "Ambiances" };

/** Quick reasons, per kind (§5.2). Chips write to `why` and become tags. */
export const QUICK_REASONS: Record<Library, string[]> = {
  palettes: ["un seul accent", "fond chaud", "contraste doux", "retenue", "accent audacieux", "sombre maîtrisé"],
  typos: ["échelle nette", "caractère", "lisibilité", "paire contrastée", "titres serrés"],
  composants: ["tient au doigt", "état visible", "rayon juste", "hiérarchie claire"],
  ambiances: ["lumière", "grain", "calme", "chaleur"],
};

const toastHost = (): HTMLElement => document.querySelector(".toast-host") as HTMLElement;

let current: HTMLElement | null = null;

/**
 * The keep toast: inverted sheet, quick reasons, one field, Tableau…,
 * Annuler, and Fusionner when the new item is close to an older one. Stays
 * 6 s, paused while focused or hovered.
 */
export function keepToast(result: KeepResult, callbacks: { onUndo(): void }): void {
  current?.remove();
  const item = result.item;
  const chosen = new Set<string>();
  const field = h("input", { class: "why-field", id: "keep-why", placeholder: "Pourquoi je le garde", "aria-label": "Pourquoi je le garde", autocomplete: "off" });
  const saveWhy = async () => {
    const parts = [[...chosen].join(", "), field.value.trim()].filter(Boolean);
    try {
      await patch(`/api/items/${item.id}`, { why: parts.join(". "), addTags: [...chosen] });
    } catch (error) {
      app.toast(error instanceof Error ? error.message : "Raison non enregistrée");
    }
  };
  const chips = h("div", { class: "chips" });
  for (const reason of QUICK_REASONS[item.library] ?? []) {
    const chip = h("button", { type: "button", class: "chip", "aria-pressed": "false", text: reason });
    chip.addEventListener("click", () => {
      if (chosen.has(reason)) chosen.delete(reason);
      else chosen.add(reason);
      chip.setAttribute("aria-pressed", chosen.has(reason) ? "true" : "false");
      void saveWhy();
    });
    chips.append(chip);
  }
  let typing = 0;
  field.addEventListener("input", () => {
    window.clearTimeout(typing);
    typing = window.setTimeout(() => void saveWhy(), 500);
  });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      window.clearTimeout(typing);
      void saveWhy().then(() => dismiss());
    }
  });

  const board = h("button", { type: "button", class: "link-btn", text: "Tableau…" });
  const undo = h("button", { type: "button", class: "link-btn", text: "Annuler" });
  const toast = h("div", { class: "keep-toast", role: "status", "aria-live": "polite" }, [
    h("div", { class: "toast-top" }, [icon("bookmark-fill", 18), h("strong", { text: `Gardé dans ${LIBRARY_LABEL[item.library]}` }), board, undo]),
    h("label", { for: "keep-why", text: "Pourquoi ?" }),
    chips,
    field,
  ]);
  const neighbour: Neighbour | undefined = result.neighbours[0];
  if (neighbour) {
    const merge = h("button", { type: "button", class: "link-btn", text: "Fusionner" });
    merge.addEventListener("click", async () => {
      window.clearTimeout(typing);
      await saveWhy();
      const merged = await post<{ item: Item }>(`/api/items/${neighbour.id}/merge`, { with: item.id });
      dismiss();
      app.toast(`Fusionné dans « ${merged.item.title} »`, { label: "Ouvrir", run: () => app.go(`#/items/${merged.item.id}`) });
      callbacks.onUndo();
    });
    toast.append(h("div", { class: "neighbour" }, [h("span", { text: `Proche de « ${neighbour.title} » (${LIBRARY_LABEL[neighbour.library]})` }), merge]));
  }

  let timer = 0;
  let paused = false;
  const dismiss = () => {
    window.clearTimeout(timer);
    toast.remove();
    if (current === toast) current = null;
  };
  const arm = () => {
    window.clearTimeout(timer);
    if (!paused) timer = window.setTimeout(dismiss, 6000);
  };
  toast.addEventListener("focusin", () => {
    paused = true;
    window.clearTimeout(timer);
  });
  toast.addEventListener("focusout", () => {
    paused = toast.matches(":hover");
    arm();
  });
  toast.addEventListener("pointerenter", () => {
    paused = true;
    window.clearTimeout(timer);
  });
  toast.addEventListener("pointerleave", () => {
    paused = toast.contains(document.activeElement);
    arm();
  });
  board.addEventListener("click", () => {
    dismiss();
    pickBoard([item.id]);
  });
  undo.addEventListener("click", async () => {
    await del(`/api/items/${item.id}`);
    dismiss();
    callbacks.onUndo();
    app.toast("Retiré de la bibliothèque");
  });
  current = toast;
  toastHost().append(toast);
  arm();
}

/** Last used board first, then recent, then "Nouveau tableau" (§5.2). */
export async function pickBoard(itemIds: string[], onDone?: () => void): Promise<void> {
  const boards = await app.loadBoards();
  const list = h("div", { class: "picker" });
  const name = h("input", { class: "input", placeholder: "Nouveau tableau", "aria-label": "Nom du nouveau tableau" });
  const create = h("button", { type: "button", class: "btn primary", text: "Créer et ranger" });
  const sheet = openSheet({ title: "Ranger dans un tableau", body: [list, h("div", { class: "capture-form" }, [name, create])] });
  const done = (label: string) => {
    sheet.close();
    app.toast(`Rangé dans « ${label} »`);
    void app.loadBoards();
    onDone?.();
  };
  for (const board of boards) {
    const button = h("button", { type: "button", class: "btn" }, [icon("squares", 18), h("span", { text: board.name }), h("span", { class: "val muted", text: String(board.count) })]);
    button.addEventListener("click", async () => {
      await post(`/api/boards/${board.id}/items`, { itemIds });
      done(board.name);
    });
    list.append(button);
  }
  if (!boards.length) list.append(h("p", { class: "muted", text: "Aucun tableau pour l'instant." }));
  create.addEventListener("click", async () => {
    const label = name.value.trim();
    if (!label) {
      name.focus();
      return;
    }
    await post("/api/boards", { name: label, itemIds });
    done(label);
  });
}

export type KeepButtonOptions = { findingId: string; itemId: string | null; label?: string; iconOnly?: boolean; ariaLabel: string; onChange?: (itemId: string | null) => void };

export function keepButton(options: KeepButtonOptions): HTMLElement {
  let itemId = options.itemId;
  const button = h("button", { type: "button", class: `keep${options.iconOnly ? " icon-only" : ""}` });
  const more = h("button", { type: "button", class: "keep-more", "aria-label": `${options.ariaLabel} : ranger dans un tableau` }, [icon("caret-down", 16)]);
  const paint = () => {
    const kept = itemId !== null;
    button.setAttribute("aria-pressed", kept ? "true" : "false");
    button.setAttribute("aria-label", kept ? `${options.ariaLabel} : gardé, ouvrir` : options.ariaLabel);
    const offline = !app.online();
    button.disabled = offline && !kept;
    button.title = offline && !kept ? "Hors ligne : garder demande le serveur." : "";
    button.replaceChildren(icon(kept ? "bookmark-fill" : "bookmark", 18));
    if (!options.iconOnly) button.append(h("span", { text: kept ? "Gardé" : options.label ?? "Garder" }));
  };
  const keep = async (): Promise<string | null> => {
    if (itemId) return itemId;
    try {
      const result = await post<KeepResult>("/api/items", { findingId: options.findingId });
      itemId = result.item.id;
      paint();
      options.onChange?.(itemId);
      if (!result.already) {
        keepToast(result, {
          onUndo: () => {
            itemId = null;
            paint();
            options.onChange?.(null);
          },
        });
      }
      return itemId;
    } catch (error) {
      app.toast(error instanceof ApiFailure && error.offline ? "Hors ligne : rien n'a été gardé." : error instanceof Error ? error.message : "Échec");
      return null;
    }
  };
  let pressTimer = 0;
  let longPressed = false;
  button.addEventListener("pointerdown", () => {
    longPressed = false;
    pressTimer = window.setTimeout(async () => {
      longPressed = true;
      const id = await keep();
      if (id) await pickBoard([id]);
    }, 550);
  });
  for (const type of ["pointerup", "pointerleave", "pointercancel"]) button.addEventListener(type, () => window.clearTimeout(pressTimer));
  button.addEventListener("contextmenu", (event) => event.preventDefault());
  button.addEventListener("click", async () => {
    if (longPressed) return;
    if (itemId) {
      app.go(`#/items/${itemId}`);
      return;
    }
    await keep();
  });
  more.addEventListener("click", async () => {
    const id = await keep();
    if (id) await pickBoard([id]);
  });
  window.addEventListener("drd:connection", paint);
  paint();
  return h("span", { class: "keep-wrap" }, [button, more]);
}
