/**
 * `/healthz` — for a container orchestrator, not for a human.
 *
 * It answers the three questions that decide whether this process can do its
 * job: is the database readable at the schema this build expects, is there a
 * browser binary to capture with, and was the client actually built into the
 * image. Anything that is only true "usually" is not health, so the endpoint
 * checks them rather than reporting a constant.
 *
 * It is unauthenticated, so it exposes no user data: aggregate queue depth
 * and booleans only, never an email, a URL or a count of anyone's references.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer";
import { config } from "../config.ts";
import { db } from "../db.ts";
import { json } from "../http.ts";
import type { Route } from "../http.ts";

const startedAt = Date.now();

function chromeExecutable(): string | null {
  if (config.capture.chromePath) return existsSync(config.capture.chromePath) ? config.capture.chromePath : null;
  try {
    const bundled = puppeteer.executablePath();
    return existsSync(bundled) ? bundled : null;
  } catch {
    return null;
  }
}

export const healthRoutes: Route[] = [
  {
    method: "GET",
    path: "/healthz",
    auth: false,
    handler({ res }) {
      let schema: number | null = null;
      let queued: number | null = null;
      try {
        const row = db().prepare("SELECT MAX(id) AS id FROM schema_migrations").get() as { id: number | null };
        schema = row.id;
        const pending = db()
          .prepare("SELECT COUNT(*) AS n FROM captures WHERE status IN ('pending', 'running')")
          .get() as { n: number };
        queued = Number(pending.n);
      } catch {
        schema = null;
      }

      const executable = chromeExecutable();
      const clientBuilt = existsSync(join(config.clientDir, "index.html"));
      const ok = schema !== null && executable !== null && clientBuilt;

      json(res, ok ? 200 : 503, {
        status: ok ? "ok" : "degraded",
        schema,
        database: schema !== null ? "ok" : "unreadable",
        // The path is a deployment fact, not a secret, and it is the first
        // thing anyone debugging a failed capture in a container wants.
        capture: { browser: executable === null ? "missing" : "ready", executable, queued, sandbox: config.capture.noSandbox ? "disabled" : "enabled" },
        client: clientBuilt ? "built" : "missing",
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      });
    },
  },
];
