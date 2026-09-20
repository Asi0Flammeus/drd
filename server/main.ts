/**
 * The process: one HTTP server, one SQLite file, one queue, one headless
 * browser at a time.
 *
 * Route order is the design. API first, then media, then the built client,
 * then the splat — because the splat is a catch-all that turns any unmatched
 * path into "capture this URL", and a catch-all placed too early eats the app.
 */

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync } from "node:fs";
import { SESSION_COOKIE, purgeExpiredSessions, userForToken } from "./auth.ts";
import { config, isProduction } from "./config.ts";
import { migrate } from "./db.ts";
import {
  HttpError,
  assertSameOrigin,
  json,
  matchRoute,
  parseCookies,
  redirect,
  securityHeaders,
  serveFile,
} from "./http.ts";
import type { Route } from "./http.ts";
import { authRoutes } from "./routes/auth.ts";
import { captureRoutes, startCapture } from "./routes/captures.ts";
import { libraryRoutes } from "./routes/library.ts";
import { discoveryRoutes } from "./routes/discovery.ts";
import { packRoutes } from "./routes/packs.ts";
import { assistantRoutes } from "./routes/assistant.ts";
import { parseUserUrl } from "./capture/url-guard.ts";

const routes: Route[] = [
  ...authRoutes,
  ...captureRoutes,
  ...libraryRoutes,
  ...discoveryRoutes,
  ...packRoutes,
  ...assistantRoutes,
];

/** Paths the client owns. Everything else is a candidate URL to capture. */
const APP_PATHS = ["/", "/app", "/index.html", "/manifest.webmanifest", "/sw.js"];
const APP_PREFIXES = ["/assets/", "/fonts/", "/icons/"];

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = req.method ?? "GET";
  securityHeaders(res);

  if (method !== "GET" && method !== "HEAD") assertSameOrigin(req);

  const match = matchRoute(routes, method, url.pathname);
  if (match) {
    const user = match.route.auth ? userForToken(parseCookies(req.headers.cookie)[SESSION_COOKIE]) : null;
    if (match.route.auth && !user) throw new HttpError(401, "unauthenticated", "Connectez-vous.");
    await match.route.handler({
      req,
      res,
      url,
      params: match.params,
      user: user ?? { id: "", email: "" },
    });
    return;
  }

  if (url.pathname.startsWith("/api/")) throw new HttpError(404, "no_route", "Endpoint inconnu.");

  // Static client. `/assets/*` is content-hashed by Vite, so it may be
  // immutable; index.html and the worker never are.
  if (APP_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    if (serveFile(res, config.clientDir, url.pathname, true)) return;
  }
  if (APP_PATHS.includes(url.pathname)) {
    const file = url.pathname === "/" || url.pathname === "/app" ? "/index.html" : url.pathname;
    if (serveFile(res, config.clientDir, file, false)) return;
    json(res, 503, {
      error: "client_not_built",
      message: "Client non compilé. Lancez `npm run build`, ou `npm run dev` pour le serveur de développement Vite.",
    });
    return;
  }

  if (method === "GET") {
    await splat(req, res, url);
    return;
  }
  throw new HttpError(404, "no_route", "Page inconnue.");
}

/**
 * `drd.example/{url}` — the whole point of the domain.
 *
 * It is a GET with a side effect, which is a CSRF shape, so the Fetch
 * Metadata headers decide. Two rules, both measured against a real Chrome
 * rather than assumed:
 *
 *   - `Sec-Fetch-Site: cross-site` is refused outright. That is the forgery
 *     vector: another origin embedding or fetching this URL in the victim's
 *     browser.
 *   - A `Sec-Fetch-Dest` that names a subresource (image, script, iframe…)
 *     is refused. `document` is the address bar; `empty` is what Chrome sends
 *     when our own service worker re-issues the navigation, so it is allowed
 *     and is already covered by the same-site rule above.
 *
 * Clients that send no Fetch Metadata at all — curl, a share-sheet script —
 * are accepted: nothing about them can be forged through a victim's browser.
 */
const SUBRESOURCE_DESTS = [
  "image", "script", "style", "font", "iframe", "frame", "object", "embed",
  "audio", "video", "track", "manifest", "worker", "sharedworker", "serviceworker", "report",
];

async function splat(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const raw = url.pathname.replace(/^\//, "") + url.search;
  const target = parseUserUrl(raw);
  if (!target) {
    redirect(res, "/app#/inbox?error=url-illisible");
    return;
  }

  const dest = req.headers["sec-fetch-dest"];
  if (typeof dest === "string" && SUBRESOURCE_DESTS.includes(dest)) {
    throw new HttpError(403, "not_navigation", "Cette adresse ne s'ouvre que par navigation directe.");
  }
  const site = req.headers["sec-fetch-site"];
  if (site === "cross-site") {
    throw new HttpError(403, "cross_site", "Cette adresse ne peut pas être déclenchée depuis un autre site.");
  }

  const user = userForToken(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  if (!user) {
    // Keep the intent across the login round-trip; the client replays it.
    redirect(res, `/app#/login?next=${encodeURIComponent(target.toString())}`);
    return;
  }

  try {
    const capture = await startCapture(user.id, target.toString());
    redirect(res, `/app#/captures/${capture.id}`);
  } catch (error) {
    const message = error instanceof HttpError ? error.message : "Capture impossible.";
    redirect(res, `/app#/inbox?error=${encodeURIComponent(message)}`);
  }
}

function start(): void {
  mkdirSync(config.mediaDir, { recursive: true });
  const applied = migrate();
  if (applied.applied.length) console.log(`[drd] migrations applied: ${applied.applied.join(", ")}`);
  purgeExpiredSessions();
  setInterval(purgeExpiredSessions, 6 * 3600_000).unref();

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof HttpError) {
        json(res, error.status, { error: error.code, message: error.message });
        return;
      }
      console.error("[drd] unhandled", error);
      json(res, 500, { error: "internal", message: "Erreur interne." });
    });
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 120_000;
  server.listen(config.port, config.host, () => {
    console.log(`[drd] http://${config.host}:${config.port}  data=${config.dataDir}  ${isProduction() ? "production" : "development"}`);
  });
}

start();
