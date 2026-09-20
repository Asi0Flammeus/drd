/**
 * The capture pipeline: a vetted URL in, a screenshot plus real browser
 * geometry out.
 *
 * Why a server-side browser at all — the boundary that shapes this whole app:
 * a cross-origin page in an iframe cannot be read from JavaScript. There is no
 * client-side trick that recovers an element's box or its computed font from
 * someone else's site. Either a browser we control loads the page and reports
 * geometry, or the feature does not exist. So one runs here, in the smallest,
 * most suspicious configuration that still renders a real page.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import type { Browser, HTTPRequest, Page } from "puppeteer";
import { config } from "../config.ts";
import { db } from "../db.ts";
import { guardUrl, inspectUrl, isPrivateAddress, parseUserUrl } from "./url-guard.ts";

const EXTRACTOR = readFileSync(fileURLToPath(new URL("./extract.browser.js", import.meta.url)), "utf8");

export type ExtractedElement = {
  selector: string;
  tag: string;
  label: string;
  guess: string;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  depth: number;
  text: string;
  styles: Record<string, string>;
};

export type ExtractedLink = {
  href: string;
  host: string;
  anchor: string;
  rel: string;
  inFooter: boolean;
  creditLike: boolean;
};

export type Extraction = {
  meta: Record<string, string>;
  page: { width: number; height: number; viewportWidth: number; viewportHeight: number };
  elements: ExtractedElement[];
  links: ExtractedLink[];
  fonts: { family: string; count: number; sizes: number[]; weights: string[]; sample: string }[];
  colors: { hex: string; count: number; role: string }[];
};

/* ------------------------------------------------------------- queue ----- */

type Job = { captureId: string; url: string };

const pending: Job[] = [];
let running = 0;

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
export async function waitForCapture(captureId: string, timeoutMs = config.capture.timeoutMs + 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = db().prepare("SELECT status FROM captures WHERE id = ?").get(captureId) as { status: string } | undefined;
    if (!row) return "missing";
    if (row.status === "ready" || row.status === "failed") return row.status;
    if (Date.now() > deadline) return "timeout";
    await sleep(250);
  }
}

