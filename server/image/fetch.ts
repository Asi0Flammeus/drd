import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import sharp from "sharp";
import { config } from "../config.ts";
import { guardUrl, parseUserUrl } from "../capture/url-guard.ts";
import type { GuardResult, GuardSuccess } from "../capture/url-guard.ts";
import { HttpError } from "../http.ts";

const FORMAT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "heif",
};
const REDIRECT_STATUS: Record<number, true> = { 301: true, 302: true, 303: true, 307: true, 308: true };

export class ImageFetchError extends HttpError {}

export type TransportReply = {
  status: number;
  headers: Record<string, string>;
  chunks?: AsyncIterable<Uint8Array> | Buffer[];
  cancel?: () => void;
};

export type ImageTransport = (url: URL, pinned: GuardSuccess, signal: AbortSignal) => Promise<TransportReply>;
export type ImageGuard = (input: string | URL) => Promise<GuardResult>;

export type FetchedImage = {
  kind: "image";
  bytes: Buffer;
  mime: string;
  width: number;
  height: number;
  format: string;
  finalUrl: URL;
};

export type FetchedPage = { kind: "page"; finalUrl: URL; mime: string; status: number };

function headerValue(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

function nativeTransport(url: URL, pinned: GuardSuccess, signal: AbortSignal): Promise<TransportReply> {
  const { promise, resolve, reject } = Promise.withResolvers<TransportReply>();
  const open = url.protocol === "https:" ? httpsRequest : httpRequest;
  const req = open(
    {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,text/html;q=0.5,*/*;q=0.1", "user-agent": config.capture.userAgent },
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
      servername: url.hostname,
    },
    (response: IncomingMessage) => {
      const headers: Record<string, string> = {};
      for (const name of ["content-type", "content-length", "content-encoding", "location"]) {
        const value = headerValue(response.headers, name);
        if (value) headers[name] = value;
      }
      resolve({
        status: response.statusCode ?? 0,
        headers,
        chunks: response,
        cancel: () => response.destroy(),
      });
    },
  );
  req.setTimeout(config.image.requestTimeoutMs, () => req.destroy(new Error("image request timeout")));
  signal.addEventListener("abort", () => req.destroy(signal.reason instanceof Error ? signal.reason : new Error("image request aborted")), { once: true });
  req.on("error", reject);
  req.end();
  return promise;
}

function contentType(headers: Record<string, string>): string {
  return (headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
}

async function collect(reply: TransportReply, maxBytes: number): Promise<Buffer> {
  const declared = Number(reply.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    reply.cancel?.();
    throw new ImageFetchError(413, "image_too_large", `Image refusée : plus de ${Math.round(maxBytes / 1_000_000)} Mo.`);
  }
  if (reply.headers["content-encoding"] && reply.headers["content-encoding"].toLowerCase() !== "identity") {
    reply.cancel?.();
    throw new ImageFetchError(415, "encoded_image", "Image refusée : encodage HTTP compressé non pris en charge.");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of reply.chunks ?? []) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      reply.cancel?.();
      throw new ImageFetchError(413, "image_too_large", `Image refusée : plus de ${Math.round(maxBytes / 1_000_000)} Mo.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes);
}

export async function fetchImageResource(
  rawUrl: string | URL,
  options: {
    guard?: ImageGuard;
    transport?: ImageTransport;
    maxBytes?: number;
    maxPixels?: number;
    maxDimension?: number;
    maxRedirects?: number;
    timeoutMs?: number;
  } = {},
): Promise<FetchedImage | FetchedPage> {
  const guard = options.guard ?? guardUrl;
  const transport = options.transport ?? nativeTransport;
  const maxBytes = options.maxBytes ?? config.image.maxBytes;
  const maxPixels = options.maxPixels ?? config.image.maxPixels;
  const maxDimension = options.maxDimension ?? config.image.maxDimension;
  const maxRedirects = options.maxRedirects ?? config.capture.maxRedirects;
  const timeoutMs = options.timeoutMs ?? config.image.requestTimeoutMs;
  const deadline = AbortSignal.timeout(timeoutMs);
  const parsed = rawUrl instanceof URL ? rawUrl : parseUserUrl(rawUrl);
  if (!parsed) throw new ImageFetchError(400, "bad_url", "URL illisible.");
  let current = parsed;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const guarded = await guard(current);
    if (!guarded.ok) throw new ImageFetchError(400, guarded.code, guarded.message);
    let reply: TransportReply;
    try {
      reply = await transport(guarded.url, guarded, deadline);
    } catch (error) {
      const timedOut = deadline.aborted;
      throw new ImageFetchError(timedOut ? 408 : 502, timedOut ? "image_timeout" : "image_fetch_failed", timedOut ? "Téléchargement de l'image expiré." : `Téléchargement de l'image impossible : ${error instanceof Error ? error.message : "erreur réseau"}.`);
    }

    if (REDIRECT_STATUS[reply.status]) {
      reply.cancel?.();
      const location = reply.headers.location;
      if (!location) throw new ImageFetchError(502, "bad_redirect", "Redirection d'image sans destination.");
      if (hop === maxRedirects) throw new ImageFetchError(400, "too_many_redirects", "Trop de redirections pour cette image.");
      current = new URL(location, guarded.url);
      continue;
    }
    if (reply.status < 200 || reply.status >= 300) {
      reply.cancel?.();
      throw new ImageFetchError(400, "image_http_error", `La source a répondu ${reply.status}.`);
    }

    const mime = contentType(reply.headers);
    const expectedFormat = FORMAT_BY_MIME[mime];
    if (!expectedFormat) {
      reply.cancel?.();
      return { kind: "page", finalUrl: guarded.url, mime, status: reply.status };
    }

    const bytes = await collect(reply, maxBytes);
    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(bytes, { limitInputPixels: false, animated: true }).metadata();
    } catch {
      throw new ImageFetchError(415, "invalid_image", "Le contenu annoncé comme image ne se décode pas.");
    }
    const width = metadata.width ?? 0;
    const frameHeight = metadata.pageHeight ?? metadata.height ?? 0;
    const pages = metadata.pages ?? 1;
    const decodedPixels = width * frameHeight * pages;
    if (!width || !frameHeight || width > maxDimension || frameHeight > maxDimension || decodedPixels > maxPixels) {
      throw new ImageFetchError(413, "image_dimensions", `Image refusée : dimensions décodées au-delà de ${maxDimension} px ou ${maxPixels.toLocaleString("fr-FR")} pixels.`);
    }
    if (metadata.format !== expectedFormat && !(mime === "image/avif" && metadata.format === "heif")) {
      throw new ImageFetchError(415, "mime_mismatch", "Le format décodé ne correspond pas au type MIME annoncé.");
    }
    try {
      await sharp(bytes, { limitInputPixels: maxPixels, animated: false }).resize(1, 1, { fit: "fill" }).raw().toBuffer();
    } catch {
      throw new ImageFetchError(415, "invalid_image", "Le contenu annoncé comme image ne se décode pas.");
    }
    return { kind: "image", bytes, mime, width, height: frameHeight, format: metadata.format ?? expectedFormat, finalUrl: guarded.url };
  }
  throw new ImageFetchError(400, "too_many_redirects", "Trop de redirections pour cette image.");
}
