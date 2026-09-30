# DRD redesign: proof

Status on 2026-09-30, after the ship pass on **prod**. Verdict: **SHIP**.
Open defects D13–D16 below are cosmetic and do not block. The S9 section
and the build rows are kept as the record.

## Ship pass: deploy and re-shoot on prod (30/09, 13:10–13:50 UTC)

**Deployed: 0b8f9fb** (e58d31e plus the Dockerfile fix below), container
`drd` started 13:18:17Z, RestartCount 0. `/healthz` on 127.0.0.1:4354 and on
https://dnd.alysis.cat: `{"status":"ok","schema":3,"database":"ok",
"capture":{"browser":"ready","queued":0,"sandbox":"enabled"},"client":"built"}`.

Incident during the deploy: the first image (e58d31e, 13:13:31Z) crash-looped
with `EACCES, open '/app/server/analyse/components.ts'`. Five server sources
(and three tests) had been written under a 077 umask, so they were 0600 and
root-owned in the image; the server runs as uid 1000. Prod was down from
13:13:31Z to 13:15:00Z, when an image built after `chmod a+r` on those files
came up healthy. Fix 0b8f9fb: the runtime stage runs `chmod -R a+rX` on
`dist`, `server`, `scripts`, then, as the non-root user, fails the build if
`find … ! -readable` lists anything. Checked both ways with `palette.ts` set
to 0600: without the chmod line the build stops at the check (exit 1); with
it the build passes and the file is 644 in the image.

Start-up log of the first healthy start (13:15:00Z): `[drd] legacy palettes
re-derived from their capture (v1 payload kept in provenance):
9f3d4875-…, 2a5c8294-…`. The restart at 13:18 logged no re-derivation
(idempotent).

### asi0's data

Backups: `data/backups/drd-20260930-pre-deploy-e58d31e.sqlite` (before),
`…-post-deploy-e58d31e.sqlite`, `…-pre-ship-proof-account-delete.sqlite`,
`…-post-ship-proof.sqlite`. Fingerprint (same script and tables as S9):
before the deploy `f80bc4a579891a5826afa61b`, identical to S9. After the
deploy `a3fc2e6c42123d9f44af33ae`, and the diff, table by table:

| | before | after |
|---|---|---|
| items (4 rows) | c55106f00bce7ec7 | cdeff901b376e82f |
| item_colors | 30 rows | 13 rows |
| items_fts (4 rows) | 53abd57853c9a6b0 | 7fd4f1dd46e2b1ca |
| « Palette — linear.app » | row, data, 18 colours, fts | changed: 5 colours |
| « Palette — mamielasagnes.fr » | row, data, 11 colours, fts | changed: 7 colours |
| « Notre Carte », « Typographies — linear.app » | | identical |
| his why / what / tags, every item | | identical |
| users, captures 8, elements 333, links 206, analyses 8, findings 233, boards, board_items, signals, blobs 5, media files 518, blob files 5, sessions | | identical |

The two palettes now read: linear.app Fond #08090a, Surface #0f1011, Texte
#f7f8f8, Texte 2 #8a8f98, Bordure #ffffff (7 in `others`); mamielasagnes.fr
Fond #f6eccc, Surface #ffffff, Texte #321108, Texte 2 #121212, Accent #d5360d,
Accent 2 #9a905c, Bordure #0b4951 (1 in `others`). Each keeps its v1 payload
(18 and 11 colours) in `provenance.rederived.previous`. After the whole proof
run and the account deletion his fingerprint is still `a3fc2e6c…`.

### How

A fresh `maia-proof+drd@alysis.cat`, registered through the app's form with
the instance invite code, used in headless Chromium at 968 × 875 and
412 × 915 (touch, DPR 1). Its captures: www.nematis.com, linear.app,
maisoncyrah.fr, mamielasagnes.fr, typewolf.com, fontshare.com,
jeremiahshoaf.com, sharptype.co (the site answered 429), machinepro.club.
For I-26 two of asi0's v1 captures (maisoncyrah 3d95c4a1, linear 0af0c6e8)
were copied to the proof account under new ids with their elements, links
and media, and no analysis. The originals were only read. Shots:
`docs/proof-private/ship/` (gitignored).

At the end the account was deleted as in S9: `DELETE FROM items_fts` for its
items, then `DELETE FROM users` with `foreign_keys=ON` (cascade: 11 captures,
12 items, 1 board, 2 packs, 1 session, 7 candidates, 17 signals), its 11
media folders removed, 52 unreferenced blobs collected with the server's
`collectBlobs`. No orphans in any table, `integrity_check` ok, one user left.

### nematis on prod

Captured through the UI at 968: capture 52.2 s (13:19:17.673Z →
13:20:09.885Z), analysis 1.3 s, ready at 53.8 s. Server log: `load 2.0s ·
scroll 5.2s · dom 2.3s · fonts 5.0s · network 0.2s · tiles 21.2s · stitch
1.3s · hover 12.5s · specimens 2.5s`. Memory, the prod `drd` cgroup sampled
every 100 ms over 200 s from the capture's start (docker stats' figure:
memory.current minus inactive_file): **peak 1333 MiB** at 34.8 s, limit
2048 MiB, `oom_kill` 0 before and 0 after. Since the restart the container's
`memory.events` still reads `oom_kill 0`.

**Decision (M1), not a failure:** the 1 GB target is dropped. A peak of about
1.3–1.5 GB with no OOM under the 2 GB limit is accepted, because getting
under 1 GB would mean not rendering the WebGL and video that DRD exists to
capture.

### Rows re-shot

| # | 968 | 412 | Observed on prod |
|---|---|---|---|
| I-01 (D1) | ✔ | | nematis and linear: the row goes Chargement → Défilement → (Mesure) → Pixels → Analyse with its stages and no « analyse v1 », then the counts. linear 44 s. |
| I-05 | ✔ | | Tab bar `position: sticky`: at 77 px before the scroll, 0 px after it. |
| I-06 (D2) | ✔ | ✔ | Texte 2 selected (`aria-pressed`), row shows `oklch(0.649 0.015 262) · #8a8f98` and uses; no ellipsis, 0 clipped elements. 412: see D13. |
| I-12 (D4) | ✔ | ✔ | 968 long-press on Gardé opens the picker, « Créer et ranger » made « Preuve ship »; 412 chevron, existing board. Tap on Gardé in the sheet: fiche opens, 0 open dialogs, fiche lists the board. |
| I-14 (D5) | ✔ | ✔ | « Bouton « Product » » CSS has `.bouton:hover { background: #1f1f1f; color: #f7f8f8; }`; Copier le CSS read back from the clipboard with it. |
| I-16 (C2) | ✔ | | Family cards show one crop per role: nematis Work Sans Display 50/60, Titre 45/54, Corps 24/29; linear Inter Titre 40/44 and Corps 15/24. See D14, D15. |
| I-18 (D7) | ✔ | ✔ | `#186063` + Enter: sheet closes and stays closed, filter chip `#186063`, Maison Cyrah Δ 0. |
| I-19 (D11) | ✔ | ✔ | Sans raison: tabs go Palettes 4 → 2, Typos 5 → 4, and back when released. |
| I-22 (D8) | ✔ | ✔ | « Preuve ship » mosaic: component crop, two palettes as colour stripes, mood crop. |
| I-24 (D12) | ✔ | ✔ | Typography pack of 5 items from 4 hosts at each size, ZIP downloaded; both `tokens.json` VALID against the DTCG 2025.10 schema; every `letterSpacing` is `{"value":0,"unit":"px"}` (these pages set no tracking; non-zero em→px is covered by `test/tokens.test.ts`). |
| I-26 | ✔ | ✔ | v1 copy: banner « Capturée avec DRD v1 », Réanalyser, then « analyse v2 partielle » with the partial banner. linear v1 → Fond #08090a, Surface #0f1011, Texte #f7f8f8, Texte 2 #8a8f98, Bordure #ffffff. |
| I-28 (D10) | ✔ | ✔ | Offline on Analyse: one « Hors ligne » banner, analysis from cache. |
| I-29 | ✔ | ✔ | 968: Écarter p-com.studio (gone after reload), Capturer jeremiahshoaf.com → ready. 412: Écarter threadless.com (gone after reload), Capturer sharptype.co (site answered 429, shown with Réessayer), Capturer machinepro.club → ready. The extra leads at 412 came from a why naming two footer-link hosts, which is how the taste profile scores leads. |
| D6 | ✔ | | `maisoncyrah.fr` without scheme: no browser bubble (`novalidate`), server answered « Déjà capturé le 30/09 ». |

