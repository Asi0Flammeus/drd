/**
 * The capture pipeline: a vetted URL in, artifacts on disk out.
 *
 * Why a server-side browser at all — the boundary that shapes this whole app:
 * a cross-origin page in an iframe cannot be read from JavaScript. There is no
 * client-side trick that recovers an element's box or its computed font from
 * someone else's site. Either a browser we control loads the page and reports
 * geometry, or the feature does not exist. So one runs here, in the smallest,
 * most suspicious configuration that still renders a real page.
 *
 * Stages, each written to `captures.stage` so the client can show progress:
 *
 *   load     navigation behind the guard, network settles, fonts load
 *   scroll   reveal pass: viewport by viewport, 250 ms dwell, real motion
 *            (no reduced-motion emulation), so scroll-revealed content and
 *            lazy media exist before anything is measured
 *   measure  DOM pass (own text nodes only), CDP rendered fonts, stylesheet
 *            and font responses from the network
 *   pixels   tile pass at DPR 2: a settled screenshot per viewport, a 24 px
 *            grid of painted colour, crops cut from those same tiles for
 *            every component and text style fully in view; fixed layers are
 *            shot once then hidden; tiles stitched into page.jpg; hover and
 *            specimen passes
 *
 * The capture never re-shoots a region out of view: that is how version 1
 * produced blank crops (W2, W3).
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import type { Browser, HTTPRequest, HTTPResponse, Page } from "puppeteer";
import sharp from "sharp";
import { config } from "../config.ts";
import { db } from "../db.ts";
import { sharedMemoryIgnoredDefaults } from "./shared-memory.ts";
import { guardUrl, inspectUrl, isPrivateAddress, parseUserUrl } from "./url-guard.ts";
import { fontSource, isOflSource } from "./artifacts.ts";
import type { CaptureArtifacts, DomPass, HoverStyle } from "./artifacts.ts";

const EXTRACTOR = readFileSync(fileURLToPath(new URL("./extract.browser.js", import.meta.url)), "utf8").trim();

/** Device pixel ratio of every tile, crop and specimen. */
const DPR = 2;

export type CaptureStage = "load" | "scroll" | "measure" | "pixels" | "analyse" | "done";

/* ------------------------------------------------------------- queue ----- */

type Job = { captureId: string; url: string };

const pending: Job[] = [];
let running = 0;

/** Called after a capture is ready; the analysis job registers itself here (keeps capture free of analysis imports). */
let afterCapture: (captureId: string) => Promise<void> = async () => {};
export function onCaptureReady(hook: (captureId: string) => Promise<void>): void {
  afterCapture = hook;
}

export function enqueueCapture(captureId: string, url: string): void {
  pending.push({ captureId, url });
  drain();
}

function drain(): void {
  while (running < config.capture.concurrency && pending.length > 0) {
    const job = pending.shift();
    if (!job) return;
    running += 1;
    runCapture(job.captureId, job.url)
      .catch((error) => markFailed(job.captureId, String(error instanceof Error ? error.message : error)))
      .finally(() => {
        running -= 1;
        drain();
      });
  }
}

/** Waits for a capture to leave the `pending`/`running` state. Used by tests and the CLI. */
export async function waitForCapture(captureId: string, timeoutMs = config.capture.timeoutMs + 60_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = db().prepare("SELECT status FROM captures WHERE id = ?").get(captureId) as { status: string } | undefined;
    if (!row) return "missing";
    if (row.status === "ready" || row.status === "failed") return row.status;
    if (Date.now() > deadline) return "timeout";
    await sleep(250);
  }
}

/** Several call sites need the same pause; the executor form is the one thing Node still lacks a primitive for. */
function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function markFailed(captureId: string, message: string): void {
  db()
    .prepare("UPDATE captures SET status = 'failed', error = ?, finished_at = ? WHERE id = ?")
    .run(message.slice(0, 400), new Date().toISOString(), captureId);
}

function setStage(captureId: string, stage: CaptureStage): void {
  db().prepare("UPDATE captures SET stage = ? WHERE id = ?").run(stage, captureId);
}

