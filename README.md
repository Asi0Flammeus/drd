# DRD — design research & development

Capture a public page with a real browser, cut out the parts you like, write
down **why** you like them, and export a reference pack any design agent can
work from.

It exists because of how AI-assisted sites get built today: someone shows the
model one competitor's site and asks for "something like this". The result is
a copy with the serial numbers filed off, in whatever typeface and palette the
model reaches for when nobody specified one. The fix is not a better prompt,
it is better input — several real references, each with a recorded reason, and
an explicit instruction to mix rather than clone.

```
npm install
cp .env.example .env        # optional; every default works as-is
npm run migrate             # creates data/drd.sqlite
npm run build               # dist/client + a generated dist/client/sw.js
npm start                   # http://127.0.0.1:5178
```

Then open `http://127.0.0.1:5178/app`, create an account, and paste a URL.

For development, `npm run dev` runs the API on 5178 and Vite with live reload
on 5177 (which proxies `/api` and `/media` to the API).

---

## The five things it does

**1 · Capture.** Paste a URL — or open `your-domain/https://the-site.fr`
directly, which is the point of the domain — and a headless Chrome on the
server loads the page, waits for it, scrolls it so lazy images load, and
reports back: a full-page screenshot, every significant element's **real
bounding box and computed style**, per-element crops, the fonts and colours
actually in use, and the outbound links.

That server-side browser is not an implementation preference. A cross-origin
page in an iframe cannot be read from JavaScript — there is no client-side
trick that recovers an element's box or its font from someone else's site.
Either a browser you control loads it, or the feature does not exist.

**2 · Annotate.** Tap a region on the screenshot (or pick it from the list
view, which is what a phone gets by default) and save it as a reference:
what kind of thing it is, what it is, **why you are keeping it**, tags, and
which collection it belongs in. The `why` is a column, not a nicety — it is
the only part that is still useful six weeks later.

**3 · Organise.** Nested collections. References keep their provenance: source
URL, page title, capture date, CSS selector, box, and the computed styles the
browser reported. Deleting a collection never deletes its references; they go
back to the inbox.

**4 · Discover.** Real candidates from the outbound-link graph of the pages you
captured, ranked by the things that actually indicate a lead — a footer credit
("site by …"), a host cited by several sites you saved, a URL that points at a
portfolio, a name that overlaps the words in your own annotations. Every
candidate shows the reasons it scored. Accept turns it into a capture, dismiss
suppresses the host.

There is no design-search API wired in, and none is faked. The provider seam
is `server/discovery/providers.ts`: implement `suggest()` on
`externalSearchProvider` and the rest of the pipeline takes its candidates on
the same terms. Until then the UI says the provider is not configured.

**5 · Export.** A pack is a ZIP built from stored rows, deterministically and
offline:

| file | what it is |
|---|---|
| `prompt.md` | the brief to hand an agent: every reference with its what/why, plus a pre-delivery checklist |
| `README.md` | the human version, with provenance and the observed browser values |
| `tokens.css` | custom properties extracted from the references |
| `pack.json` | the same thing machine-readable |
| `images/…` | the crops and screenshots referenced above |

Two rules are enforced rather than suggested: a pack whose references all come
from **one** host is refused (that is a copy brief, not a reference pack), and
under three distinct sources it ships with a warning. Every pack carries
explicit anti-copy language — mix, do not clone; take the principle, not the
pixels; never reuse content.

An optional LLM adapter can discuss a pack (`DRD_LLM_*`). Export never calls
it. If it is not configured, the endpoint says so and nothing else changes.

---

## The playground

Three parameter spaces, carried over from the `design-system-rnd` bench this
grew out of, because judging a typeface or a ramp is the other half of design
research:

- **Type** — five open-source variable families (Bricolage Grotesque,
  Fraunces, Recursive, Anybody, Newsreader), every axis exposed, axis values
  held **per role** so a headline and a paragraph carry separate optical
  sizes. Self-hosted: no CDN, no Google Fonts.
- **Colour** — five palettes traceable to a published source or a published
  method (Radix, Adobe Leonardo solved against contrast targets, Open Color,
  Catppuccin, Rosé Pine), edited either by ramp-wide OKLCH transform or by
  per-swatch hex, with four WCAG pairings measured live.
- **Components** — six button recipes driven by one component-token set, plus
  a switch, a focus ring and a card lift so a motion token can be seen
  propagating.

What survives the playground saves into the **same** collection model as
anything captured, with its resolved token tree stored, so a pack can mix "the
nav rhythm from that site" with "this palette I solved myself".

Not carried over: the bench's hardcoded snapshot of four production sites and
its Material-token audit. Capturing the real sites supersedes the first, and
the second was an audit of that bench, not of this tool.

---

## Architecture

```
server/           node:http + node:sqlite + puppeteer. No framework, no ORM.
  capture/        url-guard.ts (SSRF), runner.ts (browser), extract.browser.js
  discovery/      taste profile + link-graph provider + the external seam
  export/         deterministic pack builder + a ZIP writer
  routes/         auth · captures · library · discovery · packs · assistant
src/              Vite + TypeScript, no framework. Hash routing under /app.
test/             the security and data-loss invariants only
```

Three dependencies: `puppeteer` at runtime, `vite` and `typescript` to build.
Everything else — SQLite, password hashing, HTTP, ZIP — is Node's own. The
server runs TypeScript directly through Node's type stripping; there is no
server build step.

**Data.** One SQLite file and one media directory under `DRD_DATA_DIR`. That
is the whole application state; back it up and you have backed up DRD.

**Offline.** Installable PWA: linked manifest, real icons, a hand-written
service worker generated at build time from exactly what Vite emitted. The
shell is precached, captured media is cached on first view (those URLs are
immutable), and `/api` is never cached — a stale collection served as if it
were live is worse than an honest offline banner. The client mirrors its last
successful reads in `localStorage` so collections, references and thumbnails
are readable with the network off, labelled `hors ligne · cache`. Losing the
server is not a logout: the app opens into the cache and says so.

**Layouts.** One build for a phone, a Fold's inner and cover screens, and a
desktop. Verified at 390×844 and 968×875: no horizontal overflow, no touch
target under 48 px on a device that reports no hover.

---

## Security

The capture endpoint is a server-side request forgery primitive by
construction, so the guard around it is the feature's containment: protocol
and port allowlist, hostname denylist, DNS resolution with every answer
checked against the private and reserved ranges (IPv6 on expanded bytes, so
`::ffff:10.0.0.1` cannot sneak through in hex), the vetted address pinned into
Chrome with `--host-resolver-rules` to close the rebinding window, and every
redirect and subresource re-checked. No captured HTML ever reaches the client.

Read [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) before deploying — it
includes the residual risks that are deployment controls rather than
application ones, and a checklist.

```
npm test        # the invariants worth pinning: URL guard, password storage, pack archive
```

Those three files exist because a plausible bug in them is an incident, not an
inconvenience. Writing them found two: an IPv4-mapped IPv6 address that passed
the guard once the URL parser re-serialised it to hex, and a truncated stored
password digest that verified against its own prefix.

---

## Licences

App code: MIT. Bundled typefaces: SIL OFL 1.1, see
`public/fonts/LICENSES.md`. Two button recipes adapted from
[Hover.css](https://github.com/IanLunn/Hover) (MIT). Palette values reproduced
from Radix Colors (MIT), Open Color (MIT), Catppuccin (MIT) and Rosé Pine
(MIT); each palette names its source in the UI.

Captured screenshots belong to the sites they came from. DRD stores them as
private reference material and says so in every pack it exports.
