/**
 * Four destinations: a left rail on the Fold's inner screen, a bottom bar
 * under 700 px (§6), current item on a plate.
 */

import { post, clearCache } from "../api";
import { app } from "../app";
import { h } from "./controls";
import { icon } from "./icons";
import type { IconName } from "./icons";

const ITEMS: { section: string; href: string; label: string; icon: IconName }[] = [
  { section: "captures", href: "#/captures", label: "Captures", icon: "cards" },
  { section: "bibliotheque", href: "#/bibliotheque/palettes", label: "Bibliothèque", icon: "books" },
  { section: "atelier", href: "#/atelier", label: "Atelier", icon: "flask" },
  { section: "exports", href: "#/exports", label: "Exports", icon: "export" },
];

export function buildNav(section: string, onSignOut: () => void): HTMLElement {
  const nav = h("nav", { class: "nav", "aria-label": "Sections" }, [h("span", { class: "wordmark", "aria-label": "DRD", text: "DRD" })]);
  for (const item of ITEMS) {
    const link = h("a", { class: "nav-item", href: item.href }, [icon(item.icon, 22), h("span", { text: item.label })]);
    if (item.section === section) link.setAttribute("aria-current", "page");
    nav.append(link);
  }
  const out = h("button", { type: "button", class: "nav-item nav-account", title: app.user?.email ?? "" }, [icon("sign-out", 20), h("span", { text: "Quitter" })]);
  out.addEventListener("click", async () => {
    await post("/api/auth/logout").catch(() => {});
    clearCache();
    onSignOut();
  });
  nav.append(h("span", { class: "nav-spacer" }), out);
  return nav;
}
