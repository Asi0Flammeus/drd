import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import sharp from "sharp";

const dataDir = mkdtempSync(join(tmpdir(), "drd-image-test-"));
process.env.DRD_DATA_DIR = dataDir;
after(() => rmSync(dataDir, { recursive: true, force: true }));

type Reply = {
  status: number;
  headers: Record<string, string>;
  chunks?: Buffer[];
};

const response = (status: number, headers: Record<string, string>, chunks: Buffer[] = []): Reply => ({ status, headers, chunks });

async function imageBytes(): Promise<Buffer> {
  return sharp({
    create: { width: 40, height: 30, channels: 3, background: "#1d6f6a" },
  })
    .composite([
      { input: await sharp({ create: { width: 20, height: 15, channels: 3, background: "#f2a93b" } }).png().toBuffer(), left: 0, top: 0 },
      { input: await sharp({ create: { width: 20, height: 15, channels: 3, background: "#d9d2c3" } }).png().toBuffer(), left: 20, top: 15 },
    ])
    .png()
    .toBuffer();
}

test("safe image fetch follows guarded redirects and distinguishes pages", async () => {
  const { fetchImageResource } = await import("../server/image/fetch.ts");
  const png = await imageBytes();
  const seen: string[] = [];
  const guard = async (input: string | URL) => {
    const url = input instanceof URL ? input : new URL(input);
    seen.push(url.toString());
    if (url.hostname === "private.invalid") return { ok: false as const, code: "private_address" as const, message: "private" };
    return { ok: true as const, url, address: "93.184.216.34", family: 4 as const };
  };
  const transport = async (url: URL): Promise<Reply> => {
    if (url.pathname === "/start") return response(302, { location: "/photo" });
    if (url.pathname === "/private") return response(302, { location: "http://private.invalid/secret" });
    if (url.pathname === "/page") return response(200, { "content-type": "text/html" }, [Buffer.from("<h1>page</h1>")]);
    return response(200, { "content-type": "image/png", "content-length": String(png.length) }, [png]);
  };

  const image = await fetchImageResource("https://example.com/start", { guard, transport });
  assert.equal(image.kind, "image");
  assert.equal(image.kind === "image" && image.width, 40);
  assert.deepEqual(seen, ["https://example.com/start", "https://example.com/photo"]);

  const page = await fetchImageResource("https://example.com/page", { guard, transport });
  assert.equal(page.kind, "page");

  await assert.rejects(
    fetchImageResource("https://example.com/private", { guard, transport }),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "private_address"),
  );
});

