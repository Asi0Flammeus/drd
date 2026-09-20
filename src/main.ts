/**
 * App shell.
 *
 * Hash routing on purpose: the origin's path space belongs to the capture
 * splat — `drd.example/https://site.fr` has to mean "capture this" — so the
 * client lives entirely under `/app#/…` and the service worker has exactly one
 * navigation target to cache.
 *
 * The rail carries five sections and collapses in every layout mode, which is
 * what makes the same build usable on a phone, on a Fold's inner screen, and
 * on a desktop.
 */

import "./styles/fonts.css";
import "./styles/app.css";
import "./styles/preview.css";
import "./styles/drd.css";

import { ApiFailure, clearCache, get, post, reachability } from "./api";
import type { User } from "./api";
import { loadWorkspace, saveWorkspace } from "./state";
import type { DimensionId, Workspace } from "./state";
import { h, icon, ICONS } from "./ui/controls";
import { loadCollections, store } from "./store";
import { buildAuthPanel } from "./views/auth";
import { buildCapturePanel, startCapture } from "./views/capture";
import { buildCollectionsPanel } from "./views/collections";
import { buildDiscoveryPanel } from "./views/discovery";
import { buildInboxPanel } from "./views/inbox";
import { buildPackPanel, buildPacksPanel } from "./views/packs";
import { buildColorPanel } from "./views/color";
import { buildComponentPanel } from "./views/components";
import { buildTypePanel } from "./views/type";
import type { Panel, ViewContext } from "./views/view";

/**
 * The signed-in identity, mirrored so an offline start knows whose cache it
 * is showing. It holds no credential and no token — the session cookie is
 * HttpOnly and never visible here — so the worst a stale entry can do is
 * render a cached view that the first successful request corrects.
 */
const SESSION_MIRROR = "drd.session.v1";

function rememberSession(user: User): void {
  try {
    localStorage.setItem(SESSION_MIRROR, JSON.stringify(user));
  } catch {
    /* Private mode: the app still works online. */
  }
}

function rememberedSession(): User | null {
  try {
    const raw = localStorage.getItem(SESSION_MIRROR);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "id" in parsed && "email" in parsed) {
      const { id, email } = parsed;
      if (typeof id === "string" && typeof email === "string") return { id, email };
    }
    return null;
  } catch {
    return null;
  }
}

function forgetSession(): void {
  try {
    localStorage.removeItem(SESSION_MIRROR);
  } catch {
    /* nothing to do */
  }
}

const SECTIONS: { route: string; label: string; blurb: string }[] = [
  { route: "#/inbox", label: "Capturer", blurb: "Une URL, une page mesurée." },
  { route: "#/collections", label: "Collections", blurb: "Ce que vous gardez, et pourquoi." },
  { route: "#/playground", label: "Playground", blurb: "Type, couleur, composants." },
  { route: "#/discovery", label: "Découverte", blurb: "Des pistes tirées de vos captures." },
  { route: "#/packs", label: "Packs", blurb: "Le brief à donner à un agent." },
];

const DIMENSIONS: { id: DimensionId; label: string }[] = [
  { id: "type", label: "Type" },
  { id: "color", label: "Couleur" },
  { id: "components", label: "Composants" },
];

const ws: Workspace = loadWorkspace();
const root = document.getElementById("app");
if (!root) throw new Error("#app missing");

const rail = h("nav", { class: "rail", "aria-label": "Sections" });
const work = h("main", { class: "workarea", id: "workarea" });
const layout = h("div", { class: "layout" }, [rail, work]);
const toastBox = h("div", { class: "toast", role: "status", "aria-live": "polite" });
const banner = h("div", { class: "offline-banner", role: "status" });

let panel: Panel | null = null;
let toastTimer = 0;
let session: User | null = null;

function toast(message: string): void {
  toastBox.textContent = message;
  toastBox.classList.add("is-live");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastBox.classList.remove("is-live"), 3000);
}

function go(route: string): void {
  if (location.hash === route) render();
  else location.hash = route;
}

const ctx: ViewContext = {
  ws,
  commit() {
    saveWorkspace(ws);
    panel?.sync();
  },
  rebuild() {
    saveWorkspace(ws);
    render();
  },
  go,
  toast,
};

type Route = { name: string; param: string | null; query: URLSearchParams };

