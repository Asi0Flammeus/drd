/**
 * The inbox: paste a URL, get a capture.
 *
 * It is also where the `{domaine}/{url}` shortcut is explained, because a
 * feature nobody knows about does not exist — and that shortcut is the one
 * that makes this tool usable from a phone, from a share sheet, mid-scroll.
 */

import { get } from "../api";
import type { CaptureSummary } from "../api";
import { h, ICONS, textButton } from "../ui/controls";
import { emptyState, primaryButton, sectionHead, statusPill, textInput } from "../ui/shell";
import { startCapture } from "./capture";

export type InboxHost = { toast(message: string): void; go(route: string): void };

export function buildInboxPanel(host: InboxHost, errorMessage: string | null): HTMLElement {
  const root = h("section", { class: "panel" });
  const list = h("div", { class: "capture-grid" });

  const input = textInput({
    placeholder: "https://exemple.fr/page",
    inputmode: "url",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    "aria-label": "URL à capturer",
  });
  const error = h("p", { class: "form-error", role: "alert" });
  if (errorMessage) error.textContent = errorMessage;

  const submit = async () => {
    const url = input.value.trim();
    if (!url) return;
    error.textContent = "";
    try {
      const id = await startCapture(url);
      input.value = "";
      host.toast("Capture lancée");
      host.go(`#/captures/${id}`);
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : "Capture impossible.";
    }
  };

  const form = h("form", { class: "capture-form" });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });
  form.append(input, primaryButton("Capturer", () => void submit()));

  const refresh = textButton("Actualiser", ICONS.reset, () => void load());
  root.append(
    sectionHead("Capturer", "Une URL publique, un navigateur côté serveur, une page mesurée.", [refresh]),
    form,
    error,
    h("p", { class: "hint" }, [
      h("span", { text: "Raccourci : ouvrez " }),
      h("code", { text: `${location.host}/https://exemple.fr` }),
      h("span", { text: " — l'URL passe directement en capture." }),
    ]),
    list,
  );

  const load = async () => {
    list.replaceChildren(h("p", { class: "loading", text: "Chargement…" }));
    try {
      const { data, stale } = await get<{ captures: CaptureSummary[] }>("/api/captures?limit=60");
      list.replaceChildren();
      if (stale) list.append(h("p", { class: "meta-item is-stale", text: "Hors ligne — dernières captures connues." }));
      if (data.captures.length === 0) {
        list.append(
          emptyState(
            "Rien encore",
            "Collez l'URL d'un site dont le design vous intrigue. Vous pourrez en découper les blocs.",
          ),
        );
        return;
      }
      for (const capture of data.captures) list.append(captureCard(capture, host));
    } catch (failure) {
      list.replaceChildren(emptyState("Liste indisponible", failure instanceof Error ? failure.message : "Erreur."));
    }
  };

  void load();
  return root;
}

function captureCard(capture: CaptureSummary, host: InboxHost): HTMLElement {
  const thumb = capture.screenshot
    ? h("img", { class: "card-thumb", src: capture.screenshot, alt: "", loading: "lazy" })
    : h("div", { class: "card-thumb is-empty" });

  const card = h("article", { class: "capture-card" }, [
    thumb,
    h("div", { class: "card-body" }, [
      h("h3", { class: "card-title", text: capture.title ?? capture.host }),
      h("p", { class: "card-host", text: capture.host }),
      h("div", { class: "card-foot" }, [
        statusPill(capture.status),
        h("span", { class: "meta-item", text: new Date(capture.createdAt).toLocaleDateString("fr-FR") }),
      ]),
    ]),
  ]);
  const open = h("button", { type: "button", class: "card-open", "aria-label": `Ouvrir ${capture.title ?? capture.host}` });
  open.addEventListener("click", () => host.go(`#/captures/${capture.id}`));
  card.append(open);
  return card;
}
