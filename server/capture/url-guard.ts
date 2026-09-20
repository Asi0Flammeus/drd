/**
 * Everything that stands between "a user typed a URL" and "a browser we run
 * fetches it".
 *
 * A capture endpoint is a server-side request forgery primitive by
 * construction: the user names a URL and our machine, inside whatever network
 * it lives in, fetches it and hands back a picture of the result. So the guard
 * is not a nicety — it is the feature's containment.
 *
 * Four layers, in order:
 *   1. protocol / port / credential allowlist on the parsed URL,
 *   2. DNS resolution, with every returned address checked against the
 *      reserved and private ranges,
 *   3. the resolved address pinned into Chrome (`--host-resolver-rules`) so
 *      the name cannot resolve to something else between check and fetch,
 *   4. the same check again on every redirect hop and every subresource.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { config } from "../config.ts";

export type GuardFailure = {
  ok: false;
  code:
    | "bad_url"
    | "bad_protocol"
    | "bad_port"
    | "credentials_in_url"
    | "blocked_host"
    | "dns_failed"
    | "private_address";
  message: string;
};

export type GuardSuccess = {
  ok: true;
  url: URL;
  /** The address Chrome will be pinned to for this hostname. */
  address: string;
  family: 4 | 6;
};

export type GuardResult = GuardSuccess | GuardFailure;

/** Hostnames that never denote a public site, whatever DNS says today. */
const BLOCKED_HOST_SUFFIXES = [
  "localhost",
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".home.arpa",
  ".lan",
  ".corp",
  ".onion",
  ".test",
  ".invalid",
  ".example",
];

const METADATA_HOSTS = ["metadata.google.internal", "metadata", "instance-data"];

/**
 * Parses what a human typed, or what a browser handed us in the splat route.
 *
 * Accepts, in this order of ambiguity: a full URL, a percent-encoded URL, a
 * URL whose double slash a proxy collapsed (`https:/example.com`), and a bare
 * host with an optional path. Anything else is rejected rather than guessed at.
 */
