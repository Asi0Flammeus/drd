/**
 * App shell: session, routing, navigation, toast, offline state.
 *
 * Hash routing on purpose: the origin's path space belongs to the capture
 * splat (`dnd.alysis.cat/https://site.fr` means "capture this"), so the client
 * lives under `/app#/…` and the service worker has one navigation target.
 *
 * Routes (§6): #/captures, #/captures/:id/:tab, #/bibliotheque/:library,
 * #/items/:id, #/tableaux/:id, #/atelier, #/exports, #/exports/:id. The old
 * routes redirect once to their new homes.
 */

import "./styles/fonts.css";
import "./styles/preview.css";
import "./styles/drd.css";

import { ApiFailure, clearCache, get, reachability } from "./api";
import type { User } from "./api";
import { app } from "./app";
import { h } from "./ui/controls";
import { icon } from "./ui/icons";
import { buildNav } from "./ui/nav";
import { buildAnalyse } from "./views/analyse";
import { buildAtelier } from "./views/atelier";
import { buildAuth } from "./views/auth";
import { buildBoard, buildItemPage, buildLibrary } from "./views/bibliotheque";
import { buildCaptures, startCapture } from "./views/captures";
import { buildExport, buildExports } from "./views/exports";

/**
 * The signed-in identity, mirrored so an offline start knows whose cache it is
 * showing. No credential: the session cookie is HttpOnly and never visible here.
 */
const SESSION_MIRROR = "drd.session.v1";

const remember = (user: User | null) => {
  try {
    if (user) localStorage.setItem(SESSION_MIRROR, JSON.stringify(user));
    else localStorage.removeItem(SESSION_MIRROR);
  } catch {
    /* private mode: online still works */
  }
};

const remembered = (): User | null => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SESSION_MIRROR) ?? "null");
    return parsed && typeof parsed === "object" && "id" in parsed && "email" in parsed ? (parsed as User) : null;
  } catch {
    return null;
  }
};

const REDIRECTS: Record<string, string> = {
  inbox: "#/captures",
  discovery: "#/captures",
  collections: "#/bibliotheque/tableaux",
  packs: "#/exports",
  playground: "#/atelier",
};

type Route = { section: string; parts: string[]; query: URLSearchParams };

function route(): Route {
  const raw = location.hash.replace(/^#\/?/, "") || "captures";
  const [path, search] = raw.split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  return { section: parts[0] ?? "captures", parts: parts.slice(1), query: new URLSearchParams(search ?? "") };
}

const root = document.getElementById("app");
if (!root) throw new Error("#app missing");
const shell = h("div", { class: "app" });
const toastHost = h("div", { class: "toast-host", "aria-live": "polite" });
const offline = h("div", { class: "offline", role: "status" }, [icon("wifi-slash", 18), h("span", { text: "Hors ligne · lecture du cache. Garder et modifier attendent le retour du réseau." })]);
root.append(shell, toastHost);

app.toast = (message, action) => {
  const toast = h("div", { class: "toast", role: "status" }, [h("span", { text: message })]);
  if (action) {
    const button = h("button", { type: "button", class: "link-btn", text: action.label });
    button.addEventListener("click", () => {
      toast.remove();
      action.run();
    });
    toast.append(button);
  }
  toastHost.querySelectorAll(".toast").forEach((old) => old.remove());
  toastHost.append(toast);
  window.setTimeout(() => toast.remove(), action ? 5000 : 2200);
};

function paintConnection(): void {
  offline.classList.toggle("is-live", !app.online());
  window.dispatchEvent(new Event("drd:connection"));
}
reachability.changed = paintConnection;
window.addEventListener("online", paintConnection);
window.addEventListener("offline", paintConnection);

function view(r: Route): HTMLElement {
  switch (r.section) {
    case "captures":
      return r.parts[0] ? buildAnalyse(r.parts[0], r.parts[1] ?? "palette") : buildCaptures(r.query);
    case "bibliotheque":
      return buildLibrary(r.parts[0] ?? "palettes", r.query);
    case "items":
      return buildItemPage(r.parts[0] ?? "");
    case "tableaux":
      return r.parts[0] ? buildBoard(r.parts[0]) : buildLibrary("tableaux", r.query);
    case "atelier":
      return buildAtelier(r.parts[0] ?? null);
    case "exports":
      return r.parts[0] ? buildExport(r.parts[0]) : buildExports(r.query);
    default:
      return buildCaptures(r.query);
  }
}

const NAV_SECTION: Record<string, string> = { captures: "captures", bibliotheque: "bibliotheque", items: "bibliotheque", tableaux: "bibliotheque", atelier: "atelier", exports: "exports" };

function signOut(): void {
  app.user = null;
  remember(null);
  clearCache();
  app.go("#/login");
}

function render(): void {
  // A sheet belongs to the screen that opened it: a route change closes it.
  for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) dialog.close();
  const r = route();
  const redirect = REDIRECTS[r.section];
  if (redirect) {
    location.replace(redirect);
    return;
  }
  if (!app.user) {
    shell.classList.add("is-auth");
    const next = r.query.get("next");
    shell.replaceChildren(
      buildAuth(r.section === "register" ? "register" : "login", next, async (user) => {
        app.user = user;
        remember(user);
        if (next) {
          try {
            const id = await startCapture(next);
            app.go(`#/captures/${id}/palette`);
            return;
          } catch (error) {
            app.toast(error instanceof Error ? error.message : "Capture impossible");
          }
        }
        app.go("#/captures");
      }, (to) => app.go(to)),
    );
    return;
  }
  if (r.section === "login" || r.section === "register") {
    app.go("#/captures");
    return;
  }
  shell.classList.remove("is-auth");
  const main = h("main", { class: "main" }, [offline, view(r)]);
  shell.replaceChildren(buildNav(NAV_SECTION[r.section] ?? "captures", signOut), main);
  paintConnection();
  window.scrollTo({ top: 0 });
}

window.addEventListener("hashchange", () => {
  const swap = () => render();
  // A crossfade between screens, when the browser has it and motion is welcome.
  const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
  if (doc.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) doc.startViewTransition(swap);
  else swap();
});

void (async () => {
  try {
    const { data } = await get<{ user: User }>("/api/me", { cache: false });
    app.user = data.user;
    remember(data.user);
  } catch (error) {
    // Unreachable is not signed out: the cache is still readable.
    app.user = error instanceof ApiFailure && error.offline ? remembered() : null;
  }
  render();
})();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
