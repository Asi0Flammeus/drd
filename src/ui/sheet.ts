/**
 * The one modal surface: a native <dialog>, so focus trapping, Escape and the
 * top layer come from the browser. Bottom sheet on the phone, centred panel
 * on the Fold's inner screen; `full` is the Localiser's full-screen viewer.
 */

import { h } from "./controls";
import { icon } from "./icons";

export type Sheet = { dialog: HTMLDialogElement; body: HTMLElement; close(): void };

export function openSheet(options: { title: string; body: Node[]; actions?: HTMLElement[]; full?: boolean; onClose?: () => void }): Sheet {
  const close = h("button", { type: "button", class: "btn square", "aria-label": "Fermer" }, [icon("x", 20)]);
  const body = h("div", { class: "sheet-body" }, options.body);
  const inner = h("div", { class: "sheet-inner" }, [h("div", { class: "sheet-head" }, [h("h2", { text: options.title }), close]), body]);
  if (options.actions?.length) inner.append(h("div", { class: "sheet-actions" }, options.actions));
  const dialog = h("dialog", { class: `sheet${options.full ? " full" : ""}`, "aria-label": options.title }, [inner]);
  document.body.append(dialog);
  const finish = () => {
    if (dialog.open) dialog.close();
  };
  dialog.addEventListener("close", () => {
    dialog.remove();
    options.onClose?.();
  });
  close.addEventListener("click", finish);
  // A tap on the backdrop closes; a tap inside never does.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) finish();
  });
  dialog.showModal();
  return { dialog, body, close: finish };
}

export function confirmSheet(title: string, message: string, confirmLabel: string, onConfirm: () => Promise<void> | void): void {
  const confirm = h("button", { type: "button", class: "btn primary", text: confirmLabel });
  const cancel = h("button", { type: "button", class: "btn", text: "Annuler" });
  const sheet = openSheet({ title, body: [h("p", { text: message })], actions: [cancel, confirm] });
  cancel.addEventListener("click", () => sheet.close());
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    try {
      await onConfirm();
      sheet.close();
    } finally {
      confirm.disabled = false;
    }
  });
}
