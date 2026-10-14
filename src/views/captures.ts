/**
 * Captures: the URL field, every capture as a row with its live stages, and
 * Pistes (former Découverte) as a strip under them.
 */

import { ApiFailure, get, post } from "../api";
import type { Candidate, CaptureSummary } from "../api";
import { app, relativeDate } from "../app";
import { h } from "../ui/controls";
import { icon } from "../ui/icons";

export const STAGES: { id: NonNullable<CaptureSummary["stage"]>; label: string }[] = [
  { id: "load", label: "Chargement" },
  { id: "scroll", label: "Défilement" },
  { id: "measure", label: "Mesure" },
  { id: "pixels", label: "Pixels" },
  { id: "analyse", label: "Analyse" },
  { id: "done", label: "Terminé" },
];

export function initials(capture: Pick<CaptureSummary, "siteName" | "title" | "host">): string {
  const source = capture.siteName || (capture.title ?? "").split(/\s[|–—-]\s/)[0] || capture.host.replace(/^www\./, "");
  const words = source.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return (words.length >= 2 ? words[0][0] + words[1][0] : source.slice(0, 2)).toUpperCase();
}

export function siteName(capture: Pick<CaptureSummary, "siteName" | "title" | "host">): string {
  return capture.siteName || (capture.title ?? "").split(/\s[|–—-]\s/)[0]?.trim() || capture.host.replace(/^www\./, "");
}

export function stageRow(capture: CaptureSummary): HTMLElement {
  const live = capture.status === "pending" || capture.status === "running" || capture.analysis?.status === "running" || capture.stage === "analyse";
  const now = capture.status === "pending" ? "load" : capture.stage ?? "load";
  const index = STAGES.findIndex((s) => s.id === now);
  return h(
    "div",
    { class: "stages", "aria-label": `Étape : ${STAGES[index]?.label ?? ""}` },
    STAGES.map((stage, i) => h("span", { class: !live || i < index ? "done" : i === index ? "now" : "", text: stage.label })),
  );
}

/** Classifies a URL from the response, then starts a page capture or opens an image reference. */
export async function startReference(url: string, force = true): Promise<{ kind: "capture"; id: string } | { kind: "image"; itemId: string; already: boolean }> {
  return post("/api/references/from-url", { url, force });
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function captureRow(capture: CaptureSummary, onRetry: (id: string) => void): HTMLElement {
  const failed = capture.status === "failed";
  // Ready with stage "analyse" and no analysis row yet is the gap between the
  // capture and its analysis job: still live, not a version-1 capture.
  const live = capture.status === "pending" || capture.status === "running" || capture.analysis?.status === "running" || capture.stage === "analyse";
  const meta = failed
    ? h("span", { class: "val error-text", text: capture.error ?? "Échec sans message." })
    : capture.status === "ready" && capture.counts
      ? h("span", { class: "val", text: `${capture.host}\n${plural(capture.counts.colors, "couleur", "couleurs")} · ${plural(capture.counts.styles, "style", "styles")} · ${plural(capture.counts.components, "composant", "composants")}`, style: "white-space:pre-line" })
      : h("span", { class: "val", text: `${capture.host} · ${relativeDate(capture.createdAt)}${capture.status === "ready" && !capture.analysis && !live ? " · analyse v1" : ""}` });
  const body = h("div", { style: "min-width:0" }, [h("b", { text: capture.status === "ready" ? siteName(capture) : capture.requestedUrl }), meta]);
  if (live) body.append(stageRow(capture));
  const side = h("span", { class: "val muted", text: relativeDate(capture.createdAt) });
  const row = h("a", { class: `capture-row${failed ? " failed" : ""}`, href: `#/captures/${capture.id}/palette` }, [h("span", { class: "badge-site", "aria-hidden": "true", text: initials(capture) }), body, side]);
  if (failed) {
    const retry = h("button", { type: "button", class: "btn", text: "Réessayer" });
    retry.addEventListener("click", (event) => {
      event.preventDefault();
      onRetry(capture.id);
    });
    row.replaceChild(retry, side);
  }
  return row;
}

export function buildCaptures(query: URLSearchParams): HTMLElement {
  const input = h("input", { type: "url", inputmode: "url", placeholder: "https://site.fr", "aria-label": "Adresse à capturer", autocomplete: "off", enterkeyhint: "go" });
  const submit = h("button", { type: "submit", class: "btn primary", text: "Capturer" });
  // The server repairs "site.fr" and "https:/site.fr"; the browser's url check
  // would refuse the first with an English bubble, so it does not get a say.
  const form = h("form", { class: "capture-form", novalidate: "" }, [h("label", { class: "search" }, [icon("magnifier", 18), input]), submit]);
  const message = h("p", { class: "error-text", role: "alert" });
  const list = h("div", { class: "capture-list", "aria-live": "polite" });
  const pistes = h("section", { class: "field", "aria-label": "Pistes" });
  const root = h("div", { class: "page" }, [
    h("header", { class: "head" }, [h("div", { class: "head-text" }, [h("h1", { text: "Captures" }), h("span", { class: "val", text: "Une URL, une page mesurée et décomposée." })])]),
    h("div", { class: "scroll" }, [form, message, list, pistes]),
  ]);
  if (query.get("error")) message.textContent = query.get("error");

  let timer = 0;
  const render = (captures: CaptureSummary[]) => {
    list.replaceChildren(...captures.map((c) => captureRow(c, retry)));
    if (!captures.length) list.replaceChildren(h("div", { class: "empty" }, [h("h2", { text: "Aucune capture" }), h("p", { text: "Collez l'adresse d'un site qui vous plaît. DRD le mesure et en sort palette, typographie, composants et ambiance." })]));
    window.clearTimeout(timer);
    if (captures.some((c) => c.status === "pending" || c.status === "running" || c.analysis?.status === "running" || c.stage === "analyse")) {
      timer = window.setTimeout(load, 1500);
    }
  };
  const load = async () => {
    if (!root.isConnected && timer) return;
    try {
      const { data, stale } = await get<{ captures: CaptureSummary[] }>("/api/captures");
      render(data.captures);
      if (stale) message.textContent = "Hors ligne · liste en cache.";
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "Liste indisponible.";
    }
  };
  const retry = async (id: string) => {
    try {
      await post(`/api/captures/${id}/retry`);
      await load();
    } catch (error) {
      app.toast(error instanceof Error ? error.message : "Nouvel essai impossible");
    }
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const url = input.value.trim();
    if (!url) return;
    message.textContent = "";
    submit.disabled = true;
    try {
      const created = await startReference(url, false);
      input.value = "";
      if (created.kind === "image") {
        app.go(`#/items/${created.itemId}`);
        app.toast(created.already ? "Image déjà conservée" : "Image conservée");
        return;
      }
      await load();
      app.toast("Capture lancée", { label: "Suivre", run: () => app.go(`#/captures/${created.id}/palette`) });
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "already_captured") {
        const existing = error.payload.existing as { id: string; createdAt: string } | undefined;
        message.replaceChildren(h("span", { text: `Déjà capturé${existing ? ` le ${relativeDate(existing.createdAt)}` : ""}. ` }));
        if (existing) message.append(h("a", { class: "link-btn", href: `#/captures/${existing.id}/palette`, text: "Ouvrir" }));
        const again = h("button", { type: "button", class: "link-btn", text: "Recapturer" });
        again.addEventListener("click", async () => {
          await startReference(url, true);
          message.textContent = "";
          input.value = "";
          await load();
        });
        message.append(again);
      } else message.textContent = error instanceof Error ? error.message : "Capture impossible.";
    } finally {
      submit.disabled = false;
    }
  });
  window.addEventListener("hashchange", () => window.clearTimeout(timer), { once: true });
  void load();
  void loadPistes(pistes);
  return root;
}