/* ------------------------------------------------------------ chrome ----- */

async function launch(hostname: string, address: string): Promise<Browser> {
  const args = [
    "--disable-background-networking",
    "--disable-sync",
    "--disable-extensions",
    "--disable-default-apps",
    "--no-first-run",
    "--no-default-browser-check",
    "--mute-audio",
    // The address was vetted a moment ago; pin it so the name cannot resolve
    // somewhere else between the check and the connection (DNS rebinding).
    `--host-resolver-rules=MAP ${hostname} ${address},EXCLUDE localhost`,
  ];
  if (config.capture.noSandbox) args.push("--no-sandbox", "--disable-setuid-sandbox");
  return puppeteer.launch({
    headless: true,
    args,
    ignoreDefaultArgs: sharedMemoryIgnoredDefaults(),
    executablePath: config.capture.chromePath || undefined,
    protocolTimeout: config.capture.timeoutMs,
  });
}

/**
 * Per-request gate. Chrome resolves subresource hostnames itself, so this is
 * the layer that keeps a captured page from using our network position: wrong
 * protocol, wrong port, private literal address, or past the byte/request cap
 * and the request never leaves.
 */
function attachGuards(page: Page, state: { bytes: number; requests: number; blocked: number }): void {
  page.on("request", (request: HTTPRequest) => {
    if (request.isInterceptResolutionHandled()) return;
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      void request.abort("blockedbyclient");
      return;
    }
    if (url.protocol === "data:" || url.protocol === "blob:") {
      void request.continue();
      return;
    }
    state.requests += 1;
    const overBudget = state.requests > config.capture.maxRequests || state.bytes > config.capture.maxBytes;
    const badTarget = inspectUrl(url) !== null;
    const privateLiteral = !config.capture.allowPrivateNetwork && /^\d|^\[/.test(url.hostname) && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ""));
    if (overBudget || badTarget || privateLiteral) {
      state.blocked += 1;
      void request.abort("blockedbyclient");
      return;
    }
    void request.continue();
  });

  page.on("response", (response) => {
    const length = Number(response.headers()["content-length"] ?? 0);
    if (Number.isFinite(length)) state.bytes += length;
  });
}

/* ----------------------------------------------------------- network ----- */

type Recorded = {
  stylesheets: { url: string; text: string }[];
  fonts: { url: string; host: string; bytes: number; body: Buffer | null; mime: string }[];
  reads: Promise<unknown>[];
};

const MAX_STYLESHEET_TEXT = 3_000_000;
const MAX_FONT_FILE = 1_500_000;
const MAX_FONT_FILES = 16;

/** Font and stylesheet responses: font sources (§4.3) and the site's own token names (§4.1 step 5). */
function recordNetwork(page: Page, pageHost: string): Recorded {
  const recorded: Recorded = { stylesheets: [], fonts: [], reads: [] };
  let cssBytes = 0;
  let keptFonts = 0;
  page.on("response", (response: HTTPResponse) => {
    const type = response.request().resourceType();
    if (response.status() >= 300) return;
    let url: URL;
    try {
      url = new URL(response.url());
    } catch {
      return;
    }
    if (type === "stylesheet") {
      recorded.reads.push(
        response.text().then((text) => {
          if (cssBytes + text.length > MAX_STYLESHEET_TEXT) return;
          cssBytes += text.length;
          recorded.stylesheets.push({ url: url.toString(), text });
        }, () => {}),
      );
    } else if (type === "font") {
      const entry = { url: url.toString(), host: url.hostname, bytes: Number(response.headers()["content-length"] ?? 0) || 0, body: null as Buffer | null, mime: response.headers()["content-type"] ?? "" };
      recorded.fonts.push(entry);
      // Keep the file only for the OFL catalogues (open question 3, default:
      // files for Google Fonts and Fontshare, pictures only for the rest).
      if (isOflSource(fontSource(url.hostname, pageHost)) && keptFonts < MAX_FONT_FILES) {
        keptFonts += 1;
        recorded.reads.push(
          response.buffer().then((body) => {
            entry.bytes = body.length;
            if (body.length <= MAX_FONT_FILE) entry.body = body;
          }, () => {}),
        );
      }
    }
  });
  return recorded;
}

