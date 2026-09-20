/**
 * The HTTP layer: a route table, request/response helpers, static files.
 *
 * `node:http` is enough for this shape of app — a dozen JSON endpoints, one
 * static directory, one media directory and one catch-all. A framework would
 * add a dependency tree to the one process that also drives a headless browser,
 * which is exactly where a dependency tree is least welcome.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { config, isProduction } from "./config.ts";
import type { SessionUser } from "./auth.ts";

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  /** Present only inside routes declared `auth: true`. */
  user: SessionUser;
};

export type Route = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** `/api/captures/:id` — `:name` captures one path segment. */
  path: string;
  auth: boolean;
  handler: (ctx: Ctx) => Promise<void> | void;
};

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

const MAX_BODY_BYTES = 1_000_000;

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "body_too_large", "Requête trop volumineuse.");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {} as T;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "bad_json", "Corps de requête JSON invalide.");
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function setCookie(res: ServerResponse, name: string, value: string, maxAgeSeconds: number): void {
  const secure = config.publicOrigin.startsWith("https://") || isProduction();
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  appendHeader(res, "set-cookie", parts.join("; "));
}

export function clearCookie(res: ServerResponse, name: string): void {
  appendHeader(res, "set-cookie", `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function appendHeader(res: ServerResponse, name: string, value: string): void {
  const existing = res.getHeader(name);
  if (existing === undefined) res.setHeader(name, value);
  else if (Array.isArray(existing)) res.setHeader(name, [...existing, value]);
  else res.setHeader(name, [String(existing), value]);
}

/**
 * The app never embeds a captured page, never loads a third-party script and
 * never sends a cross-origin request, so the policy can be this narrow.
 * `img-src` allows blob: because the client renders element crops it has
 * fetched through the authenticated media route.
 */
export function securityHeaders(res: ServerResponse): void {
  res.setHeader(
    "content-security-policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'none'",
      "object-src 'none'",
    ].join("; "),
  );
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("cross-origin-opener-policy", "same-origin");
  res.setHeader("cross-origin-resource-policy", "same-origin");
  res.setHeader("permissions-policy", "geolocation=(), microphone=(), camera=(), interest-cohort=()");
}

/**
 * Cross-site request forgery: the session cookie is SameSite=Lax, so a
 * cross-site POST never carries it. This is the belt to that braces — a
 * mutating request must either come from our own origin or carry no Origin
 * header at all (curl, a native client).
 */
export function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowed = new Set<string>();
  if (config.publicOrigin) allowed.add(config.publicOrigin);
  const host = req.headers.host;
  if (host) {
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
  }
  if (!allowed.has(origin)) {
    throw new HttpError(403, "bad_origin", "Origine non autorisée.");
  }
}

export function matchRoute(routes: Route[], method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  const segments = pathname.split("/").filter(Boolean);
  for (const route of routes) {
    if (route.method !== method) continue;
    const routeSegments = route.path.split("/").filter(Boolean);
    if (routeSegments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < routeSegments.length; i += 1) {
      const expected = routeSegments[i];
      if (expected.startsWith(":")) params[expected.slice(1)] = decodeURIComponent(segments[i]);
      else if (expected !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".zip": "application/zip",
};

/**
 * Serves one file from `root`, refusing anything that escapes it. Returns
 * false when the path does not resolve to a readable file, so the caller can
 * fall through to the next handler rather than committing a 404 too early.
 */
export function serveFile(res: ServerResponse, root: string, relativePath: string, immutable = false): boolean {
  const safeRelative = normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const absolute = resolve(join(root, safeRelative));
  if (absolute !== root && !absolute.startsWith(root + sep)) return false;
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    return false;
  }
  if (!stats.isFile()) return false;
  const type = CONTENT_TYPES[extname(absolute).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "content-length": stats.size,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  createReadStream(absolute).pipe(res);
  return true;
}

export function redirect(res: ServerResponse, location: string, status = 302): void {
  res.writeHead(status, { location, "cache-control": "no-store" });
  res.end();
}
