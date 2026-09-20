/**
 * The export archive. A pack is the product; if two exports of the same rows
 * differ in bytes, nobody can diff, cache or trust one, and if an entry's CRC
 * is wrong the archive opens empty in the one place it matters — someone
 * else's machine.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { zip } from "../server/export/zip.ts";

function entriesOf(archive: Buffer): { name: string; content: Buffer }[] {
  const out: { name: string; content: Buffer }[] = [];
  let offset = 0;
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    const body = archive.subarray(start, start + compressedSize);
    out.push({ name, content: method === 8 ? inflateRawSync(body) : Buffer.from(body) });
    offset = start + compressedSize;
  }
  return out;
}

test("entries round-trip through the archive", () => {
  const readme = Buffer.from("# Pack\n\nPourquoi : le contraste porte la hiérarchie.\n", "utf8");
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const archive = zip([
    { name: "README.md", data: readme },
    { name: "images/01-carte.png", data: image },
  ]);

  const parsed = entriesOf(archive);
  assert.deepEqual(parsed.map((entry) => entry.name), ["README.md", "images/01-carte.png"]);
  assert.equal(parsed[0].content.toString("utf8"), readme.toString("utf8"));
  assert.deepEqual([...parsed[1].content], [...image]);
  // End-of-central-directory, so a reader knows the archive is complete.
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
  assert.equal(archive.readUInt16LE(archive.length - 12), 2);
});

test("the same pack exports byte-identical archives", () => {
  const build = () =>
    zip([
      { name: "prompt.md", data: Buffer.from("Croiser, ne pas décalquer.", "utf8") },
      { name: "tokens.css", data: Buffer.from(":root { --drd-accent: #1d6f6a; }", "utf8") },
    ]);
  assert.equal(build().equals(build()), true, "timestamps or ordering leaked into the bytes");
});