type FontFace = { family: string; weight: string; style: string; urls: string[] };

/** `@font-face` blocks of the stylesheets the page loaded, with their `src` URLs resolved. */
export function parseFontFaces(sheets: { url: string; text: string }[]): FontFace[] {
  const faces: FontFace[] = [];
  for (const sheet of sheets) {
    for (const block of sheet.text.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
      const body = block[1];
      const family = /font-family\s*:\s*([^;]+)/i.exec(body)?.[1]?.trim().replace(/^["']|["']$/g, "");
      if (!family) continue;
      const urls: string[] = [];
      for (const src of body.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
        try {
          urls.push(new URL(src[1], sheet.url).toString());
        } catch {
          /* unparseable src: skip */
        }
      }
      faces.push({
        family,
        weight: /font-weight\s*:\s*([^;]+)/i.exec(body)?.[1]?.trim() ?? "400",
        style: /font-style\s*:\s*([^;]+)/i.exec(body)?.[1]?.trim() ?? "normal",
        urls,
      });
    }
  }
  return faces;
}

/** Custom property names declared on `:root` or `html` in stylesheet text. */
export function rootPropertyNames(text: string): string[] {
  const names = new Set<string>();
  for (const block of text.matchAll(/(^|[}\s,])(:root|html)\b[^{]*\{([^}]*)\}/g)) {
    for (const decl of block[3].matchAll(/(--[\w-]+)\s*:/g)) names.add(decl[1]);
  }
  return [...names];
}

/* ----------------------------------------------------------- capture ----- */

type Extract = <T>(page: Page, mode: string, arg?: unknown) => Promise<T>;
const extract: Extract = (page, mode, arg) => page.evaluate(`(${EXTRACTOR})(${JSON.stringify(mode)}, ${JSON.stringify(arg ?? null)})`) as never;

export async function runCapture(captureId: string, requestedUrl: string): Promise<void> {
  const guard = await guardUrl(requestedUrl);
  if (!guard.ok) {
    markFailed(captureId, guard.message);
    return;
  }

  db().prepare("UPDATE captures SET status = 'running', stage = 'load' WHERE id = ?").run(captureId);

  const dir = join(config.mediaDir, captureId);
  mkdirSync(dir, { recursive: true });

  const state = { bytes: 0, requests: 0, blocked: 0 };
  let browser: Browser | null = null;
  const overallTimeout = captureDeadline(config.capture.timeoutMs);

  try {
    browser = await launch(guard.url.hostname, guard.address);
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    attachGuards(page, state);
    const network = recordNetwork(page, guard.url.hostname);
    await page.setUserAgent(config.capture.userAgent);
    await page.setViewport({
      width: config.capture.viewportWidth,
      height: config.capture.viewportHeight,
      deviceScaleFactor: DPR,
    });
    await page.setJavaScriptEnabled(true);
    page.setDefaultTimeout(config.capture.navigationTimeoutMs);
    // A captured page must never be able to hold the pipeline open with a dialog.
    page.on("dialog", (dialog) => void dialog.dismiss().catch(() => {}));

    const work = (async () => {
      const response = await page.goto(guard.url.toString(), {
        // `networkidle2` never fires on a page that keeps a socket or a video
        // stream open (nematis.com timed out at 25 s that way). Wait for the
        // document, then give the network a bounded chance to settle.
        waitUntil: "domcontentloaded",
        timeout: config.capture.navigationTimeoutMs,
      });
      if (!response) throw new Error("Aucune réponse du site.");
      const chain = response.request().redirectChain();
      if (chain.length > config.capture.maxRedirects) throw new Error(`Trop de redirections (${chain.length}).`);
      // Every hop, re-vetted: the first URL was checked before launch, the
      // rest are checked here against the same rules.
      for (const hop of [...chain.map((r) => r.url()), response.url()]) {
        const hopGuard = await guardUrl(hop);
        if (!hopGuard.ok) throw new Error(`Redirection refusée vers ${hop} — ${hopGuard.message}`);
      }
      const status = response.status();
      if (status >= 400) throw new Error(`Le site a répondu ${status}.`);
      await page.waitForNetworkIdle({ idleTime: 600, timeout: config.capture.settleTimeoutMs }).catch(() => {});
      await Promise.race([page.evaluate("document.fonts.ready.then(() => true)"), sleep(4000)]).catch(() => {});

      setStage(captureId, "scroll");
      await revealPass(page);

      setStage(captureId, "measure");
      await extract(page, "scrollTo", 0);
      await sleep(350);
      const dom = await extract<DomPass>(page, "dom");
      const rendered = await renderedFonts(page, dom.textStyles.map((style) => style.id));
      await Promise.race([Promise.allSettled(network.reads), sleep(5000)]);
      const names = new Set(dom.customProperties);
      for (const sheet of network.stylesheets) for (const name of rootPropertyNames(sheet.text)) names.add(name);
      const customProperties = names.size
        ? await extract<CaptureArtifacts["customProperties"]>(page, "resolveVars", [...names])
        : [];
      const darkScheme = dom.darkScheme || network.stylesheets.some((sheet) => /prefers-color-scheme\s*:\s*dark/i.test(sheet.text));

      setStage(captureId, "pixels");
      const tiles = await tilePass(page, dir, dom);
      const pageHeight = Math.min(tiles.height, config.capture.maxPageHeight);
      await stitch(dir, tiles.shots, dom.page.width, pageHeight);
      await fallbackCrops(dir, dom, tiles, pageHeight);
      // Tiles were only ever the material for page.jpg and the crops.
      for (const shot of tiles.shots) rmSync(join(dir, shot.file), { force: true });
      await extract(page, "showFixed");
      const hover = await hoverPass(page, dir, dom);
      const specimens = await specimenPass(page, dir, dom, rendered);
      const fonts = saveFontFiles(dir, network, guard.url.hostname);

      const { meta, page: pageSize, links, customProperties: _names, darkScheme: _dark, ...rest } = dom;
      const artifacts: CaptureArtifacts = {
        version: 2,
        url: response.url(),
        capturedAt: new Date().toISOString(),
        partial: false,
        page: { ...pageSize, height: pageHeight },
        meta,
        dom: rest,
        darkScheme,
        customProperties,
        samples: tiles.samples,
        fonts: { rendered, network: fonts },
        hover,
        media: { page: "page.jpg", crops: tiles.crops, typeCrops: tiles.typeCrops, specimens },
      };
      writeFileSync(join(dir, "artifacts.json"), JSON.stringify(artifacts));
      return { artifacts, links, finalUrl: new URL(response.url()) };
    })();

    const result = await Promise.race([work, overallTimeout.promise]);
    if (result === "timeout") throw new Error(`Capture interrompue après ${Math.round(config.capture.timeoutMs / 1000)} s.`);
    const { artifacts, links, finalUrl } = result as Awaited<typeof work>;
    persist(captureId, finalUrl, artifacts, links, state);
  } catch (error) {
    markFailed(captureId, error instanceof Error ? error.message : String(error));
    return;
  } finally {
    overallTimeout.cancel();
    await browser?.close().catch(() => {});
  }
  await afterCapture(captureId).catch((error) => console.error("[drd] analysis after capture", error));
}

/** A deadline the whole capture races against, cancellable so a fast page does not hold the process open. */
function captureDeadline(ms: number): { promise: Promise<"timeout">; cancel: () => void } {
  const { promise, resolve } = Promise.withResolvers<"timeout">();
  const handle = setTimeout(() => resolve("timeout"), ms);
  return { promise, cancel: () => clearTimeout(handle) };
}

/**
 * Scroll viewport by viewport with a 250 ms dwell and real motion, so
 * IntersectionObserver reveals fire and lazy media loads. Bounded by the page
 * height cap, so an infinite feed cannot win.
 */
async function revealPass(page: Page): Promise<void> {
  let y = 0;
  for (let stop = 0; stop < 40; stop += 1) {
    const at = await extract<{ y: number; height: number; viewport: number }>(page, "scrollTo", y);
    await sleep(250);
    const limit = Math.min(at.height, config.capture.maxPageHeight);
    if (at.y + at.viewport >= limit - 2) break;
    y = at.y + at.viewport;
  }
  // Give the last lazy images their chance before anything is measured.
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 3000 }).catch(() => {});
}

