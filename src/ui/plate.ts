/** Crops and specimens sit on the mat with a hairline, never a shadow (§8.4). */

import { h } from "./controls";

export function plate(src: string | null, alt: string, extraClass = ""): HTMLElement {
  const box = h("div", { class: `plate ${extraClass}`.trim() });
  if (src) {
    const img = h("img", { src, alt, loading: "lazy", decoding: "async" });
    img.addEventListener("error", () => box.replaceChildren(h("span", { class: "muted val", text: "image indisponible hors ligne" })));
    box.append(img);
  } else box.append(h("span", { class: "muted val", text: "pas d'image" }));
  return box;
}
