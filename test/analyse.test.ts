/**
 * `analyse` at its interface, on two fixture pages captured by the real
 * pipeline: a light serif site and a dark sans site. Asserts what a user
 * reads (roles, the fitted scale, the cards found), not how it is computed.
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { FIXTURE_PORT, serveFixtures } from "./fixtures/serve.ts";

const dataDir = mkdtempSync(join(tmpdir(), "drd-analyse-test-"));
process.env.DRD_DATA_DIR = dataDir;
process.env.DRD_ALLOW_PRIVATE_NETWORK = "1";
process.env.DRD_CAPTURE_ALLOWED_PORTS = String(FIXTURE_PORT);

let server: Server;
before(async () => {
  server = await serveFixtures();
});
after(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function findingsOf(page: string) {
  // Dynamic on purpose: `config.ts` reads the environment once at import.
  const { db, migrate } = await import("../server/db.ts");
  const { requestCapture, waitForCapture } = await import("../server/capture/runner.ts");
  const { loadInput } = await import("../server/analyse/load.ts");
  const { analyse } = await import("../server/analyse/index.ts");
  migrate();
  db().prepare("INSERT OR IGNORE INTO users (id, email, password_hash, created_at) VALUES ('u1', 't@drd.local', 'x', ?)").run(new Date().toISOString());
  const { id } = requestCapture("u1", `http://127.0.0.1:${FIXTURE_PORT}/${page}`);
  assert.equal(await waitForCapture(id, 110_000), "ready");
  const row = db().prepare("SELECT * FROM captures WHERE id = ?").get(id) as { final_url: string; finished_at: string; width: number; height: number; meta: string };
  return analyse(await loadInput({ dir: join(dataDir, "media", id), url: row.final_url, finishedAt: row.finished_at, width: row.width, height: row.height, meta: row.meta, elements: [] }));
}

type Palette = { colors: { key: string | null; hex: string }[]; theme: string };

test("light serif fixture: warm fond, teal accent, a failing sand button, three cards", { timeout: 150_000 }, async () => {
  const findings = await findingsOf("light-serif.html");
  const palette = findings.find((f) => f.kind === "palette" && f.subkind === "interface")?.data as Palette;
  const role = (key: string) => palette.colors.find((c) => c.key === key)?.hex;
  assert.equal(palette.theme, "light");
  assert.ok(["#f7f4ec", "#ffffff"].includes(role("background") ?? ""), `fond ${role("background")}`);
  assert.equal(role("accent"), "#1f6f73");
  const pairs = (findings[0].data as { pairs: { bg: string; grade: string }[] }).pairs;
  assert.ok(pairs.some((p) => p.bg === "#c9b48c" && p.grade === "fail"), "white on sand must be reported as a failure");
  const cards = findings.filter((f) => f.kind === "component" && f.subkind === "card");
  assert.equal(cards.reduce((n, f) => n + (f.data as { count: number }).count, 0), 3);
  const families = findings.filter((f) => f.kind === "type" && f.subkind === "family").map((f) => (f.data as { generic: string }).generic);
  assert.ok(families.includes("serif") && families.includes("sans-serif"));
});

test("dark sans fixture: dark fond, lime accent, the 1.25 scale, four cards", { timeout: 150_000 }, async () => {
  const findings = await findingsOf("dark-sans.html");
  const palette = findings.find((f) => f.kind === "palette" && f.subkind === "interface")?.data as Palette;
  assert.equal(palette.theme, "dark");
  assert.equal(palette.colors.find((c) => c.key === "background")?.hex, "#0b0c0e");
  assert.equal(palette.colors.find((c) => c.key === "accent")?.hex, "#d4f53c");
  const scale = findings.find((f) => f.kind === "type" && f.subkind === "scale")?.data as { body: number; ratio: number | null };
  assert.equal(scale.body, 16);
  assert.equal(scale.ratio, 1.25);
  const cards = findings.filter((f) => f.kind === "component" && f.subkind === "card");
  assert.equal(cards.reduce((n, f) => n + (f.data as { count: number }).count, 0), 4);
});