/** CDP `CSS.getPlatformFontsForNode`: which family really painted each text style (W6). */
async function renderedFonts(page: Page, styleIds: number[]): Promise<CaptureArtifacts["fonts"]["rendered"]> {
  const out: CaptureArtifacts["fonts"]["rendered"] = [];
  if (!styleIds.length) return out;
  const session = await page.createCDPSession();
  try {
    await session.send("DOM.enable");
    await session.send("CSS.enable");
    const { root } = await session.send("DOM.getDocument", { depth: 0 });
    for (const id of styleIds) {
      try {
        const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector: `[data-drd-t="${id}"]` });
        if (!nodeId) continue;
        const { fonts } = await session.send("CSS.getPlatformFontsForNode", { nodeId });
        out.push({
          style: id,
          families: fonts
            .map((font) => ({ family: font.familyName, glyphs: font.glyphCount, custom: Boolean(font.isCustomFont) }))
            .sort((a, b) => b.glyphs - a.glyphs),
        });
      } catch {
        // A node that relaid out of the tree between passes: that style simply has no CDP answer.
      }
    }
  } finally {
    await session.detach().catch(() => {});
  }
  return out;
}

type Shot = { y: number; file: string };
type TileResult = {
  shots: Shot[];
  height: number;
  samples: CaptureArtifacts["samples"];
  crops: CaptureArtifacts["media"]["crops"];
  typeCrops: CaptureArtifacts["media"]["typeCrops"];
};

