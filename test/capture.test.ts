/**
 * The capture pipeline on a real Chrome, against a local fixture whose
 * sections only appear when scrolled into view. Version 1 shot that kind of
 * page with a blank band where the unrevealed content was (W2) and re-shot
 * crops inside the band, so they came out as flat colour (W3). Both are
 * pinned here at the level a user sees: pixels.
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import sharp from "sharp";
import { FIXTURE_PORT, serveFixtures } from "./fixtures/serve.ts";
import type { Server } from "node:http";
import type { CaptureArtifacts } from "../server/capture/artifacts.ts";

const dataDir = mkdtempSync(join(tmpdir(), "drd-capture-test-"));
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

async function uniform(image: sharp.Sharp): Promise<boolean> {
  // `stats()` reads the pipeline's input, not its output: materialise the crop first.
  const stats = await sharp(await image.png().toBuffer()).stats();
  return stats.channels.slice(0, 3).every((channel) => channel.stdev < 1.5);
}

test("a scroll-revealed page is captured whole, and every component crop shows something", { timeout: 120_000 }, async () => {
  // Dynamic on purpose: `config.ts` reads the environment once at import, and
  // static imports would run before the data dir and fixture port are set.
  const { db, migrate } = await import("../server/db.ts");
  const { requestCapture, waitForCapture } = await import("../server/capture/runner.ts");
  migrate();
  db().prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'test@drd.local', 'x', ?)").run(new Date().toISOString());

  const { id } = requestCapture("u1", `http://127.0.0.1:${FIXTURE_PORT}/light-serif.html`);
  assert.equal(await waitForCapture(id, 110_000), "ready", JSON.stringify(db().prepare("SELECT error FROM captures WHERE id = ?").get(id)));

  const dir = join(dataDir, "media", id);
  const artifacts = JSON.parse(readFileSync(join(dir, "artifacts.json"), "utf8")) as CaptureArtifacts;
  const page = join(dir, "page.jpg");

  // Every revealed heading and paragraph is painted in the stitched page.
  const late = artifacts.dom.runs.filter((run) => run.box.y > artifacts.page.viewportHeight);
  assert.ok(late.length >= 8, `expected text below the first screen, got ${late.length} runs`);
  for (const run of late) {
    const region = sharp(page).extract({ left: run.box.x, top: run.box.y, width: Math.max(8, run.box.width), height: Math.max(8, run.box.height) });
    assert.equal(await uniform(region), false, `blank where « ${run.text} » should be (y = ${run.box.y})`);
  }

  // Every detected component has a crop, and no crop is a flat band.
  assert.ok(artifacts.dom.components.length >= 6);
  for (const component of artifacts.dom.components) {
    const crop = artifacts.media.crops[component.id];
    assert.ok(crop, `no crop for ${component.kind} « ${component.name} »`);
    assert.equal(await uniform(sharp(join(dir, crop.file))), false, `flat crop for ${component.kind} « ${component.name} »`);
  }

  // Font samples are the page's own text, never script source (W5).
  assert.ok(artifacts.dom.runs.every((run) => !/IntersectionObserver|classList|=>/.test(run.text)));
});
