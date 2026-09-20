# Threat model

DRD fetches arbitrary public URLs with a browser that runs on your server, and
stores what several people said they liked. Those two sentences are the whole
threat model: a request forgery primitive, and multi-tenant data.

## 1 · Server-side request forgery — the primary risk

The capture endpoint is, by construction, "name a URL and our machine fetches
it". On a host that can reach a metadata service, a database, or an admin
panel on a private address, an unguarded version of this feature reads them
and hands the answer back as a screenshot.

Five layers, in the order a request meets them
(`server/capture/url-guard.ts`, `server/capture/runner.ts`):

1. **Protocol and port allowlist.** `http` and `https` only; ports 80 and 443
   only (`DRD_CAPTURE_ALLOWED_PORTS`). `file:`, `gopher:`, `ftp:` and a URL
   carrying credentials are refused before anything resolves.
2. **Hostname denylist.** `localhost`, `*.local`, `*.internal`, `*.home.arpa`,
   `*.onion`, `metadata.google.internal` and friends never denote a public
   site, whatever DNS currently says.
3. **DNS resolution, all answers checked.** Every address returned for the
   hostname must be public. One private answer in a round-robin set fails the
   whole request — that pattern is a rebinding attempt, not a coincidence.
   IPv6 is checked on its expanded bytes, so `::ffff:10.0.0.1` and its
   re-serialised form `::ffff:a00:1` are the same address to the guard.
   Covered: RFC1918, loopback, link-local (including `169.254.169.254`),
   CGNAT, benchmarking, TEST-NET, multicast, ULA, NAT64-embedded IPv4.
4. **The vetted address is pinned into Chrome.** The browser is launched with
   `--host-resolver-rules=MAP <host> <address>`, so the name cannot resolve to
   something else between our check and the connection. This is what closes
   the TOCTOU window that layer 3 alone leaves open.
5. **Every subsequent request re-checked.** Request interception applies the
   same protocol/port/literal-address rules to each subresource and to every
   redirect hop, and the final URL plus the whole redirect chain is re-run
   through the full guard after navigation.

**Residual risk.** Chrome resolves *subresource* hostnames itself; layer 5
sees the URL, not the socket. A page that loads `https://attacker.example/x`
where that name resolves to a private address at connection time could cause
one internal request whose *rendering* lands in a screenshot. Mitigations if
your deployment is sensitive: run the capture process in a network namespace
with no route to private ranges, or give it an egress proxy. That is a
deployment control, not an application one, and it is not enabled by default.

`DRD_ALLOW_PRIVATE_NETWORK=true` disables layers 2–4. It exists to capture a
fixture on `127.0.0.1` while developing the pipeline. In a deployment it turns
the endpoint into an internal-network scanner.

## 2 · Rendering someone else's page

No captured HTML is ever returned to the client or inserted into the DOM. The
client receives screenshots (JPEG/PNG), text extracts, geometry and computed
style strings. Text is set with `textContent`, never `innerHTML`. A captured
page therefore cannot script the app even if it wanted to.

`Content-Security-Policy` is `default-src 'self'` with no third-party origin
allowed anywhere, `frame-ancestors 'none'`, `object-src 'none'`,
`base-uri 'none'`. The app loads no CDN, no web font, no analytics, so the
policy costs nothing to keep this tight.

Captured pages are also prevented from holding the pipeline open: dialogs are
auto-dismissed, animations are stopped via `prefers-reduced-motion`, and the
whole capture races a hard deadline (`DRD_CAPTURE_TIMEOUT_MS`).

## 3 · Resource exhaustion

A hostile page can be infinite, enormous, or both.

- Navigation timeout, then a hard overall deadline that closes the browser.
- Byte cap and request cap enforced during interception.
- Page height capped before the screenshot (`DRD_CAPTURE_MAX_HEIGHT`).
- Element extraction capped, crops capped.
- Auto-scroll is bounded, so an infinite feed terminates.
- One browser at a time by default (`DRD_CAPTURE_CONCURRENCY`), one browser
  per capture so a crash cannot poison the next one.
- Per-account rate limit (`DRD_CAPTURE_PER_USER_PER_HOUR`).

## 4 · Accounts and multi-tenancy

- Passwords: scrypt (N=16384, r=8, p=1), 16-byte per-user salt, 64-byte
  digest, constant-time comparison. Login spends the same work for an unknown
  address as for a known one, so response time does not enumerate accounts.
- Sessions: 32 random bytes, delivered in an `HttpOnly`, `SameSite=Lax`
  cookie, `Secure` as soon as the public origin is https. Only the SHA-256 of
  the token is stored, so a database dump yields no usable session.
- Every query is scoped by `user_id` in SQL. Media is authorised by the
  capture row, not by the filesystem path, and paths are pattern-checked
  before they reach the disk.
- Cross-site request forgery: `SameSite=Lax` plus an Origin check on every
  mutating request.

### The `{domaine}/{url}` shortcut

A GET with a side effect is a forgery shape, so the splat route reads Fetch
Metadata: `Sec-Fetch-Site: cross-site` is refused outright, and a
`Sec-Fetch-Dest` naming a subresource (image, script, iframe…) is refused.
`document` is the address bar and `empty` is what Chrome sends when our own
service worker re-issues the navigation — both are same-site by then.
Requests carrying no Fetch Metadata at all (curl, a share-sheet script) are
accepted: nothing about them can be forged through a victim's browser.

## 5 · What is stored, and what leaves

Stored: accounts, sessions, collections, references with their annotations,
captures with screenshots and element crops, outbound links, discovery
candidates, export packs. All of it in `DRD_DATA_DIR` — one SQLite file and
one media directory. Nothing is sent anywhere else.

No telemetry, no third-party request, no remote font. The optional LLM adapter
is the single outbound integration and it is off unless three environment
variables are set; export packs never touch it.

Copyright is a real exposure the software cannot solve: screenshots and crops
of other people's sites are stored, and export packs contain them. They are
reference material for private use, and every pack says so in its README. Do
not publish a pack.

## 6 · Deployment checklist

- [ ] `DRD_PUBLIC_ORIGIN` set to the https origin, behind TLS.
- [ ] `DRD_ALLOW_PRIVATE_NETWORK` unset or false.
- [ ] `DRD_CHROME_NO_SANDBOX` false unless the host genuinely cannot sandbox.
- [ ] `DRD_REGISTRATION_OPEN=false` or `DRD_INVITE_CODE` set on a public host.
- [ ] Capture process has no route to private ranges (namespace or firewall).
- [ ] `DRD_DATA_DIR` backed up and not web-served.
- [ ] Reverse proxy sets a request body limit and forwards `Origin`.