/** Three call sites need the same pause; the executor form is the one thing Node still lacks a primitive for. */
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
    "--disable-dev-shm-usage",
    // The address was vetted a moment ago; pin it so the name cannot resolve
    // somewhere else between the check and the connection (DNS rebinding).
    `--host-resolver-rules=MAP ${hostname} ${address},EXCLUDE localhost`,
  ];
  if (config.capture.noSandbox) args.push("--no-sandbox", "--disable-setuid-sandbox");
  return puppeteer.launch({
    headless: true,
    args,
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

/* ----------------------------------------------------------- capture ----- */

export async function runCapture(captureId: string, requestedUrl: string): Promise<void> {
  const guard = await guardUrl(requestedUrl);
  if (!guard.ok) {
    markFailed(captureId, guard.message);
    return;
  }

  db().prepare("UPDATE captures SET status = 'running' WHERE id = ?").run(captureId);

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
    await page.setUserAgent(config.capture.userAgent);
    await page.setViewport({
      width: config.capture.viewportWidth,
      height: config.capture.viewportHeight,
      deviceScaleFactor: 1,
    });
    await page.setJavaScriptEnabled(true);
    page.setDefaultTimeout(config.capture.navigationTimeoutMs);
    // A captured page must never be able to hold the pipeline open with a
    // dialog, and animations must stop so the screenshot is reproducible.
    page.on("dialog", (dialog) => void dialog.dismiss().catch(() => {}));
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);

    const work = (async () => {
      const response = await page.goto(guard.url.toString(), {
        waitUntil: "networkidle2",
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

      await autoScroll(page);
      await page.evaluate("window.scrollTo(0, 0)");
      await sleep(400);

      const extraction = (await page.evaluate(`${EXTRACTOR}\n()`)) as Extraction;
      const height = Math.min(extraction.page.height, config.capture.maxPageHeight);

      const shot = await page.screenshot({
        type: "jpeg",
        quality: 82,
        clip: { x: 0, y: 0, width: extraction.page.width, height, scale: 1 },
        captureBeyondViewport: true,
      });
      writeFileSync(join(dir, "page.jpg"), shot);

      const elements = pickElements(extraction.elements, height);
      const crops = await cropElements(page, dir, elements, height);
      return { extraction, elements, crops, height };
    })();

    const result = await Promise.race([work, overallTimeout.promise]);
    if (result === "timeout") throw new Error(`Capture interrompue après ${Math.round(config.capture.timeoutMs / 1000)} s.`);
    const { extraction, elements, crops, height } = result as Awaited<typeof work>;

    persist(captureId, guard.url, extraction, elements, crops, height, state);
  } catch (error) {
    markFailed(captureId, error instanceof Error ? error.message : String(error));
  } finally {
    overallTimeout.cancel();
    await browser?.close().catch(() => {});
  }
}

/** A deadline the whole capture races against, cancellable so a fast page does not hold the process open. */
function captureDeadline(ms: number): { promise: Promise<"timeout">; cancel: () => void } {
  const { promise, resolve } = Promise.withResolvers<"timeout">();
  const handle = setTimeout(() => resolve("timeout"), ms);
  return { promise, cancel: () => clearTimeout(handle) };
}

/** Lazy images only load if something scrolls. Bounded, so an infinite feed cannot win. */
async function autoScroll(page: Page): Promise<void> {
  await page.evaluate(`new Promise((resolve) => {
    let y = 0;
    const step = Math.max(400, window.innerHeight * 0.9);
    const limit = Math.min(document.documentElement.scrollHeight, ${config.capture.maxPageHeight});
    const timer = setInterval(() => {
      window.scrollTo(0, y);
      y += step;
      if (y > limit) { clearInterval(timer); resolve(null); }
    }, 90);
  })`);
}

/**
 * Which extracted boxes become selectable regions. Biggest first is wrong —
 * that buries the buttons under the page wrapper — so the list is balanced:
 * every distinctive small component, then the large blocks that remain.
 */
function pickElements(elements: ExtractedElement[], pageHeight: number): ExtractedElement[] {
  const inside = elements.filter((el) => el.y < pageHeight && el.width >= 24 && el.height >= 16);
  const priority: Record<string, number> = { button: 0, image: 1, card: 2, nav: 3, hero: 3, type: 4, grid: 5, form: 5, footer: 6, section: 7 };
  return inside
    .slice()
    .sort((a, b) => (priority[a.guess] ?? 9) - (priority[b.guess] ?? 9) || b.area - a.area)
    .slice(0, config.capture.maxElements);
}

async function cropElements(
  page: Page,
  dir: string,
  elements: ExtractedElement[],
  pageHeight: number,
): Promise<Record<string, string>> {
  const crops: Record<string, string> = {};
  let made = 0;
  for (const element of elements) {
    if (made >= config.capture.maxCrops) break;
    const height = Math.min(element.height, 1400, pageHeight - element.y);
    if (element.width < 40 || height < 24) continue;
    const file = `el-${made}.png`;
    try {
      const shot = await page.screenshot({
        type: "png",
        clip: { x: Math.max(0, element.x), y: Math.max(0, element.y), width: element.width, height, scale: 1 },
        captureBeyondViewport: true,
      });
      writeFileSync(join(dir, file), shot);
      crops[element.selector] = file;
      made += 1;
    } catch {
      // One unshootable region (a fixed overlay, a zero-size after relayout)
      // must not cost the capture.
    }
  }
  return crops;
}

function persist(
  captureId: string,
  url: URL,
  extraction: Extraction,
  elements: ExtractedElement[],
  crops: Record<string, string>,
  height: number,
  state: { bytes: number; requests: number; blocked: number },
): void {
  const connection = db();
  connection.exec("BEGIN");
  try {
    connection
      .prepare(
        `UPDATE captures SET status = 'ready', final_url = ?, host = ?, title = ?, description = ?,
         width = ?, height = ?, screenshot = ?, meta = ?, error = NULL, finished_at = ? WHERE id = ?`,
      )
      .run(
        url.toString(),
        url.hostname,
        extraction.meta.title || url.hostname,
        extraction.meta.description || "",
        Math.round(extraction.page.width),
        Math.round(height),
        "page.jpg",
        JSON.stringify({
          meta: extraction.meta,
          fonts: extraction.fonts,
          colors: extraction.colors,
          page: extraction.page,
          budget: state,
        }),
        new Date().toISOString(),
        captureId,
      );

    const insertElement = connection.prepare(
      `INSERT INTO capture_elements (id, capture_id, ordinal, tag, selector, label, guess, x, y, width, height, text, styles, crop)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    elements.forEach((element, index) => {
      insertElement.run(
        randomUUID(),
        captureId,
        index,
        element.tag,
        element.selector,
        element.label,
        element.guess,
        element.x,
        element.y,
        element.width,
        element.height,
        element.text,
        JSON.stringify(element.styles),
        crops[element.selector] ?? null,
      );
    });

    const insertLink = connection.prepare(
      `INSERT INTO capture_links (id, capture_id, href, host, anchor, rel, in_footer, credit_like)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const link of extraction.links) {
      insertLink.run(
        randomUUID(),
        captureId,
        link.href,
        link.host,
        link.anchor,
        link.rel,
        link.inFooter ? 1 : 0,
        link.creditLike ? 1 : 0,
      );
    }
    connection.exec("COMMIT");
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

/** Creates the row and queues the work. Returns the capture id immediately. */
export function requestCapture(userId: string, rawUrl: string): { id: string } {
  const url = parseUserUrl(rawUrl);
  if (!url) throw new Error("URL illisible.");
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO captures (id, user_id, requested_url, host, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    )
    .run(id, userId, url.toString(), url.hostname, new Date().toISOString());
  enqueueCapture(id, url.toString());
  return { id };
}
