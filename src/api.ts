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
  /** The whole error body, for answers that carry more than a message (409 "already captured"). */
  payload: Record<string, unknown>;
  constructor(message: string, code: string, status: number, offline = false, payload: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.offline = offline;
    this.payload = payload;
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
    throw new ApiFailure(message, code, response.status, false, payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {});
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

export type Box = { x: number; y: number; width: number; height: number };

export type CaptureSummary = {
  id: string;
  requestedUrl: string;
  finalUrl: string | null;
  host: string;
  title: string | null;
  siteName: string;
  description: string | null;
  status: "pending" | "running" | "ready" | "failed";
  stage: "load" | "scroll" | "measure" | "pixels" | "analyse" | "done" | null;
  retryOf: string | null;
  artifacts: number;
  error: string | null;
  width: number | null;
  height: number | null;
  screenshot: string | null;
  analysis: { id: string; version: number; status: "running" | "done" | "failed"; partial: boolean; error: string | null; finishedAt: string | null } | null;
  counts: { colors: number; styles: number; components: number } | null;
  createdAt: string;
  finishedAt: string | null;
};

export type Confidence = "sure" | "probable" | "check";
export type Evidence = { origin: string; note: string };

export type Oklch = { l: number; c: number; h: number };

export type PaletteColor = {
  role: string;
  key: string | null;
  value: Oklch;
  hex: string;
  share: number;
  textShare: number;
  usedOn: string[];
  declaredAs?: string;
  origins: string[];
  confidence: Confidence;
  evidence: Evidence[];
  locations: Box[];
};

export type ContrastPair = { fg: string; bg: string; label: string; wcag: number; grade: "AAA" | "AA" | "AA large" | "fail"; where: string; share: number };

export type PaletteData = { colors: PaletteColor[]; pairs: ContrastPair[]; others: { value: Oklch; hex: string; share: number; origins: string[] }[]; theme: "light" | "dark"; legacy?: boolean };

export type TextStyle = {
  family: string;
  declared: string;
  size: number;
  lineHeight: number;
  lineRatio: number;
  tracking: number;
  weight: number;
  transform: string;
  italic: boolean;
  role: string;
  share: number;
  sample: string;
  crop: string | null;
  locations: Box[];
  runs: number;
  origin: string;
};

export type TypeScaleData = { body: number; ratio: number | null; ratioName: string | null; error: number | null; verdict: string; steps: { size: number; n: number | null; lineHeight: number; role: string }[]; styles: TextStyle[]; families: string[] };

export type TypeFamilyData = {
  family: string;
  declared: string[];
  generic: string;
  display: boolean;
  weights: number[];
  italic: boolean;
  variation: string[];
  source: { label: string; host: string | null; licence: string };
  mismatch: { declared: string; rendered: string } | null;
  specimens: { weight: number; italic: boolean; file: string }[];
  fontFiles: { file: string; weight: string; style: string }[];
  share: number;
  roles: string[];
  bodySize: number | null;
};

export type TypePairData = {
  display: { family: string; generic: string; size: number; weight: number; crop: string | null };
  text: { family: string; generic: string; size: number; weight: number; crop: string | null };
};

export type ColorRef = { hex: string; role: string | null };

export type ComponentData = {
  kind: string;
  kindLabel: string;
  label: string;
  count: number;
  tokens: {
    background: ColorRef | null;
    foreground: ColorRef | null;
    border: { width: number; style: string; color: ColorRef | null } | null;
    radius: number[];
    padding: number[];
    height: number;
    width: number;
    gap: number;
    font: { family: string; size: number; weight: number; lineHeight: number | null; letterSpacing: number; transform: string };
    shadow: string | null;
    transition: { duration: string; easing: string; property: string } | null;
  };
  hover: { changes: { property: string; from: string; to: string }[]; crop: string | null } | null;
  css: string;
  dhash: string | null;
  crop?: string;
};

export type SpacingData = { base: number; steps: number[]; explained: number; contentWidth: number | null; columns: number | null; values: { value: number; count: number }[] };
export type RadiusData = { system: string; rule: string; byKind: { kind: string; kindLabel: string; values: number[] }[] };
export type ElevationData = { shadows: { value: string; blur: number; count: number }[] };

export type MoodData = {
  images: { box: Box; palette: string[]; meanL: number; meanC: number; meanB: number; stdL: number; distinct: number; nature: string; crop: string | null }[];
  palette: { hex: string; value: Oklch; share: number }[];
  descriptors: { name: string; word: string; value: number; unit: string }[];
  density: { share: number; word: string };
  nature: string | null;
};

export type PageData = { url: string; title: string; description: string; lang: string; siteName: string; themeColor: string; favicon: string; generator: string; width: number; height: number; darkScheme: boolean; capturedAt: string; partial: boolean };

export type Finding = {
  id: string;
  kind: "palette" | "color" | "type" | "component" | "scale" | "mood" | "page";
  subkind: string | null;
  title: string;
  confidence: Confidence;
  evidence: Evidence[];
  data: unknown;
  media: string[];
  locations: Box[];
  signature: string | null;
};

export type CaptureDetail = {
  capture: CaptureSummary;
  findings: Finding[];
  kept: Record<string, string>;
  attempts: { id: string; status: string; error: string | null; created_at: string }[];
  analysisVersion: number;
};

export type Library = "palettes" | "typos" | "composants" | "ambiances";

export type Item = {
  id: string;
  kind: Finding["kind"];
  subkind: string | null;
  library: Library;
  title: string;
  why: string;
  what: string;
  tags: string[];
  data: unknown;
  media: string[];
  cover: string | null;
  captureId: string | null;
  findingId: string | null;
  sourceUrl: string | null;
  sourceHost: string | null;
  confidence: Confidence | null;
  signature: string | null;
  provenance: Record<string, unknown>;
  boards: { id: string; name: string }[];
  createdAt: string;
  updatedAt: string;
  match?: { hex: string; distance: number };
  neighbours?: Neighbour[];
};

export type Neighbour = { id: string; title: string; kind: string; library: Library };

export type KeepResult = { item: Item; already: boolean; neighbours: Neighbour[] };

export type SearchResult = {
  items: Item[];
  counts: { libraries: Record<Library | "tableaux", number>; noReason: number; total: number };
  facets: { hosts: string[]; tags: string[]; componentKinds: string[] };
  mode: "all" | "any" | "none";
};

export type Board = { id: string; name: string; description: string; count: number; covers: string[]; kinds: string[]; usedAt: string | null; createdAt: string };

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

export type ExportPack = {
  id: string;
  name: string;
  brief: string;
  itemIds: string[];
  formats: string[];
  source: string;
  sources: string[];
  itemCount: number;
  createdAt: string;
};

export type ExportPreview = { warnings: { level: "refuse" | "warn"; message: string }[]; files: { name: string; bytes: number }[]; sources: string[]; itemCount: number };

/**
 * A media reference to a URL: `blob:<hash>` is an item's own copy, a bare
 * file name belongs to the capture it came from.
 */
export function mediaUrl(ref: string | null | undefined, captureId?: string | null): string | null {
  if (!ref) return null;
  if (ref.startsWith("blob:")) return `/blobs/${ref.slice(5)}`;
  if (/^[0-9a-f]{64}$/.test(ref)) return `/blobs/${ref}`;
  return captureId ? `/media/${captureId}/${ref}` : null;
}
