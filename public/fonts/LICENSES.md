# Bundled typefaces

All five are licensed under the **SIL Open Font License, Version 1.1**
(<https://openfontlicense.org/>). The files here are the `latin` variable
subsets served by `fonts.gstatic.com` for the full axis range, downloaded
2026-09-16 via the Google Fonts CSS2 API. Copyright lines are reproduced
verbatim from each project's `OFL.txt` in `google/fonts`.

| File | Family | Copyright | Axes | Upstream |
|---|---|---|---|---|
| `bricolage-grotesque.woff2` | Bricolage Grotesque | Copyright 2022 The Bricolage Grotesque Project Authors | `opsz` 12–96, `wdth` 75–100, `wght` 200–800 | <https://github.com/ateliertriay/bricolage> |
| `fraunces.woff2` | Fraunces | Copyright 2018 The Fraunces Project Authors | `SOFT` 0–100, `WONK` 0–1, `opsz` 9–144, `wght` 100–900 | <https://github.com/undercasetype/Fraunces> |
| `recursive.woff2` | Recursive | Copyright 2020 The Recursive Project Authors | `CASL` 0–1, `CRSV` 0–1, `MONO` 0–1, `slnt` −15–0, `wght` 300–1000 | <https://github.com/arrowtype/recursive> |
| `anybody.woff2` | Anybody | Copyright 2020 The Anybody Project Authors | `wdth` 50–150, `wght` 100–900 | <https://github.com/Etcetera-Type-Co/Anybody> |
| `newsreader.woff2` | Newsreader | Copyright 2020 The Newsreader Project Authors | `opsz` 6–72, `wght` 200–800 | <https://github.com/productiontype/Newsreader> |

Axis ranges were read from Google Fonts' own family metadata
(`https://fonts.google.com/metadata/fonts`), not guessed, and the slider
bounds in `src/data/fonts.ts` match them exactly.

The full OFL 1.1 text ships with each upstream repository listed above; the
licence permits bundling and web-serving these files, requires this notice to
travel with them, and forbids selling the fonts on their own.