**968: 29 ✔, 0 ◐, 0 ✖. 412: 29 ✔, 0 ◐, 0 ✖.** Rows not listed here keep
their S9 result (✔ at both sizes).

### Open, not blocking

| | Defect |
|---|---|
| D13 | 412: the picked colour row's text column is ~70 px wide beside the confidence dot and two buttons, so `oklch(0.649 0.015 262)` breaks mid-number over three lines. Everything is visible. |
| D14 | nematis Titre specimen « Référencement naturel » (45 px) is cut at « Référenc »: the crop follows the element box, the text overflows it. |
| D15 | linear has no Display specimen: its 64 px h1 is the one style of 14 without a crop, so only Titre and Corps show. |
| D16 | Library palette rows: narrow bands clip their hex label (`#12121…`, `#d5360…`). |

## After S9: fixes 6f69b80 and 0888dd3 (30/09, 12:15–13:10 UTC), deployed in the ship pass

Verdict at the time: NO-SHIP until the deploy and the prod re-shoot above.

P1/M1 were measured in a throwaway container with prod's limits (2 GB,
same seccomp, tmpfs), the working tree mounted, cgroup sampled every
100 ms (kernel 5.15 has no `memory.peak`; "peak" is memory.current minus
inactive_file, what docker stats shows):

