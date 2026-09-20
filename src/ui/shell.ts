/**
 * The pieces every section of the app is built from: fields, cards, status
 * pills, empty states, and the sheet.
 *
 * The sheet is the one that matters. Saving a reference asks four questions —
 * what kind of thing is this, what is it, why do you want it, where does it
 * go — and those four questions are identical whether the thing came from a
 * captured page or from the playground. One surface, one habit, one shape of
 * data in the database.
 */

import { h, icon, ICONS } from "./controls";

export function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  const parts: (Node | string)[] = [h("span", { class: "fld-label", text: label }), input];
  if (hint) parts.push(h("span", { class: "fld-hint", text: hint }));
  return h("label", { class: "fld" }, parts);
}

export function textInput(attrs: Record<string, string>): HTMLInputElement {
  return h("input", { class: "fld-input", type: "text", ...attrs });
}

export function textArea(attrs: Record<string, string>): HTMLTextAreaElement {
  return h("textarea", { class: "fld-area", rows: "3", ...attrs });
}

export function select(options: { value: string; label: string }[], value: string): HTMLSelectElement {
  const el = h("select", { class: "fld-input" });
  for (const option of options) {
    const node = h("option", { value: option.value, text: option.label });
    if (option.value === value) node.selected = true;
    el.append(node);
  }
  return el;
}

export function primaryButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = h("button", { type: "button", class: "action is-primary" }, [h("span", { text: label })]);
  button.addEventListener("click", onClick);
  return button;
}

export function statusPill(status: string): HTMLElement {
  const labels: Record<string, string> = {
    pending: "en attente",
    running: "capture en cours",
    ready: "prête",
    failed: "échec",
  };
  return h("span", { class: `pill pill--${status}`, text: labels[status] ?? status });
}

export function emptyState(title: string, body: string, action?: HTMLElement): HTMLElement {
  const parts: (Node | string)[] = [h("p", { class: "empty-title", text: title }), h("p", { class: "empty-body", text: body })];
  if (action) parts.push(action);
  return h("div", { class: "empty" }, parts);
}

export function sectionHead(title: string, blurb: string, actions: Node[] = []): HTMLElement {
  return h("header", { class: "panel-head" }, [
    h("div", {}, [h("h2", { class: "panel-title", text: title }), h("p", { class: "panel-blurb", text: blurb })]),
    h("div", { class: "panel-actions" }, actions),
  ]);
}

/* ------------------------------------------------------------- sheet ----- */

export type SheetOptions = {
  title: string;
  body: Node[];
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
};

/**
 * A bottom sheet, because this app is used one-handed on a phone as often as
 * on a desk: the controls sit under the thumb, the backdrop closes, Escape
 * closes, and the safe-area inset is respected so the confirm button is never
 * under the gesture bar.
 */
export function openSheet(options: SheetOptions): void {
  const existing = document.querySelector(".sheet-backdrop");
  existing?.remove();

  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };

  const confirm = h("button", { type: "button", class: "action is-primary" }, [
    icon(ICONS.check),
    h("span", { text: options.confirmLabel }),
  ]);
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    try {
      await options.onConfirm();
      close();
    } finally {
      confirm.disabled = false;
    }
  });

  const cancel = h("button", { type: "button", class: "action" }, [h("span", { text: "Annuler" })]);
  cancel.addEventListener("click", close);

  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": options.title }, [
    h("div", { class: "sheet-grip" }),
    h("h3", { class: "sheet-title", text: options.title }),
    h("div", { class: "sheet-body" }, options.body),
    h("div", { class: "sheet-foot" }, [cancel, confirm]),
  ]);

  const backdrop = h("div", { class: "sheet-backdrop" }, [sheet]);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  const firstInput = sheet.querySelector("input, textarea, select");
  if (firstInput instanceof HTMLElement) firstInput.focus();
}

export function confirmSheet(title: string, message: string, confirmLabel: string, onConfirm: () => void | Promise<void>): void {
  openSheet({
    title,
    body: [h("p", { class: "sheet-text", text: message })],
    confirmLabel,
    onConfirm,
  });
}
