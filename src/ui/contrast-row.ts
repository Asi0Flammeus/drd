/** "Aa" set in the real pair, ratio in mono, grade tag; failures in the error hue. */

import type { ContrastPair } from "../api";
import { num } from "../app";
import { h } from "./controls";

export function contrastRows(pairs: ContrastPair[]): HTMLElement {
  return h(
    "div",
    { class: "pairs" },
    pairs.map((pair) =>
      h("div", { class: "pair" }, [
        h("span", { class: "aa", style: `color:${pair.fg};background:${pair.bg}`, text: "Aa", "aria-hidden": "true" }),
        h("span", { class: "who" }, [h("b", { text: pair.label }), h("span", { class: "val", text: `${pair.fg} / ${pair.bg} · ${pair.where}` })]),
        h("span", { class: "ratio", text: num(pair.wcag), "aria-label": `rapport ${num(pair.wcag)}` }),
        h("span", { class: `grade${pair.grade === "fail" ? " fail" : ""}`, text: pair.grade === "fail" ? "échec" : pair.grade }),
      ]),
    ),
  );
}