| nematis | before (f626f25) | after (0888dd3) |
|---|---|---|
| result | chrome OOM-killed in 2 of 2 runs, capture failed at 150 s | ready in 52.9 s (load 2.5, scroll 4.4, dom 2.2, fonts 3.1, tiles 24.5, stitch 1.6, hover 12.2, specimens 2.2) |
| peak | 2048 MB (the limit) | 1521 MB, oom_kill 0 |
| CPU | n/a | 136 s, from 279 s three changes earlier |

Causes found, each measured: hiding nematis' fixed 3D canvas made it replay
the hidden time when shown (5 s hidden gave a 24 s stall, 20 s gave 57 s);
`stats()` on an extract of a raw frame read the whole frame (~0.5 s per
crop, 20 ms materialised); the renderer's garbage outgrew the 2 GB limit
between two collections of its own (1.86 GB, 0.93 GB with a collection every
200–300 ms). Not reached: 1 GB. At the end of the reveal pass the page's own
renderer holds ~1.2 GB (memory-infra: canvas 632 MB, malloc 671 MB) plus
three Cloudflare Stream players; one renderer process for all frames saved
170 MB and was not kept.

C1 on asi0's two legacy palettes, run on a copy of prod data: linear.app
18 raw colours → Fond #08090a, Surface #0f1011, Texte #f7f8f8, Texte 2
#8a8f98, Bordure #ffffff (no accent: v1 never saw the lime); mamielasagnes
11 → Fond #f6eccc, Surface #ffffff, Texte #321108, Texte 2 #121212, Accent
#d5360d, Accent 2 #9a905c, Bordure #0b4951. why/what/tags untouched, v1
payload kept in `provenance.rederived.previous`, idempotent on a second run.
Every v2 capture's palette is unchanged except nematis, which loses #ff0000.

Tests: 24 pass, typecheck and build clean.

Done in the ship pass above.