async function loadPistes(host: HTMLElement): Promise<void> {
  const title = h("div", { class: "finding-head" }, [h("h2", { text: "Pistes" }), h("span", { class: "val muted", text: "tirées des liens de vos captures" })]);
  const refresh = h("button", { type: "button", class: "btn", text: "Chercher des pistes" });
  const strip = h("div", { class: "pistes" });
  host.replaceChildren(title, strip);
  title.append(refresh);
  const render = (candidates: Candidate[]) => {
    strip.replaceChildren(...candidates.map((candidate) => {
      const capture = h("button", { type: "button", class: "btn primary", text: "Capturer" });
      const dismiss = h("button", { type: "button", class: "btn", text: "Écarter" });
      const card = h("article", { class: "piste" }, [h("b", { text: candidate.host }), h("p", { class: "muted", text: candidate.reasons.slice(0, 2).join(" · ") }), h("div", { class: "actions" }, [capture, dismiss])]);
      capture.addEventListener("click", async () => {
        const created = await post<{ captureId: string }>(`/api/discovery/${candidate.id}/accept`);
        app.go(`#/captures/${created.captureId}/palette`);
      });
      dismiss.addEventListener("click", async () => {
        await post(`/api/discovery/${candidate.id}/dismiss`);
        card.remove();
        app.toast(`${candidate.host} écarté`);
      });
      return card;
    }));
    if (!candidates.length) strip.replaceChildren(h("p", { class: "muted", text: "Aucune piste pour l'instant : elles viennent des crédits et liens de pied de page des sites capturés." }));
  };
  refresh.addEventListener("click", async () => {
    refresh.disabled = true;
    try {
      const result = await post<{ candidates: Candidate[] }>("/api/discovery/refresh");
      render(result.candidates);
    } finally {
      refresh.disabled = false;
    }
  });
  try {
    const { data } = await get<{ candidates: Candidate[] }>("/api/discovery");
    render(data.candidates);
  } catch {
    strip.replaceChildren(h("p", { class: "muted", text: "Pistes indisponibles hors ligne." }));
  }
}
