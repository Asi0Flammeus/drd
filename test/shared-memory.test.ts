/**
 * Where Chrome's shared memory lands decides how large a page can be
 * photographed. In the compose deployment it landed on a 256 MB /tmp next to
 * the Chrome profile while a 512 MB /dev/shm sat unused, and an image-heavy
 * page (mamielasagnes.fr, 1280×10208) failed with "Unable to capture
 * screenshot". The capacities below are the three real deployment shapes.
 */

import { strict as assert } from "node:assert";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { sharedMemoryIgnoredDefaults } from "../server/capture/shared-memory.ts";

const MB = 1024 * 1024;
const sizes = (devShm: number, tmp: number) => (path: string) => (path === "/dev/shm" ? devShm : path === tmpdir() ? tmp : 0);

test("compose: shared memory goes to the larger /dev/shm, off the /tmp that holds the profile", () => {
  assert.deepEqual(sharedMemoryIgnoredDefaults(sizes(512 * MB, 256 * MB)), ["--disable-dev-shm-usage"]);
});

test("plain docker run: Docker's 64 MB /dev/shm keeps Puppeteer's flag, shared memory stays in the temp dir", () => {
  assert.deepEqual(sharedMemoryIgnoredDefaults(sizes(64 * MB, 50_000 * MB)), []);
});

test("no /dev/shm at all: the temp dir is the only home", () => {
  assert.deepEqual(sharedMemoryIgnoredDefaults(sizes(0, 256 * MB)), []);
});
