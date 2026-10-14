/**
 * Sticky tabs. Each tab is a link, so the hash changes and Back returns to
 * the previous tab (I-05); arrow keys move along the list.
 */

import { h } from "./controls";

export type TabSpec = { id: string; label: string; count?: number | null; href: string };

export function tabs(items: TabSpec[], current: string, extraClass = ""): HTMLElement {
  const list = h("nav", { class: `tabs ${extraClass}`.trim(), role: "tablist" });
  for (const item of items) {
    const tab = h("a", { class: "tab", role: "tab", href: item.href, "aria-selected": item.id === current ? "true" : "false", tabindex: item.id === current ? "0" : "-1" }, [h("span", { text: item.label })]);
    if (typeof item.count === "number") tab.append(h("span", { class: "val", text: String(item.count) }));
    tab.addEventListener("keydown", (event) => {
      const all = [...list.querySelectorAll<HTMLAnchorElement>(".tab")];
      const index = all.indexOf(tab);
      const next = event.key === "ArrowRight" ? all[index + 1] : event.key === "ArrowLeft" ? all[index - 1] : null;
      if (next) {
        event.preventDefault();
        next.focus();
      }
    });
    list.append(tab);
  }
  requestAnimationFrame(() => list.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  return list;
}
