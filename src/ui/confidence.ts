/**
 * One confidence display everywhere (§4.8): a filled, half or empty dot and
 * its word; tapping it lists the evidence.
 */

import type { Confidence, Evidence } from "../api";
import { h } from "./controls";
import { openSheet } from "./sheet";

const WORD: Record<Confidence, string> = { sure: "sûr", probable: "probable", check: "à vérifier" };
const ORIGIN: Record<string, string> = { dom: "DOM", pixels: "pixels", declared: "CSS déclaré", network: "réseau", cdp: "rendu Chrome" };

export function confidenceDot(confidence: Confidence | null, evidence: Evidence[] = []): HTMLElement {
  const level = confidence ?? "check";
  const button = h("button", { type: "button", class: `conf ${level}`, "aria-label": `Confiance : ${WORD[level]}. Voir les preuves.` }, [h("i"), h("span", { text: WORD[level] })]);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    openSheet({
      title: `Confiance : ${WORD[level]}`,
      body: evidence.length
        ? [h("dl", { class: "kv" }, evidence.flatMap((e) => [h("dt", { text: ORIGIN[e.origin] ?? e.origin }), h("dd", { text: e.note })]))]
        : [h("p", { class: "muted", text: "Aucune preuve enregistrée pour cet élément (référence migrée de la version 1)." })],
    });
  });
  return button;
}