## S9: every interaction on prod (30/09, 11:20–12:10 UTC)

How: a dedicated account `maia-proof+drd@alysis.cat`, created through the
app's own register form with the instance invite code, used in headless
Chromium on https://dnd.alysis.cat at 968 × 875 and 412 × 915 (dark scheme,
DPR 1, touch at 412, clipboard permission granted so copies were read back).
Captures: maisoncyrah.fr (×2), linear.app, www.nematis.com, mamielasagnes.fr,
example.com/.org/.net/.edu, www.iana.org, httpbin.org/status/503 (failure),
p-com.studio, fontshare.com, typewolf.com. Screenshots of third-party pages:
`docs/proof-private/s9/` (gitignored).

asi0's data: backup `data/backups/drd-20260930-pre-s9-proof.sqlite` before,
`…-pre-proof-account-delete.sqlite` before the deletion. Fingerprint of
every row he owns (users, captures 8, elements 333, links 206, analyses 8,
findings 233, items 4, item_colors 30, fts 4, boards 1, board_items 2,
signals 4, blobs 5) plus his 518 media files and 5 blob files:
`f80bc4a579891a5826afa61b` before and after, identical table by table.

The account was deleted at the end: `DELETE FROM items_fts` for its items,
then `DELETE FROM users` with `foreign_keys=ON` (cascade: 15 captures, 13
items, 5 boards, 2 packs, 2 sessions, 2 candidates, 20 signals), its 15
media folders removed, 41 unreferenced blobs collected. No orphan elements
or analyses; `integrity_check` ok; one user left.

Result: ✔ observed; ◐ works with a defect or only part observed; ✖ not
proven. **968: 22 ✔, 7 ◐, 0 ✖. 412: 24 ✔, 5 ◐, 0 ✖.**