const CONTEXT = 16;

/** Cuts a CSS-pixel box (plus context) out of a DPR-2 viewport screenshot, as WebP. */
async function cutFromTile(tile: Buffer, box: { x: number; y: number; width: number; height: number }, context: number, viewport: { width: number; height: number }): Promise<{ data: Buffer; uniform: boolean } | null> {
  const left = Math.max(0, Math.floor((box.x - context) * DPR));
  const top = Math.max(0, Math.floor((box.y - context) * DPR));
  const right = Math.min(viewport.width * DPR, Math.ceil((box.x + box.width + context) * DPR));
  const bottom = Math.min(viewport.height * DPR, Math.ceil((box.y + box.height + context) * DPR));
  if (right - left < 8 || bottom - top < 8) return null;
  let image = sharp(tile).extract({ left, top, width: right - left, height: bottom - top });
  if (bottom - top > 1600) image = image.resize({ height: 1600 });
  const data = await image.webp({ quality: 86 }).toBuffer();
  return { data, uniform: await isUniform(data) };
}

/** A crop whose every channel is flat is a blank band, not a component (W3). */
async function isUniform(data: Buffer): Promise<boolean> {
  const stats = await sharp(data).stats();
  return stats.channels.slice(0, 3).every((channel) => channel.stdev < 1.5);
}

/**
 * The pixel pass. Content is already revealed, so each stop is shot once,
 * settled, at DPR 2; the grid sample and every crop come from that same
 * frame. Fixed and sticky layers appear in the first tile only.
 */
