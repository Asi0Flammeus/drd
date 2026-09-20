/**
 * The client half of the contract with the server, plus the offline mirror.
 *
 * The server is the source of truth for everything that matters — accounts,
 * collections, references, captures. localStorage holds a snapshot of the last
 * successful read so the app opens and *reads* on a train; it is never merged
 * back, never written to as if it were the database, and always labelled stale
 * in the UI. An offline cache that pretends to be a database is how people
 * lose work.
 */

export type ApiError = { error: string; message: string; status: number };

export class ApiFailure extends Error {
  code: string;
  status: number;
  offline: boolean;
  constructor(message: string, code: string, status: number, offline = false) {
    super(message);
    this.code = code;
    this.status = status;
    this.offline = offline;
  }
}

const CACHE_KEY = "drd.cache.v1";

type CacheShape = Record<string, { at: string; body: unknown }>;

function readCache(): CacheShape {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as CacheShape) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: CacheShape): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* Quota: the app still works online. */
  }
}

export function cachedAt(path: string): string | null {
  return readCache()[path]?.at ?? null;
}

export function clearCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * Whether the server answered the last request at all.
 *
 * `navigator.onLine` is not this: it reports a link, not reachability, and it
 * lies behind a captive portal and under device emulation. Measured: Chrome's
 * offline emulation left `navigator.onLine === true` while every fetch threw.
 * So the banner and the read-only mode key off what actually happened.
 */
export const reachability = { online: true, changed: (): void => {} };

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    if (reachability.online) {
      reachability.online = false;
      reachability.changed();
    }
    throw new ApiFailure("Réseau indisponible.", "offline", 0, true);
  }
  if (!reachability.online) {
    reachability.online = true;
    reachability.changed();
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    let code = "error";
    let message = `Erreur ${response.status}.`;
    if (payload && typeof payload === "object") {
      if ("error" in payload && typeof payload.error === "string") code = payload.error;
      if ("message" in payload && typeof payload.message === "string") message = payload.message;
    }
    throw new ApiFailure(message, code, response.status);
  }
  return payload as T;
}

/** GET with the offline mirror: a failed network read falls back to the last good body. */
export async function get<T>(path: string, options: { cache?: boolean } = {}): Promise<{ data: T; stale: boolean }> {
  const useCache = options.cache !== false;
  try {
    const data = await request<T>("GET", path);
    if (useCache) {
      const cache = readCache();
      cache[path] = { at: new Date().toISOString(), body: data };
      writeCache(cache);
    }
    return { data, stale: false };
  } catch (error) {
    const offline = error instanceof ApiFailure && error.offline;
    if (offline && useCache) {
      const hit = readCache()[path];
      if (hit) return { data: hit.body as T, stale: true };
    }
    throw error;
  }
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("POST", path, body ?? {});
}

export function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>("PATCH", path, body);
}

export function del<T>(path: string): Promise<T> {
  return request<T>("DELETE", path);
}

/* --------------------------------------------------------- resources ----- */

export type User = { id: string; email: string };

export type Collection = {
  id: string;
  parentId: string | null;
  name: string;
  kind: string;
  position: number;
  count: number;
  createdAt: string;
};

export type Ref = {
  id: string;
  collectionId: string | null;
  type: "site" | "component" | "font" | "palette" | "image";
  title: string;
  captureId: string | null;
  elementId: string | null;
  sourceUrl: string | null;
  sourceHost: string | null;
  image: string | null;
  payload: Record<string, unknown>;
  provenance: Record<string, unknown>;
  what: string;
  why: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type CaptureSummary = {
  id: string;
  requestedUrl: string;
  finalUrl: string | null;
  host: string;
  title: string | null;
  description: string | null;
  status: "pending" | "running" | "ready" | "failed";
  error: string | null;
  width: number | null;
  height: number | null;
  screenshot: string | null;
  meta: {
    meta?: Record<string, string>;
    fonts?: { family: string; count: number; sizes: number[]; weights: string[]; sample: string }[];
    colors?: { hex: string; count: number; role: string }[];
    page?: { width: number; height: number };
    budget?: { bytes: number; requests: number; blocked: number };
  };
  createdAt: string;
  finishedAt: string | null;
};

export type CaptureElement = {
  id: string;
  ordinal: number;
  tag: string;
  selector: string;
  label: string;
  guess: string;
  box: { x: number; y: number; width: number; height: number };
  text: string | null;
  styles: Record<string, string>;
  crop: string | null;
};

export type CaptureLink = {
  href: string;
  host: string;
  anchor: string | null;
  rel: string | null;
  inFooter: number;
  creditLike: number;
};

export type Candidate = {
  id: string;
  url: string;
  host: string;
  score: number;
  reasons: string[];
  provider: string;
  fromCapture: string | null;
  state: string;
  createdAt: string;
};

export type Pack = {
  id: string;
  name: string;
  brief: string;
  refIds: string[];
  sources: string[];
  refCount: number;
  createdAt: string;
};
