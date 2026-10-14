/**
 * Serves the fixture pages on 127.0.0.1 so the real capture pipeline can
 * shoot them. Committed proofs and recorded artifacts only ever come from
 * these pages: the repository is public, captured third-party pages are not.
 */

import { createServer } from "node:http";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL(".", import.meta.url));
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".jpg": "image/jpeg" };

export const FIXTURE_PORT = 47831;

export function serveFixtures(port = FIXTURE_PORT): Promise<Server> {
  const server = createServer((req, res) => {
    const name = (req.url ?? "/").split("?")[0].replace(/^\/+/, "") || "light-serif.html";
    if (!/^[\w-]+\.(html|jpg)$/.test(name)) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = readFileSync(join(DIR, name));
      res.writeHead(200, { "content-type": TYPES[extname(name)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  const { promise, resolve } = Promise.withResolvers<Server>();
  server.listen(port, "127.0.0.1", () => resolve(server));
  return promise;
}