async function tilePass(page: Page, dir: string, dom: DomPass): Promise<TileResult> {
  const viewport = { width: dom.page.viewportWidth, height: dom.page.viewportHeight };
  const result: TileResult = { shots: [], height: dom.page.height, samples: { bg: {}, img: 0, total: 0 }, crops: {}, typeCrops: {} };
  let y = 0;
  let sampledTo = 0;
  // Run backgrounds measured from the hit-test stack, once each, on the first screen that shows them.
  const measured = new Set<number>();
  for (let stop = 0; stop < 40; stop += 1) {
    const at = await extract<{ y: number; height: number; viewport: number }>(page, "scrollTo", y);
    await sleep(stop === 0 ? 300 : 160);
    let inview = await extract<{ kind: "c" | "t"; id: number; box: { x: number; y: number; width: number; height: number }; settled: boolean }[]>(page, "inview");
    if (inview.some((item) => !item.settled)) {
      await sleep(500);
      inview = await extract(page, "inview");
    }
    const tile = Buffer.from(await page.screenshot({ type: "png", optimizeForSpeed: true }));
    const file = `tile-${stop}.png`;
    writeFileSync(join(dir, file), tile);
    result.shots.push({ y: at.y, file });

    const points = dom.runs
      .map((run, index) => [index, Math.round(run.box.x + run.box.width / 2), Math.round(run.box.y + run.box.height / 2)] as const)
      .filter(([index, , cy]) => !measured.has(index) && cy >= at.y && cy < at.y + at.viewport);
    const sample = await extract<{ bg: Record<string, number>; img: number; total: number; at: Record<string, [string | null, boolean]> }>(page, "sample", { from: sampledTo, step: 24, points });
    for (const [index, [background, onImage]] of Object.entries(sample.at)) {
      const run = dom.runs[Number(index)];
      run.background = background;
      run.onImage = onImage;
      measured.add(Number(index));
    }
    for (const [rgb, n] of Object.entries(sample.bg)) result.samples.bg[rgb] = (result.samples.bg[rgb] ?? 0) + n;
    result.samples.img += sample.img;
    result.samples.total += sample.total;
    sampledTo = at.y + at.viewport;

    for (const item of inview) {
      if (!item.settled) continue;
      const target = item.kind === "c" ? result.crops : result.typeCrops;
      if (target[item.id]) continue;
      const cut = await cutFromTile(tile, item.box, item.kind === "c" ? CONTEXT : 6, viewport).catch(() => null);
      if (!cut || cut.uniform) continue;
      const name = `${item.kind === "c" ? "c" : "t"}-${item.id}.webp`;
      writeFileSync(join(dir, name), cut.data);
      target[item.id] = { file: name, scale: DPR };
    }

    if (stop === 0) await extract(page, "hideFixed");
    const limit = Math.min(at.height, config.capture.maxPageHeight);
    result.height = at.height;
    if (at.y + at.viewport >= limit - 2) break;
    y = at.y + at.viewport;
  }
  return result;
}

/** Tiles downscaled to CSS pixels and laid at their real scroll offsets. */
async function stitch(dir: string, shots: Shot[], width: number, height: number): Promise<void> {
  const layers: sharp.OverlayOptions[] = [];
  for (const shot of shots) {
    if (shot.y >= height) continue;
    const resized = await sharp(join(dir, shot.file)).resize({ width }).toBuffer();
    const meta = await sharp(resized).metadata();
    const visible = Math.min(meta.height ?? 0, height - shot.y);
    const input = visible < (meta.height ?? 0) ? await sharp(resized).extract({ left: 0, top: 0, width: meta.width ?? width, height: visible }).toBuffer() : resized;
    layers.push({ input, top: shot.y, left: 0 });
  }
  await sharp({ create: { width, height, channels: 3, background: "#ffffff" }, limitInputPixels: false })
    .composite(layers)
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(join(dir, "page.jpg"));
}

/**
 * Anything never fully in one viewport (a tall hero, a footer, a nav hidden
 * after the first tile) is cut from the stitched page at 1×. Components whose
 * crop is still blank are dropped by the analysis: every component has a crop.
 */