function currentRoute(): Route {
  const raw = location.hash.replace(/^#/, "") || "/inbox";
  const [path, queryString] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  return {
    name: parts[0] ?? "inbox",
    param: parts[1] ?? null,
    query: new URLSearchParams(queryString ?? ""),
  };
}

function buildRail(route: Route): void {
  rail.replaceChildren();
  for (const section of SECTIONS) {
    const active = `#/${route.name}` === section.route;
    const button = h("button", {
      type: "button",
      class: `rail-item${active ? " is-current" : ""}`,
      "aria-current": active ? "true" : "false",
    }, [
      h("span", { class: "rail-label", text: section.label }),
      h("span", { class: "rail-blurb", text: section.blurb }),
    ]);
    button.addEventListener("click", () => go(section.route));
    rail.append(button);

    if (active && section.route === "#/playground") {
      const sub = h("div", { class: "rail-sub" });
      for (const dimension of DIMENSIONS) {
        const on = ws.dimension === dimension.id;
        const item = h("button", {
          type: "button",
          class: `rail-subitem${on ? " is-current" : ""}`,
          "aria-current": on ? "true" : "false",
          text: dimension.label,
        });
        item.addEventListener("click", () => {
          ws.dimension = dimension.id;
          ctx.rebuild();
        });
        sub.append(item);
      }
      rail.append(sub);
    }
  }

  const account = h("button", { type: "button", class: "rail-foot-button" }, [
    h("span", { class: "rail-label", text: session?.email ?? "Compte" }),
    h("span", { class: "rail-blurb", text: "Se déconnecter" }),
  ]);
  account.addEventListener("click", async () => {
    await post("/api/auth/logout");
    clearCache();
    forgetSession();
    session = null;
    store.collections = [];
    go("#/login");
  });
  rail.append(account);
}

const host = { toast, go, rerender: () => render() };

function buildPanel(route: Route): HTMLElement {
  switch (route.name) {
    case "captures":
      return route.param
        ? buildCapturePanel(route.param, host)
        : buildInboxPanel(host, null);
    case "collections":
      return buildCollectionsPanel(route.param, host);
    case "discovery":
      return buildDiscoveryPanel(host);
    case "packs":
      return route.param ? buildPackPanel(route.param, host) : buildPacksPanel(host);
    case "playground": {
      panel = ws.dimension === "color" ? buildColorPanel(ctx) : ws.dimension === "components" ? buildComponentPanel(ctx) : buildTypePanel(ctx);
      return panel.el;
    }
    default:
      return buildInboxPanel(host, route.query.get("error"));
  }
}

function render(): void {
  const route = currentRoute();

  if (!session) {
    rail.replaceChildren();
    layout.classList.add("is-auth");
    const pending = route.query.get("next");
    const mode = route.name === "register" ? "register" : "login";
    work.replaceChildren(
      buildAuthPanel(mode, pending, async (user) => {
        session = user;
        rememberSession(user);
        layout.classList.remove("is-auth");
        await loadCollections();
        if (pending) {
          try {
            const id = await startCapture(pending);
            go(`#/captures/${id}`);
            return;
          } catch (error) {
            toast(error instanceof Error ? error.message : "Capture impossible");
          }
        }
        go("#/inbox");
      }, go),
    );
    return;
  }

  layout.classList.remove("is-auth");
  if (route.name !== "playground") panel = null;
  buildRail(route);
  work.replaceChildren(buildPanel(route));
  work.scrollTo({ top: 0 });
}

function buildHeader(): HTMLElement {
  const collapse = h("button", {
    type: "button",
    class: "icon-button",
    "aria-expanded": "true",
    "aria-controls": "workarea",
    title: "Replier la barre de sections",
  }, [icon(ICONS.chevron, 18)]);
  collapse.addEventListener("click", () => {
    const collapsed = layout.classList.toggle("toc-collapsed");
    collapse.setAttribute("aria-expanded", collapsed ? "false" : "true");
    collapse.title = collapsed ? "Afficher la barre de sections" : "Replier la barre de sections";
  });

  return h("header", { class: "topbar" }, [
    collapse,
    h("div", { class: "brand" }, [
      h("span", { class: "brand-name", text: "DRD" }),
      h("span", { class: "brand-sub", text: "design research & development — capturer, annoter, exporter" }),
    ]),
  ]);
}

function paintConnection(): void {
  const offline = !reachability.online || !navigator.onLine;
  banner.textContent = offline
    ? "Hors ligne — lecture du cache local. Rien ne sera enregistré tant que la connexion n'est pas revenue."
    : "";
  banner.classList.toggle("is-live", offline);
}

window.addEventListener("hashchange", render);
window.addEventListener("online", paintConnection);
window.addEventListener("offline", paintConnection);
reachability.changed = paintConnection;

root.append(buildHeader(), banner, layout, toastBox);
paintConnection();

void (async () => {
  try {
    const { data } = await get<{ user: User }>("/api/me", { cache: false });
    session = data.user;
    rememberSession(data.user);
    await loadCollections();
  } catch (error) {
    // Unreachable server is not a logout. The account is still valid, the
    // cached collections are still readable, and throwing the user back to a
    // login form they cannot submit would be the app deleting itself.
    session = error instanceof ApiFailure && error.offline ? rememberedSession() : null;
    if (session) {
      try {
        await loadCollections();
      } catch {
        /* Cached tree or none; the views render either way. */
      }
    } else {
      forgetSession();
    }
  }
  paintConnection();
  render();
})();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* Offline support is a bonus on an unsupported host, not a hard failure. */
    });
  });
}