| # | 968 | 412 | Observed on prod |
|---|---|---|---|
| I-01 Capturer une URL | ✔ | ✔ | Live stages shot at each step (maisoncyrah 18.7 s, linear 42 s, nematis 131.6 s, mamielasagnes 42 s). Defect D1: between the capture and its analysis the row showed « analyse v1 » with no stages. |
| I-02 Capturer par partage | ✔ | ✔ | Manifest `share_target` is `GET /share` with title/text/url. A navigation to `/share?text=Regarde ça https://example.com/ …` (what Chrome's share sheet sends) opened the new capture's progress, signed in, both sizes. No Android device: the OS share sheet itself was simulated. |
| I-03 Capturer par raccourci | ✔ | ✔ | Signed in: `dnd.alysis.cat/https://example.net/` → capture page. Signed out (fresh context): login page shows « À capturer après connexion : … », login → capture starts. |
| I-04 Suivre et réessayer | ✔ | ✔ | httpbin 503: « Le site a répondu 503. » + Réessayer; each retry is a new row, the attempts list keeps all three. |
| I-05 Changer d'onglet | ◐ | ✔ | Six tabs swap content and hash; back returns to the previous tab. Sticky checked at 412 (tab bar at top after 763 px scroll), not at 968. |
| I-06 Choisir une couleur | ◐ | ◐ | Band gets `aria-pressed`, detail row updates. Defect D2: the row clips OKLCH/hex/uses with an ellipsis (hex hidden at both sizes). |
| I-07 Localiser | ✔ | ✔ | 968: pane outlines (Texte 2: 1, component: 1). 412: « Accent localisé à 8 endroits » opens the full-screen viewer with 8 outlines. |
| I-08 Copier une valeur | ✔ | ✔ | Clipboard read back: `#374151`, `oklch(0.373 0.031 260)`, `oklch(…) /* #… */`; toast « Copié ». |
| I-09 Garder en un tap | ✔ | ✔ | Gardé after 35 ms (968) / 21 ms (412); item in its library. |
| I-10 Dire pourquoi | ✔ | ✔ | Chip + typed text saved to `why`, shown in the row, chip became a tag. |
| I-11 Annuler | ✔ | ✔ | Library count 1 → 0, button back to Garder, toast « Retiré de la bibliothèque ». |
| I-12 Ranger dans un tableau | ◐ | ✔ | Long-press (968) and chevron (412) open the picker; board created/used; fiche lists the board. Defect D4: tapping Gardé in the component sheet opens the fiche under the still-open sheet. |
| I-13 Doublon proche | ✔ | ✔ | Recaptured maisoncyrah: « Proche de « Maison Cyrah » (Palettes) » / « Accent #186063 »; Fusionner left one item with both reasons and 2 sources. |
| I-14 Inspecter un composant | ✔ | ✔ | Sheet: rest + hover crops, token table, CSS, Copier le CSS (clipboard checked), Garder. Defect D5: the CSS ignores the hover diff. |
| I-15 Lire un contraste | ✔ | ✔ | « Aa » on the real pair, ratio, grade; white on accent 2 2,0 échec. |
| I-16 Voir l'échelle typo | ✔ | ✔ | Real crops with size/lh/weight/tracking; « Échelle libre … meilleur rapport à 2,2 %, non retenu ». |
| I-17 Chercher | ✔ | ✔ | `lineaire` and `sombre maitrise` find « Linear » (accents ignored); `serif chaud` counts Typos 2 across tabs. |
| I-18 Filtrer par teinte | ◐ | ✔ | Pasted `#186063` → 2 items Δ 0; ring tap at 110° → Linear (#e4f222 Δ 0.011). Defect D7: Enter in the hex field reopens the sheet. |
| I-19 Filtrer | ◐ | ◐ | Sans raison, Source, Tableau, Serif, Bouton, Clair all filter the list. Defect D11: with Sans raison the library tab counts do not change. |
| I-20 Ouvrir une fiche | ✔ | ✔ | Detail pane / page; why edited inline survives a reload and shows in the row. |
| I-21 Sélectionner plusieurs | ✔ | ✔ | Bar « 2 sélectionnés · Ajouter au tableau · Exporter · Supprimer »; add worked; Supprimer asks for confirmation (confirmed at 968, cancelled at 412). |
| I-22 Créer et parcourir un tableau | ✔ | ✔ | Boards created at both sizes; « Preuve S9 » is a mixed grid (component, mood, 2 palettes). Defect D8: the cover mosaic leaves palette cells empty. |
| I-23 Copier en CSS / Tailwind / JSON | ✔ | ✔ | Clipboard contents: `:root` block, `@theme` block, DTCG JSON; the JSON passes the official schema, the `@theme` compiles with Tailwind 4.3.3. |
| I-24 Exporter un pack agent | ✔ | ◐ | Refusal for a one-host selection (button disabled), « Seulement 2 sources », missing-reason warnings, ZIP downloaded at both sizes. The typography pack (412) failed DTCG validation: D12. |
| I-25 Composer dans l'Atelier | ✔ | ✔ | Palette + typo re-render the mini page; « Garder le mélange » created a board. |
| I-26 Réanalyser | ◐ | ◐ | Réanalyser on a v2 capture replaced its analysis (new id, both sizes). The partial path needs a v1 capture; only asi0 owns v1 captures on prod, so it was not exercised with the proof account. |
| I-27 Supprimer une capture | ✔ | ✔ | Deleted captures with kept items: capture 404, every kept blob still 200 (typo 3, component 2, mood 6, scale 7), fiches show their images. |
| I-28 Hors ligne | ✔ | ✔ | Service worker controlled, offline emulation: analysis, library and fiche from cache with « hors ligne · cache », why disabled, Garder disabled with its reason. D10: two stacked offline banners on Analyse. |
| I-29 Accepter une piste | ◐ | ◐ | 968: Capturer on p-com.studio started and finished a capture. 412: Écarter on jeremiahshoaf.com hid it, and a refresh did not bring it back. Only one candidate existed at a time, so each size saw one of the two actions. |

### Defects found

| | Defect | State (ship pass, 0b8f9fb on prod) |
|---|---|---|
| D1 | Capture row reads « analyse v1 » without stages in the gap before the analysis starts | fixed, observed on prod |
| D2 | Picked colour row clips hex/OKLCH/uses | fixed (wraps), observed on prod; D13 is what remains at 412 |
| D3 | « 1 styles »: counts without singular | fixed in source and deployed, not re-observed: no capture on prod had a count of 1 |
| D4 | A sheet stays open over the next screen | fixed, observed on prod |
| D5 | Component CSS snippet has no `:hover` rule | fixed, observed on prod |
| D6 | `type=url` field refuses `maisoncyrah.fr` with an English browser bubble | fixed, observed on prod |
| D7 | Enter in the hue sheet's hex field reopens the sheet | fixed, observed on prod |
| D8 | Board mosaic empty for palette items | fixed, observed on prod |
| D10 | Two offline banners on Analyse | fixed, observed on prod |
| D11 | Library tab counts ignore « Sans raison » | fixed, observed on prod |
| D12 | Typography `letterSpacing` exported in `em`: invalid DTCG 2025.10 | fixed + `test/tokens.test.ts`; prod packs VALID |
| C1 | Legacy « Palette — linear.app » (asi0's, v1): 18 raw colours incl. `#00ff05`, `#f34e52`, `#f79ce0`, theme wrongly `light`. Same class in v2: nematis Accent `#ff0000` from 4 elements, 0.07 % of text (fallback rule « chroma × usage » with no floor) | fixed; asi0's two palettes re-derived on prod (his OK), nematis on prod has no accent |
| C2 | Legacy « Typographies — linear.app »: samples are the first 4 elements by y (nav pills « Resources », « Linear », « Pulse ») | fixed (role specimens), observed on prod; D14, D15 open |
| P1 | nematis capture 127.6 s on prod (deadline 150 s) | fixed: 52.2 s on prod |
| M1 | Chrome renderer OOM-killed in the drd cgroup | fixed: peak 1333 MiB, oom_kill 0; the 1 GB target dropped by decision |

C1, analysed on the stored captures with the current analysis (read-only
probe): two rule changes give the curated result the spec asks for. (a) For
v1 captures (no grid samples), a colour whose pixel cluster covers ≥ 3 % of
the page is background area even if v1 noted it as text: linear v1 then gets
Fond `#08090a` (69 %), Surface `#0f1011`; mamielasagnes v1 gets exactly its
v2 roles (Fond `#f6eccc`, Surface `#ffffff`, Accent `#d5360d`, Accent 2
`#9a905c`). (b) The accent fallback needs a floor (≥ 0.5 % of text or
surface, or pixel-confirmed): nematis loses the `#ff0000` accent, linear v1
loses the pink/orange guessed with zero usage. Kept items then need a
start-up repair (like `repairLegacyItems`) that re-derives roles from the
same capture and moves the rest to `others`; that changes asi0's two legacy
items, so it needs his OK and a backup, which is why it is not done.

C2: role specimens (display: h1 64 px « The product development system… »,
titre: h2 40–48 px, corps: the 16 px run) exist in the same capture's
elements; family findings should carry one crop per role and the fiche
should show them. Not done.

P1 and M1. New step timings (`meta.budget.timings`, one log line per
capture, committed) on a local run of nematis: load 2.6 s, scroll 7.4, dom
2.4, fonts 3.5, network 0.1, tiles 18.1, stitch 4.6, **hover 27.2**,
**specimens 10.4** (76 s). Hover and specimens take a full DPR-2 viewport
PNG per target; tiles decode the full PNG again for every crop. The same run
inside the drd container (separate data dir under `/tmp`) was OOM-killed at
12:05:01 UTC: kernel log `Memory cgroup out of memory: Killed process
1259085 (chrome) anon-rss:1519996kB` in the drd cgroup. That was my
profiling run, the only `oom_kill` since the container started (cgroup
`memory.events`: oom_kill 1, max 9231). The server process survived
(RestartCount 0, no error lines in the log, `/healthz` ok); the killed run
was a throwaway with its own data dir, and no user capture or request was
in flight. Still, one nematis renderer reaches 1.5 GB of the 2 GB limit, so
a user capture beside the server is one bad page away from the same kill:
the bound (clip screenshots for hover/specimen, decode each tile once, cap
the renderer heap or close the page between passes) is open, and the new
timing has not been re-measured on prod.

Validators: DTCG with the official 2025.10 JSON schema
(`designtokens.org/schemas/2025.10/format.json`, ajv, all refs): the board
pack and both clipboard JSONs valid; the typography pack invalid (7 ×
`letterSpacing.unit` must be px or rem); the same items re-exported after the
D12 fix valid. Negative controls (2 components, `colorSpace: "nope"`, bare
hex) rejected. Terrazzo `tz check` 2.7.1 accepted the invalid controls, so
it is not used as evidence. Tailwind v4.3.3 compiled both packs' `theme.css`
and generated `bg-linear-background`, `rounded-maison-cyrah-link-button`,
`text-nematis-accent`.

### Blockers before SHIP (all cleared in the ship pass)

1. Deploy the committed fixes and re-shoot I-06, I-12, I-18, I-19, I-24 on
   prod: done.
2. C1 and C2, with asi0's OK for the repair of his two legacy items: done.
3. P1/M1: done, 52.2 s and 1333 MiB on prod; 1 GB dropped by decision.
4. D5, D8, D10; I-26 partial path on a v1 capture; I-29 both actions at
   each size: done.

## Build run record (before S9)

Where it was observed:

- **prod**: the `drd` container on 127.0.0.1:4354 (dnd.alysis.cat), checked
  through the API, the database and scripts run inside the container.
- **local**: the same commit, served on 127.0.0.1:5791 from a copy of the
  prod data taken after migration 3.


Screenshots of real sites are in `docs/proof-private/`, which is gitignored
because the repository is public.

## Deploys

| When (Paris) | Commit | Schema | What |
|---|---|---|---|
| ~12:15 | 966d869 | 2 | S0 capture pipeline, with old UI |
| ~15:40 | 060786f | 3 | S1 to S8 together, because S1 removes the routes the old UI calls |
| 15:13 | e58d31e | 3 | crash-looped (EACCES, 0600 sources); replaced at 15:15 by the same tree with the modes fixed, healthy, legacy palettes re-derived |
| 15:18 | 0b8f9fb | 3 | the Dockerfile fix; running since, RestartCount 0 |

After the second deploy, /healthz returned `schema 3, browser ready,
sandbox enabled`. The start-up log shows `applied 3` and that legacy items
got their extracted pictures: 9f3d4875, 0bb0e8ae, 2a5c8294, 02237c32.

## Database, before and after migration 3

Backup: `data/backups/drd-20260930-pre-migration3.sqlite` (integrity ok).
Earlier backups: `…-pre-s0.sqlite` and `…-pre-failed-cleanup.sqlite`.

| Table | Before | After |
|---|---|---|
| users | 1 | 1 |
| captures | 6 | 6, then 8 after two recaptures |
| capture_elements | 333 | 333 |
| capture_links | 143 | 143 |
| refs → items | 4 | 4, same ids |
| collections → boards | 2 | 1 board with 2 members; the inbox became no board |
| packs | 0 | 0 |
| blobs | none | 5 |

Every `why` survived verbatim. "Notre Carte" still has its 138 characters.

## Captures and analyses on prod

| Capture | How | Result |
|---|---|---|
| creamontblanc.org/fr | recaptured | 19572992 ready in 24.3 s, 1280 × 6827 |
| www.nematis.com | recaptured | bf1d56a3 ready in 115.5 s, 1280 × 8823 |
| maisoncyrah.fr | recaptured | 5904c8a4 ready in 16.8 s |
| linear.app | recaptured | d3fc94c4 ready in 41.3 s |
| mamielasagnes.fr | recaptured | 566f4b31 ready in 38.4 s |
| failed rows e9865a16, 9ef10c7d, 9b02b200 | deleted after their replacement was ready | 0 failed rows left |
| linear, maisoncyrah, mamielasagnes (the v1 captures) | Réanalyser job | analysis v2, partial = 1 |
| the 5 v2 captures | analysis job | analysis v2, full |

The fix behind the two old failures: navigation now waits for
`domcontentloaded` plus a bounded network settle, instead of `networkidle2`,
which never fires on a page that keeps a connection open. The deadline went
from 60 s to 150 s. nematis at 115 s is close to that limit.

## Measured against the audit (§2.2)

| Check | Audit / spike | Now (prod, analysis v2) |
|---|---|---|
| maisoncyrah Fond | `#f8f6f0` 37.7 % of pixels; that figure included the W2 blank band | `#f8f6f0` 30.3 % on the v2 page (37.4 % on the v1 page) |
| maisoncyrah Accent | `#186063` 10.2 % | `#186063` 10.1 %, role Accent |
| maisoncyrah contrasts | white on accent 7.3; accent on fond 6.7; white on sand 2.0, fail | 7.3 AAA; 6.7 AA; 2.0 échec |
| linear Fond | `#08090a` 67.1 % | `#08090a` 69.5 % |
| linear second background | oklch(0.173 …) 11.7 % | Surface `#101112` 10.0 % |
| linear lime | 1.5 %, absent from the DOM top 18 | Accent `#e4f222` 1.7 % |
| Font samples are real text (W5) | samples were script source | 0 script-like samples across all 8 analyses |
| Component crops (W3) | card 0/18, nav 0/11 | every component has a non-blank crop: 5/5, 30/30, 20/20, 12/12, 12/12 |
| Type crops | none | 14/14 maisoncyrah, 13/14 linear, 13/14 mamielasagnes, 12/12 creamontblanc, 13/14 nematis |
| No blank band (W2), maisoncyrah | v1 had uniform 100 px strips at 2900–3600 and 3700–4200 | longest uniform run is 200 px (section padding); 38 text runs below the fold, 0 painted blank |

## Tests (final run, npm test: 19 pass, 0 fail)

- `test/capture.test.ts`: the real pipeline on a scroll-revealed fixture.
- `test/migration.test.ts`: migration 3 loses nothing. I confirmed it fails red when board memberships are dropped.
- `test/analyse.test.ts`: two fixture pages, light serif and dark sans. It checks roles, the 1.25 scale, the failing sand pair and the card counts. The fixtures are captured live rather than recorded.
- The 15 tests that already existed (auth, url-guard, pack zip, shared memory). The suite runs files one at a time (`--test-concurrency=1`) because two files serve the fixture page on the same port.

`typecheck` and `build` are clean.

Not done: DTCG validation of `tokens.json` with a validator, and compiling
`theme.css` with Tailwind v4. Both are required by S6.

## asi0's rule (30/09 12:47): an item shows the extracted thing

| Item | 968 | 412 |
|---|---|---|
| Composant "Notre Carte": isolated heading with the heart, its CSS, the why verbatim | `docs/proof-private/968-bibliotheque-composants.png` | `docs/proof-private/412-bibliotheque-composants.png`, `…/412-fiche-notre-carte.png` |
| Palette mamielasagnes: colour bands with role and hex, no screenshot | `docs/proof-private/968-bibliotheque-palettes.png`, `…/968-fiche-palette-mamielasagnes.png` | `docs/proof-private/412-bibliotheque-palettes.png`, `…/412-fiche-palette-mamielasagnes.png` |

How each item type renders:

- palette: bands
- colour: one band
- type: style crops, specimens, OFL files set live, or crops cut from the page for v1 items
- component: its crop or a live re-render, plus the CSS
- scale: drawn with DRD's own CSS
- mood: the image crops only
- page: a metadata card

Board views use the same rows.

## Interactions at the end of the build run

Superseded by the S9 table above.