async function fallbackCrops(dir: string, dom: DomPass, tiles: TileResult, pageHeight: number): Promise<void> {
  const pagePath = join(dir, "page.jpg");
  const width = dom.page.width;
  const cut = async (box: { x: number; y: number; width: number; height: number }): Promise<Buffer | null> => {
    const left = Math.max(0, Math.floor(box.x - CONTEXT));
    const top = Math.max(0, Math.floor(box.y - CONTEXT));
    const right = Math.min(width, Math.ceil(box.x + box.width + CONTEXT));
    const bottom = Math.min(pageHeight, Math.ceil(box.y + box.height + CONTEXT));
    if (right - left < 8 || bottom - top < 8) return null;
    let image = sharp(pagePath, { limitInputPixels: false }).extract({ left, top, width: right - left, height: bottom - top });
    if (bottom - top > 1600) image = image.resize({ height: 1600 });
    const data = await image.webp({ quality: 86 }).toBuffer();
    return (await isUniform(data)) ? null : data;
  };
  for (const component of dom.components) {
    if (tiles.crops[component.id] || component.box.y >= pageHeight) continue;
    const data = await cut(component.box).catch(() => null);
    if (!data) continue;
    const name = `c-${component.id}.webp`;
    writeFileSync(join(dir, name), data);
    tiles.crops[component.id] = { file: name, scale: 1 };
  }
  for (const style of dom.textStyles) {
    if (tiles.typeCrops[style.id]) continue;
    const run = dom.runs[style.rep];
    if (!run || run.box.y >= pageHeight) continue;
    const data = await cut({ ...run.box, x: run.box.x + CONTEXT - 6, y: run.box.y + CONTEXT - 6, width: run.box.width - 2 * (CONTEXT - 6), height: run.box.height - 2 * (CONTEXT - 6) }).catch(() => null);
    if (!data) continue;
    const name = `t-${style.id}.webp`;
    writeFileSync(join(dir, name), data);
    tiles.typeCrops[style.id] = { file: name, scale: 1 };
  }
}

const HOVER_KEYS: (keyof HoverStyle)[] = ["background", "color", "borderColor", "boxShadow", "transform", "textDecoration", "opacity"];

