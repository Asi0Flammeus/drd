/**
 * Every knob the server has, resolved once from the environment.
 *
 * Defaults are the ones a laptop needs to run the whole thing with no .env at
 * all; the caps are the ones a public capture endpoint needs to survive being
 * pointed at a hostile page. Nothing here reads a secret file, and nothing is
 * logged.
 */

import { resolve } from "node:path";

function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number, got ${JSON.stringify(raw)}`);
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

const dataDir = resolve(str("DRD_DATA_DIR", "./data"));

export const config = {
  host: str("DRD_HOST", "127.0.0.1"),
  port: num("DRD_PORT", 5178),
  /** Absolute origin the app is reached at. Drives secure cookies and the origin check. */
  publicOrigin: str("DRD_PUBLIC_ORIGIN", "").replace(/\/$/, ""),
  dataDir,
  dbPath: resolve(dataDir, "drd.sqlite"),
  mediaDir: resolve(dataDir, "media"),
  clientDir: resolve(str("DRD_CLIENT_DIR", "./dist/client")),

  registrationOpen: bool("DRD_REGISTRATION_OPEN", true),
  /** When set, registration also requires this code. Not a secret in the security sense — a doorbell. */
  inviteCode: str("DRD_INVITE_CODE", ""),
  sessionTtlDays: num("DRD_SESSION_TTL_DAYS", 30),

  capture: {
    /** Hard ceiling on one capture, navigation plus extraction plus screenshots. */
    timeoutMs: num("DRD_CAPTURE_TIMEOUT_MS", 60_000),
    navigationTimeoutMs: num("DRD_CAPTURE_NAV_TIMEOUT_MS", 25_000),
    maxBytes: num("DRD_CAPTURE_MAX_BYTES", 30_000_000),
    maxRequests: num("DRD_CAPTURE_MAX_REQUESTS", 400),
    maxRedirects: num("DRD_CAPTURE_MAX_REDIRECTS", 5),
    maxPageHeight: num("DRD_CAPTURE_MAX_HEIGHT", 12_000),
    maxElements: num("DRD_CAPTURE_MAX_ELEMENTS", 140),
    maxCrops: num("DRD_CAPTURE_MAX_CROPS", 28),
    viewportWidth: num("DRD_CAPTURE_VIEWPORT_WIDTH", 1280),
    viewportHeight: num("DRD_CAPTURE_VIEWPORT_HEIGHT", 900),
    concurrency: num("DRD_CAPTURE_CONCURRENCY", 1),
    perUserPerHour: num("DRD_CAPTURE_PER_USER_PER_HOUR", 60),
    chromePath: str("DRD_CHROME_PATH", ""),
    noSandbox: bool("DRD_CHROME_NO_SANDBOX", false),
    /**
     * Off in every deployment. On only to capture a fixture served from
     * 127.0.0.1 while developing the pipeline itself.
     */
    allowPrivateNetwork: bool("DRD_ALLOW_PRIVATE_NETWORK", false),
    allowedPorts: str("DRD_CAPTURE_ALLOWED_PORTS", "80,443")
      .split(",")
      .map((p) => Number(p.trim()))
      .filter((p) => Number.isInteger(p) && p > 0),
    userAgent: str(
      "DRD_CAPTURE_USER_AGENT",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 DRD/0.1 (+https://github.com/Asi0Flammeus/drd)",
    ),
  },

  /** Optional conversational layer. Export never reads this. */
  llm: {
    endpoint: str("DRD_LLM_ENDPOINT", ""),
    model: str("DRD_LLM_MODEL", ""),
    apiKey: str("DRD_LLM_API_KEY", ""),
  },
} as const;

export function llmConfigured(): boolean {
  return config.llm.endpoint !== "" && config.llm.model !== "";
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