export function parseUserUrl(raw: string): URL | null {
  let text = raw.trim();
  if (!text) return null;
  // The splat arrives as one path segment; decode it at most twice, because a
  // browser address bar re-encodes what a user pasted already encoded.
  for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(text); i += 1) {
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch {
      break;
    }
  }
  text = text.trim();
  // `https:/example.com` — one slash lost to path normalisation somewhere.
  text = text.replace(/^(https?):\/(?!\/)/i, "$1://");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    // No scheme at all: only accept something that really looks like a host.
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d+)?([/?#]|$)/i.test(text)) return null;
    text = `https://${text}`;
  }
  try {
    const url = new URL(text);
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

/** True for any address a public website can never legitimately live on. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true;
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true; // this network
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, RFC6598
  if (a === 169 && b === 254) return true; // link-local, and the cloud metadata address
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 0) return true; // IETF protocol assignments, 192.0.0.0/24 and TEST-NET-1
  if (a === 192 && b === 88) return true; // 6to4 relay anycast
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/**
 * Expands any IPv6 text form to its 16 bytes, or null if it is not one.
 *
 * Prefix matching on the string is not enough, and that is not a theoretical
 * objection: `::ffff:10.0.0.1` is re-serialised by WHATWG URL parsing as
 * `::ffff:a00:1`, so a check written against the dotted form waves the same
 * address through in hex. Bytes cannot be spelled two ways.
 */
function ipv6Bytes(address: string): Uint8Array | null {
  const text = address.toLowerCase().split("%")[0];
  if (!/^[0-9a-f:.]+$/.test(text)) return null;
  const [head, tail, ...rest] = text.split("::");
  if (rest.length > 0) return null;

  const toHextets = (part: string): number[] | null => {
    if (part === "") return [];
    const pieces = part.split(":");
    const out: number[] = [];
    for (let i = 0; i < pieces.length; i += 1) {
      const piece = pieces[i];
      if (piece.includes(".")) {
        if (i !== pieces.length - 1) return null;
        const quad = piece.split(".").map(Number);
        if (quad.length !== 4 || quad.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        out.push((quad[0] << 8) | quad[1], (quad[2] << 8) | quad[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };

  const left = toHextets(head);
  const right = tail === undefined ? [] : toHextets(tail);
  if (!left || !right) return null;
  const gap = 8 - left.length - right.length;
  if (tail === undefined ? gap !== 0 : gap < 1) return null;
  const hextets = [...left, ...new Array<number>(tail === undefined ? 0 : gap).fill(0), ...right];
  if (hextets.length !== 8) return null;

  const bytes = new Uint8Array(16);
  hextets.forEach((value, index) => {
    bytes[index * 2] = (value >> 8) & 0xff;
    bytes[index * 2 + 1] = value & 0xff;
  });
  return bytes;
}

function isPrivateIPv6(address: string): boolean {
  const bytes = ipv6Bytes(address);
  if (!bytes) return true; // unparseable is not a public address

  const allZero = (end: number) => bytes.slice(0, end).every((byte) => byte === 0);
  const embedded = () => `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;

  // ::, ::1, and the IPv4-compatible / IPv4-mapped forms.
  if (allZero(15) && bytes[15] <= 1) return true;
  if (allZero(10) && bytes[10] === 0xff && bytes[11] === 0xff) return isPrivateIPv4(embedded());
  if (allZero(12)) return isPrivateIPv4(embedded());
  // 64:ff9b::/96 and 64:ff9b:1::/48 — NAT64, which translates to IPv4.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) return isPrivateIPv4(embedded());

  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xff) return true; // ff00::/8 multicast
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // 2001:db8::/32
  if (bytes[0] === 0x01 && bytes[1] === 0x00 && allZeroRange(bytes, 2, 8)) return true; // 100::/64 discard
  return false;
}

function allZeroRange(bytes: Uint8Array, start: number, end: number): boolean {
  for (let i = start; i < end; i += 1) if (bytes[i] !== 0) return false;
  return true;
}

export function hostIsBlocked(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (METADATA_HOSTS.includes(host)) return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => (suffix.startsWith(".") ? host.endsWith(suffix) : host === suffix));
}

/** Synchronous checks: everything decidable without touching the network. */
export function inspectUrl(url: URL): GuardFailure | null {
  const protocol = url.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    return { ok: false, code: "bad_protocol", message: `Protocole refusé : ${url.protocol.replace(":", "")}. Seuls http et https sont capturés.` };
  }
  if (url.username || url.password) {
    return { ok: false, code: "credentials_in_url", message: "Une URL contenant des identifiants n'est jamais capturée." };
  }
  const port = url.port ? Number(url.port) : protocol === "https:" ? 443 : 80;
  if (!config.capture.allowedPorts.includes(port)) {
    return { ok: false, code: "bad_port", message: `Port refusé : ${port}. Ports autorisés : ${config.capture.allowedPorts.join(", ")}.` };
  }
  if (!config.capture.allowPrivateNetwork && hostIsBlocked(url.hostname)) {
    return { ok: false, code: "blocked_host", message: `Hôte non public : ${url.hostname}.` };
  }
  return null;
}

/**
 * The full check, including DNS. Returns the address the caller must pin, so
 * that the name we vetted and the name Chrome connects to cannot diverge.
 */
export async function guardUrl(input: string | URL): Promise<GuardResult> {
  const url = typeof input === "string" ? parseUserUrl(input) : input;
  if (!url) return { ok: false, code: "bad_url", message: "URL illisible." };

  const sync = inspectUrl(url);
  if (sync) return sync;

  const literal = isIP(url.hostname.replace(/^\[|\]$/g, ""));
  if (literal) {
    const address = url.hostname.replace(/^\[|\]$/g, "");
    if (!config.capture.allowPrivateNetwork && isPrivateAddress(address)) {
      return { ok: false, code: "private_address", message: `Adresse privée ou réservée : ${address}.` };
    }
    return { ok: true, url, address, family: literal === 4 ? 4 : 6 };
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, code: "dns_failed", message: `Nom introuvable : ${url.hostname}.` };
  }
  if (addresses.length === 0) return { ok: false, code: "dns_failed", message: `Nom introuvable : ${url.hostname}.` };

  if (!config.capture.allowPrivateNetwork) {
    // ALL answers must be public. One private answer in a round-robin set is a
    // rebinding attempt, not a coincidence worth tolerating.
    const bad = addresses.find((entry) => isPrivateAddress(entry.address));
    if (bad) {
      return { ok: false, code: "private_address", message: `${url.hostname} résout vers une adresse privée (${bad.address}).` };
    }
  }

  const chosen = addresses[0];
  return { ok: true, url, address: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}