/** Up to six buttons and six link-buttons: hover, re-read, crop again (§4.1 step 6). */
async function hoverPass(page: Page, dir: string, dom: DomPass): Promise<CaptureArtifacts["hover"]> {
  const out: CaptureArtifacts["hover"] = [];
  const targets = [
    ...dom.components.filter((c) => c.kind === "button").slice(0, 6),
    ...dom.components.filter((c) => c.kind === "link-button").slice(0, 6),
  ];
  const viewport = { width: dom.page.viewportWidth, height: dom.page.viewportHeight };
  for (const target of targets) {
    try {
      const selector = `[data-drd-c="${target.id}"]`;
      await page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "center", behavior: "instant" })`);
      await page.mouse.move(1, 1);
      await sleep(120);
      const before = await extract<(HoverStyle & { box: { x: number; y: number; width: number; height: number } }) | null>(page, "hoverStyle", target.id);
      if (!before) continue;
      await page.hover(selector);
      await sleep(380);
      const after = await extract<(HoverStyle & { box: { x: number; y: number; width: number; height: number } }) | null>(page, "hoverStyle", target.id);
      if (!after) continue;
      const changed = HOVER_KEYS.some((k) => before[k] !== after[k]);
      let file: string | null = null;
      if (changed) {
        const tile = Buffer.from(await page.screenshot({ type: "png", optimizeForSpeed: true }));
        const cut = await cutFromTile(tile, after.box, CONTEXT, viewport);
        if (cut && !cut.uniform) {
          file = `h-${target.id}.webp`;
          writeFileSync(join(dir, file), cut.data);
        }
      }
      const { box: _b, ...beforeStyle } = before;
      const { box: _a, ...afterStyle } = after;
      out.push({ id: target.id, before: beforeStyle, after: afterStyle, file });
    } catch {
      // An element that detached or went off-screen: no hover state for it.
    }
  }
  await page.mouse.move(1, 1).catch(() => {});
  return out;
}

const SPECIMEN_TEXT = "Aa Bb Gg Qq Rr — àéç & 0123456789";

/** For each rendered family × weight, a picture of its glyphs set in the page's own loaded font (§4.1 step 7). */
async function specimenPass(page: Page, dir: string, dom: DomPass, rendered: CaptureArtifacts["fonts"]["rendered"]): Promise<CaptureArtifacts["media"]["specimens"]> {
  const out: CaptureArtifacts["media"]["specimens"] = [];
  const seen = new Set<string>();
  const viewport = { width: dom.page.viewportWidth, height: dom.page.viewportHeight };
  for (const style of dom.textStyles) {
    if (out.length >= 10) break;
    const run = dom.runs[style.rep];
    const family = rendered.find((r) => r.style === style.id)?.families[0]?.family;
    if (!run || !family) continue;
    const id = `${family}|${run.weight}|${run.italic ? 1 : 0}`;
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      const box = await extract<{ x: number; y: number; width: number; height: number }>(page, "specimen", { stack: run.family, weight: run.weight, italic: run.italic, text: SPECIMEN_TEXT });
      await sleep(60);
      const tile = Buffer.from(await page.screenshot({ type: "png", optimizeForSpeed: true }));
      const cut = await cutFromTile(tile, { ...box, width: Math.min(box.width, viewport.width) }, 0, viewport);
      if (cut && !cut.uniform) {
        const file = `s-${out.length}.webp`;
        writeFileSync(join(dir, file), cut.data);
        out.push({ family, weight: run.weight, italic: run.italic, file });
      }
    } catch {
      /* a specimen that cannot render is simply absent */
    } finally {
      await extract(page, "unspecimen").catch(() => {});
    }
  }
  return out;
}

/** Font responses with their source; OFL files written next to the capture. */
function saveFontFiles(dir: string, network: Recorded, pageHost: string): CaptureArtifacts["fonts"]["network"] {
  const faces = parseFontFaces(network.stylesheets);
  return network.fonts.map((font, index) => {
    const face = faces.find((f) => f.urls.includes(font.url));
    let file: string | null = null;
    if (font.body) {
      const ext = /woff2/.test(font.mime) || font.url.includes(".woff2") ? "woff2" : /woff/.test(font.mime) || font.url.includes(".woff") ? "woff" : "ttf";
      file = `font-${index}.${ext}`;
      writeFileSync(join(dir, file), font.body);
    }
    return {
      url: font.url,
      host: font.host,
      source: fontSource(font.host, pageHost),
      bytes: font.bytes,
      family: face?.family ?? null,
      weight: face?.weight ?? null,
      style: face?.style ?? null,
      file,
    };
  });
}

function persist(
  captureId: string,
  url: URL,
  artifacts: CaptureArtifacts,
  links: DomPass["links"],
  state: { bytes: number; requests: number; blocked: number },
): void {
  const connection = db();
  connection.exec("BEGIN");
  try {
    connection
      .prepare(
        `UPDATE captures SET status = 'ready', stage = 'analyse', final_url = ?, host = ?, title = ?, description = ?,
         width = ?, height = ?, screenshot = ?, meta = ?, artifacts = 2, error = NULL, finished_at = ? WHERE id = ?`,
      )
      .run(
        url.toString(),
        url.hostname,
        artifacts.meta.title || url.hostname,
        artifacts.meta.description || "",
        Math.round(artifacts.page.width),
        Math.round(artifacts.page.height),
        "page.jpg",
        JSON.stringify({ meta: artifacts.meta, page: artifacts.page, budget: state }),
        new Date().toISOString(),
        captureId,
      );

    const insertLink = connection.prepare(
      `INSERT INTO capture_links (id, capture_id, href, host, anchor, rel, in_footer, credit_like)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const link of links) {
      insertLink.run(randomUUID(), captureId, link.href, link.host, link.anchor, link.rel, link.inFooter ? 1 : 0, link.creditLike ? 1 : 0);
    }
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

/** Creates the row and queues the work. Returns the capture id immediately. */
export function requestCapture(userId: string, rawUrl: string, retryOf: string | null = null): { id: string } {
  const url = parseUserUrl(rawUrl);
  if (!url) throw new Error("URL illisible.");
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO captures (id, user_id, requested_url, host, status, stage, retry_of, created_at)
       VALUES (?, ?, ?, ?, 'pending', 'load', ?, ?)`,
    )
    .run(id, userId, url.toString(), url.hostname, retryOf, new Date().toISOString());
  enqueueCapture(id, url.toString());
  return { id };
}
