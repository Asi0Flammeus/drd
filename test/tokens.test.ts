/**
 * DTCG 2025.10 allows only px and rem for dimensions. Text styles store
 * their tracking in em; exported as em, every typography token of a pack
 * failed the official schema (S9, 30/09).
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { toDtcg, toTailwind } from "../server/export/tokens.ts";
import type { ItemView } from "../server/library/index.ts";

// Only the fields the exporter reads; the rest of ItemView is irrelevant here.
const scale = {
  id: "i1",
  kind: "type",
  subkind: "scale",
  title: "Échelle",
  why: "titres serrés",
  sourceHost: "example.com",
  sourceUrl: "https://example.com/",
  data: { styles: [{ role: "display", family: "Inter", size: 64, weight: 600, lineRatio: 1.05, tracking: -0.02 }] },
  provenance: {},
} as unknown as ItemView;

test("typography letter spacing leaves the exporter in px, at the style's size", () => {
  const tokens = JSON.stringify(JSON.parse(toDtcg([scale])));
  assert.match(tokens, /"letterSpacing":\{"value":-1\.28,"unit":"px"\}/);
  assert.doesNotMatch(tokens, /"unit":"em"/);
  assert.match(toTailwind([scale]), /--text-display--letter-spacing: -1\.28px;/);
});