test("safe image fetch rejects spoofed, oversized and decompression bomb responses", async () => {
  const { fetchImageResource } = await import("../server/image/fetch.ts");
  const guard = async (input: string | URL) => {
    const url = input instanceof URL ? input : new URL(input);
    return { ok: true as const, url, address: "93.184.216.34", family: 4 as const };
  };
  const run = (reply: Reply, limits: { maxBytes?: number; maxPixels?: number } = {}) =>
    fetchImageResource("https://example.com/photo", { guard, transport: async () => reply, ...limits });

  await assert.rejects(
    run(response(200, { "content-type": "image/png" }, [Buffer.from("<html>not an image</html>")])),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "invalid_image"),
  );
  await assert.rejects(
    run(response(200, { "content-type": "image/png", "content-length": "101" }), { maxBytes: 100 }),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "image_too_large"),
  );
  const bomb = await sharp({ create: { width: 100, height: 100, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(
    run(response(200, { "content-type": "image/png" }, [bomb]), { maxPixels: 1_000 }),
    (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "image_dimensions"),
  );
});

test("image originals are content addressed, idempotent and keep three persisted palettes", async () => {
  const { db, migrate } = await import("../server/db.ts");
  const { blobPath } = await import("../server/library/blobs.ts");
  const { persistImageReference } = await import("../server/image/index.ts");
  migrate();
  db().prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES ('image-u1', 'image@drd.local', 'x', ?)").run(new Date().toISOString());
  const bytes = await imageBytes();
  const source = {
    kind: "image" as const,
    bytes,
    mime: "image/png",
    width: 40,
    height: 30,
    format: "png",
    finalUrl: new URL("https://images.example/photo?id=1"),
  };

  const first = await persistImageReference("image-u1", source, { originatingPageUrl: "https://example.com/gallery" });
  const second = await persistImageReference("image-u1", source, { originatingPageUrl: "https://example.com/gallery" });
  assert.equal(first.already, false);
  assert.equal(second.already, true);
  assert.equal(second.item.id, first.item.id);
  assert.equal(readFileSync(blobPath(first.item.cover ?? "")).equals(bytes), true);
  assert.equal(first.item.signature, createHash("sha256").update(bytes).digest("hex"));
  const data = first.item.data as { palettes: { intent: string; colors: { hex: string }[] }[]; extractorVersion: string; width: number; height: number };
  assert.deepEqual(data.palettes.map((palette) => palette.intent), ["dominant", "vibrant", "muted"]);
  assert.ok(data.palettes.every((palette) => palette.colors.length >= 3));
  assert.equal(data.width, 40);
  assert.equal(data.height, 30);
});

test("uncertain tags can be accepted, rejected and edited without changing the original", async () => {
  const { db } = await import("../server/db.ts");
  const { blobPath } = await import("../server/library/blobs.ts");
  const { completeDerivative, createDerivative, failDerivative, getImageItem, reviewImageTag, retryDerivative, setImageTagAnalysis } = await import("../server/image/index.ts");
  const original = db().prepare("SELECT id, cover FROM items WHERE user_id = 'image-u1' AND subkind = 'image-original'").get() as { id: string; cover: string };
  const before = readFileSync(blobPath(original.cover));
  setImageTagAnalysis("image-u1", original.id, {
    status: "ready",
    vision: { model: "vision-test", version: "2026-10-14", evidence: "A warm geometric still life." },
    jev: { model: "jev-test", version: "2026-10-14" },
    candidates: [
      { tag: "geometric", probability: 0.91, status: "suggested", evidence: "Angular blocks." },
      { tag: "warm", probability: 0.58, status: "suggested", evidence: "Orange region." },
      { tag: "other / insufficient evidence", probability: 0.2, status: "suggested", evidence: "Bounded fallback." },
    ],
  });
  reviewImageTag("image-u1", original.id, "geometric", "accepted");
  reviewImageTag("image-u1", original.id, "warm", "rejected");
  reviewImageTag("image-u1", original.id, "other / insufficient evidence", "edited", "editorial");
  const reviewed = getImageItem("image-u1", original.id);
  assert.deepEqual(reviewed.tags, ["editorial", "geometric"]);

  const pending = createDerivative("image-u1", original.id, "Keep the composition, change the season to winter.", "image-test");
  failDerivative("image-u1", pending.item.id, "temporary model failure");
  const retried = retryDerivative("image-u1", pending.item.id);
  assert.equal(retried.item.id, pending.item.id);
  const childBytes = await sharp(before).tint("#b9d8ee").png().toBuffer();
  await completeDerivative("image-u1", pending.item.id, childBytes, "image/png", 40, 30, "image-test-v1");
  const completeRetry = retryDerivative("image-u1", pending.item.id);
  assert.equal(completeRetry.already, true);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM items WHERE user_id = 'image-u1' AND subkind = 'image-derivative'").get()?.n, 1);
  assert.equal(readFileSync(blobPath(original.cover)).equals(before), true);
  const child = getImageItem("image-u1", pending.item.id);
  const childData = child.data as { generation: { status: string; parentId: string; prompt: string; model: string; version: string } };
  assert.equal(childData.generation.status, "complete");
  assert.equal(childData.generation.parentId, original.id);
  assert.equal(child.provenance.generated, true);
});

test("nested boards and packs retain original and generated image lineage", async () => {
  // Dynamic imports keep DRD_DATA_DIR set before config.ts is evaluated.
  const { db } = await import("../server/db.ts");
  const { addToBoard, createBoard, getBoard, itemsByIds } = await import("../server/library/index.ts");
  const { buildPack } = await import("../server/export/pack.ts");
  const original = db().prepare("SELECT id FROM items WHERE user_id = 'image-u1' AND subkind = 'image-original'").get() as { id: string };
  const derivative = db().prepare("SELECT id FROM items WHERE user_id = 'image-u1' AND subkind = 'image-derivative'").get() as { id: string };
  const parent = createBoard("image-u1", { name: "Client" });
  const nested = createBoard("image-u1", { name: "Moodboard campagne", parentId: parent.id });
  addToBoard("image-u1", nested.id, [derivative.id]);
  assert.equal(nested.parentId, parent.id);
  assert.equal(nested.path, "Client › Moodboard campagne");
  assert.deepEqual(getBoard("image-u1", nested.id).items.map((item) => item.id), [derivative.id]);

  const items = itemsByIds("image-u1", [original.id, derivative.id]);
  const built = buildPack({ id: "image-pack", name: "Images", brief: "Use the evidence.", createdAt: "2026-10-14T12:00:00.000Z" }, items, ["brief"]);
  const manifestEntry = built.entries.find((entry) => entry.name === "pack.json");
  assert.ok(manifestEntry);
  const manifest = JSON.parse(manifestEntry.data.toString("utf8")) as { items: { id: string; mediaClass: string; provenance: { parentId?: string }; data: { palettes: unknown[] } }[] };
  const originalEntry = manifest.items.find((item) => item.id === original.id);
  const derivativeEntry = manifest.items.find((item) => item.id === derivative.id);
  assert.equal(originalEntry?.mediaClass, "captured-original");
  assert.equal(derivativeEntry?.mediaClass, "generated-derivative");
  assert.equal(derivativeEntry?.provenance.parentId, original.id);
  assert.equal(originalEntry?.data.palettes.length, 3);
  assert.equal(derivativeEntry?.data.palettes.length, 3);
});
