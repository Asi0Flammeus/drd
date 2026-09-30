/**
 * Migration 3 loses nothing (§9.3). It moves every reference the user ever
 * annotated into the new model and drops the old tables in the same
 * transaction: a bug here deletes the one thing the app exists to keep.
 */

import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "drd-migration-test-"));
process.env.DRD_DATA_DIR = dataDir;
after(() => rmSync(dataDir, { recursive: true, force: true }));

test("references, collections and packs survive migration 3 with the same ids", async () => {
  // Dynamic on purpose: `config.ts` reads DRD_DATA_DIR once at import.
  const { db, migrate } = await import("../server/db.ts");
  const { blobPath } = await import("../server/library/blobs.ts");
  const { getItem, itemsByIds, search } = await import("../server/library/index.ts");

  migrate(2);
  const c = db();
  const now = "2026-09-20T10:00:00.000Z";
  c.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'a@drd.local', 'x', ?)").run(now);
  c.prepare("INSERT INTO captures (id, user_id, requested_url, final_url, host, title, status, screenshot, meta, created_at, finished_at) VALUES ('cap1', 'u1', 'https://linear.app/', 'https://linear.app/', 'linear.app', 'Linear', 'ready', 'page.jpg', '{}', ?, ?)").run(now, now);
  mkdirSync(join(dataDir, "media", "cap1"), { recursive: true });
  const pageBytes = Buffer.from("fake-jpeg-bytes-page");
  const cropBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  writeFileSync(join(dataDir, "media", "cap1", "page.jpg"), pageBytes);
  writeFileSync(join(dataDir, "media", "cap1", "el-0.png"), cropBytes);

  const insertCollection = c.prepare("INSERT INTO collections (id, user_id, parent_id, name, kind, position, created_at) VALUES (?, 'u1', ?, ?, ?, 0, ?)");
  insertCollection.run("inbox", null, "Boîte de réception", "inbox", now);
  insertCollection.run("clients", null, "Clients", "folder", now);
  insertCollection.run("instituts", "clients", "Instituts", "folder", now);

  const insertRef = c.prepare(
    `INSERT INTO refs (id, user_id, collection_id, type, title, capture_id, source_url, source_host, image, payload, provenance, what, why, tags, created_at, updated_at)
     VALUES (?, 'u1', ?, ?, ?, 'cap1', 'https://linear.app/', 'linear.app', ?, ?, '{"savedAt":"2026-09-20"}', ?, ?, ?, ?, ?)`,
  );
  insertRef.run("r-site", "inbox", "site", "Page Linear", "cap1/page.jpg", "{}", "", "Tout le site", '["sombre"]', "2026-09-20T10:01:00Z", now);
  insertRef.run("r-comp", "instituts", "component", "Bouton lime", "cap1/el-0.png", '{"styles":{"backgroundColor":"rgb(228, 242, 34)"}}', "bouton plein", "tient au doigt", '["Bouton", "lime"]', "2026-09-20T10:02:00Z", now);
  insertRef.run("r-font", "clients", "font", "Typos Linear", "cap1/page.jpg", '{"fonts":[{"family":"Inter Variable","count":40,"sample":"((e,t,n)=>{let c=document"}]}', "", "", "[]", "2026-09-20T10:03:00Z", now);
  insertRef.run("r-pal", "instituts", "palette", "Palette Linear", "cap1/page.jpg", '{"colors":[{"hex":"#08090a","count":13,"role":"text"},{"hex":"#e4f222","count":2,"role":"background"}]}', "", "sombre maîtrisé", '["sombre maîtrisé"]', "2026-09-20T10:04:00Z", now);
  insertRef.run("r-img", null, "image", "Photo absente", "cap1/gone.jpg", "{}", "", "la lumière", "[]", "2026-09-20T10:05:00Z", now);
  c.prepare("INSERT INTO packs (id, user_id, name, brief, ref_ids, created_at) VALUES ('p1', 'u1', 'Pack', '', ?, ?)").run(JSON.stringify(["r-site", "r-comp", "r-pal"]), now);

  const result = migrate();
  assert.deepEqual(result.applied, [3]);

  // Same ids, mapped kinds, the reason and tags untouched.
  const items = c.prepare("SELECT id, kind, why, what FROM items ORDER BY id").all() as { id: string; kind: string; why: string; what: string }[];
  assert.deepEqual(items.map((i) => [i.id, i.kind]), [["r-comp", "component"], ["r-font", "type"], ["r-img", "mood"], ["r-pal", "palette"], ["r-site", "page"]]);
  assert.equal(items.find((i) => i.id === "r-comp")?.why, "tient au doigt");
  assert.equal(items.find((i) => i.id === "r-comp")?.what, "bouton plein");
  assert.deepEqual(getItem("u1", "r-comp").tags, ["bouton", "lime"]);

  // The picture is the item's own now, byte for byte; a missing one is not fatal.
  const comp = getItem("u1", "r-comp");
  assert.ok(comp.cover);
  assert.deepEqual(readFileSync(blobPath(comp.cover)), cropBytes);
  assert.equal(getItem("u1", "r-img").cover, null);

  // Collections became flat boards named by their path; the inbox became no board.
  const boards = c.prepare("SELECT b.name, bi.item_id FROM boards b JOIN board_items bi ON bi.board_id = b.id ORDER BY b.name, bi.item_id").all() as { name: string; item_id: string }[];
  assert.deepEqual(boards.map((b) => [b.name, b.item_id]), [["Clients", "r-font"], ["Clients › Instituts", "r-comp"], ["Clients › Instituts", "r-pal"]]);
  assert.deepEqual(getItem("u1", "r-site").boards, []);

  // The pack still resolves every item it named.
  const pack = c.prepare("SELECT item_ids FROM packs WHERE id = 'p1'").get() as { item_ids: string };
  assert.deepEqual(itemsByIds("u1", JSON.parse(pack.item_ids)).map((i) => i.id).sort(), ["r-comp", "r-pal", "r-site"]);

  // Payloads in the new shape: OKLCH computed, roles as given; the script "sample" gone (W5).
  const palette = getItem("u1", "r-pal").data as { colors: { hex: string; role: string; value: { l: number } }[] };
  assert.deepEqual(palette.colors.map((col) => [col.hex, col.role]), [["#08090a", "text"], ["#e4f222", "background"]]);
  assert.ok(palette.colors[1].value.l > 0.9);
  assert.equal(JSON.stringify(getItem("u1", "r-font").data).includes("document"), false);

  // Old tables are gone; search and the colour index see the migrated rows.
  const tables = (c.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
  assert.equal(tables.includes("refs"), false);
  assert.equal(tables.includes("collections"), false);
  assert.deepEqual(search("u1", { q: "maitrise" }).items.map((i) => i.id), ["r-pal"]);
  assert.deepEqual(search("u1", { color: "#e4f222" }).items.map((i) => i.id), ["r-pal"]);
});
