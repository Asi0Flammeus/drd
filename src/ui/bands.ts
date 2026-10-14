/**
 * A palette as full-height bands, role and hex printed on the colour in
 * whichever ink passes (L > 0.6 takes dark ink). Sharp 2 px corners; the
 * selected band gets an inset double ring.
 */

import type { Oklch } from "../api";
import { h } from "./controls";

export function inkOn(value: Oklch | null, hex: string): string {
  const l = value?.l ?? (() => {
    const n = parseInt(hex.slice(1, 7), 16);
    const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const y = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return Math.cbrt(y);
  })();
  return l > 0.6 ? "oklch(0.2 0 0)" : "oklch(0.97 0 0)";
}

export type BandColor = { role: string; hex: string; value: Oklch | null; share?: number };

/** Band width follows area share, with a floor so a 1 % accent is still a band. */
const weight = (share: number | undefined) => 1 + Math.sqrt(Math.max(share ?? 0.02, 0)) * 3;

export function bands(colors: BandColor[], options: { selected?: number; onSelect?: (index: number) => void; label: string }): HTMLElement {
  const group = h("div", { class: "bands", role: "group", "aria-label": options.label });
  colors.forEach((color, index) => {
    const band = h("button", {
      type: "button",
      class: `band${color.value && color.value.l > 0.93 ? " edge" : ""}`,
      style: `background:${color.hex};color:${inkOn(color.value, color.hex)};--w:${weight(color.share)}`,
      "aria-pressed": options.selected === index ? "true" : "false",
      "aria-label": `${color.role} ${color.hex}`,
    }, [h("b", { text: color.role }), h("span", { class: "val", text: color.hex })]);
    band.addEventListener("click", () => options.onSelect?.(index));
    group.append(band);
  });
  return group;
}

export function miniBands(colors: BandColor[], withHex = colors.length <= 7): HTMLElement {
  return h(
    "div",
    { class: "mini-bands", role: "img", "aria-label": colors.map((c) => `${c.role} ${c.hex}`).join(", ") },
    colors.map((color) =>
      h("span", { style: `background:${color.hex};color:${inkOn(color.value, color.hex)};--w:${weight(color.share)}` }, withHex ? [h("span", { class: "val", text: color.hex })] : []),
    ),
  );
}
