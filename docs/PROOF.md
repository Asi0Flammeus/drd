# DRD redesign: proof

Status on 2026-09-30, end of the build run. This is a record of what was
observed, not a ship verdict: S9 (the full review of every interaction on
the real surface) is **not done**, and the rows below say where evidence is
missing.

Where it was observed:

- **prod**: the `drd` container on 127.0.0.1:4354 (dnd.alysis.cat), checked
  through the API, the database and scripts run inside the container.
- **local**: the same commit, served on 127.0.0.1:5791 from a copy of the
  prod data taken after migration 3. Screenshots come from headless Chromium
  with dark scheme emulated, signed in to asi0's account through a session
  opened on that copy.

I could not sign in to prod in a browser: asi0's password is not available
to me, and I did not create a session on prod for his account. So every UI
screenshot is from the **local** instance.

Screenshots of real sites are in `docs/proof-private/`, which is gitignored
because the repository is public.

## Deploys

| When (Paris) | Commit | Schema | What |
|---|---|---|---|
| ~12:15 | 966d869 | 2 | S0 capture pipeline, with old UI |
| ~15:40 | 060786f | 3 | S1 to S8 together, because S1 removes the routes the old UI calls |

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

## Interactions (§7)

Result: ✔ observed; ◐ partly observed; ✖ not proven, with the reason.

| # | 968 | 412 | Observed, or why not |
|---|---|---|---|
| I-01 Capturer une URL | ◐ | ◐ | On prod, 7 captures went through the stages load → scroll → measure → pixels → analyse → done, read from `captures.stage`. The live stage row in the UI was not screenshotted. |
| I-02 Capturer par partage | ✖ | ✖ | `/share` and the manifest `share_target` are shipped. Not exercised on the real phone: I had no access. |
| I-03 Capturer par raccourci | ✖ | ✖ | The splat and login-replay code paths are kept, but not exercised in this run. |
| I-04 Suivre et réessayer | ✖ | ✖ | Réessayer and `POST /retry` (a new attempt beside the old one) are implemented. The UI was not exercised, and the failed rows were removed at asi0's request. |
| I-05 Changer d'onglet | ◐ | ◐ | Palette, Typo, Composants, Échelles and Ambiance render at 968 and Palette at 412, with the hash updated. Back and the sticky tabs while scrolling were not checked. |
| I-06 Choisir une couleur | ◐ | ◐ | The detail row shows role, OKLCH · hex, area and text share, and uses (Accent). Only the default selection was observed; no tap was scripted. |
| I-07 Localiser | ◐ | ◐ | 968: the Accent outlines are drawn on the page pane. 412: the row "Accent localisé à 8 endroits" appears. The full-screen viewer was not opened. |
| I-08 Copier une valeur | ✖ | ✖ | Copy buttons are wired to the "Copié" toast. The clipboard was not verified. |
| I-09 Garder en un tap | ✖ | ✔ | local 412: Garder turned into Gardé at once and the item appeared in Palettes (`412-analyse-palette-maisoncyrah.png` shows the state before the tap). |
| I-10 Dire pourquoi | ✖ | ✔ | local 412: the chip "un seul accent" plus typed text were saved to `why`, shown in the library row, and the chip became a tag (`968-bibliotheque-palettes` was taken from a later copy, so this row is not in it). |
| I-11 Annuler | ✖ | ✖ | Implemented (`DELETE` then back to Garder); not exercised. |
| I-12 Ranger dans un tableau | ✖ | ✖ | Picker implemented (long-press, chevron, Tableau…); not exercised. |
| I-13 Doublon proche | ✖ | ✖ | Server duplicate rules and merge are implemented; not exercised. |
| I-14 Inspecter un composant | ✔ | ✖ | local 968: the sheet shows the default and hover crops (sand, then dark on hover), the token table with roles, the CSS, Copier and Garder. |
| I-15 Lire un contraste | ✔ | ✔ | "Aa" in the real pair, ratio, grade; white on sand 2.0 is marked échec. |
| I-16 Voir l'échelle typo | ✔ | ✖ | Styles as real crops with size, line height, weight and tracking; the verdict line reads "Échelle libre" (the error of the best ratio is shown). |
| I-17 Chercher | ◐ | ◐ | API only: `q=maitrise` found "sombre maîtrisé" (FTS5, diacritics removed). Not typed in the UI. |
| I-18 Filtrer par teinte | ◐ | ✖ | API only: a `#e4f222` query returns the matching item (migration test). The ring UI was not exercised. |
| I-19 Filtrer | ◐ | ◐ | The chips render with counts ("Sans raison 2"). Toggling was not exercised. |
| I-20 Ouvrir une fiche | ✔ | ✔ | Detail pane at 968, standalone page at 412: editable why, tags, boards, source link, date kept, duplicates, CSS / Tailwind / JSON, Exporter, Supprimer. |
| I-21 Sélectionner plusieurs | ✖ | ✖ | Implemented; not exercised. |
| I-22 Créer et parcourir un tableau | ✖ | ✖ | Implemented; `POST /api/boards` was checked on the API. |
| I-23 Copier en CSS / Tailwind / JSON | ◐ | ✖ | API: the copy endpoint returned a `@theme` block and DTCG JSON (`colorSpace oklch`). Clipboard and validators were not run. |
| I-24 Exporter un pack agent | ✖ | ✖ | Wizard and server rules (refusal, < 3 hosts, missing reasons) are implemented; no ZIP was downloaded in this run. |
| I-25 Composer dans l'Atelier | ◐ | ✖ | The Mélange screen renders with kept palettes and type (`968-atelier-melange.png`). Picking and "Garder le mélange" were not exercised. |
| I-26 Réanalyser | ◐ | ◐ | prod: 3 v1 captures went to analysis v2 with partial = 1 through the job behind the button. The UI tap was not recorded. |
| I-27 Supprimer une capture | ✖ | ✖ | The delete path (row, cascades, media folder) was used on prod for the failed rows, which had no kept items. Not proven for kept items keeping their crops. |
| I-28 Hors ligne | ✖ | ✖ | Cache reads and Garder disabled are implemented; not exercised. |
| I-29 Accepter une piste | ✖ | ✖ | Pistes live inside Captures. No candidates exist yet ("Aucune piste"). |

## Known gaps, in the order I would take them

1. The S9 browser pass on prod for every row above that is not ✔, which needs asi0's login or his OK for a proof account.
2. Validate `tokens.json` with a DTCG 2025.10 validator and compile `theme.css` with Tailwind v4 (required by S6).
3. Profile nematis (115 s of a 150 s budget).
4. On linear, the v2 Texte role is `#d0d6e0` while headlines are `#f7f8f8`; the audit's `#1d1e20` Texte for maisoncyrah is not present in the v2 DOM, which gives `#4b5563`.
5. `apca-w3` was not added: its licence is "Limited W3 License", which I did not confirm as compatible.
