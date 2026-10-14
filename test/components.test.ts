/**
 * The CSS a component sheet copies must carry what the hover pass saw
 * change: without it, a button copied from a site loses its hover (D5, S9).
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { componentCss } from "../server/analyse/components.ts";
import type { HoverStyle } from "../server/capture/artifacts.ts";
import type { ComponentTokenView } from "../server/analyse/findings.ts";

const tokens: ComponentTokenView = {
  background: { hex: "#186063", role: "Accent" },
  foreground: { hex: "#ffffff", role: null },
  border: null,
  radius: [999, 999, 999, 999],
  padding: [12, 24, 12, 24],
  height: 44,
  width: 160,
  gap: 0,
  font: { family: "Inter", size: 16, weight: 500, lineHeight: 20, letterSpacing: 0, transform: "none" },
  shadow: null,
  transition: null,
};

const rest: HoverStyle = { background: "24,96,99", color: "255,255,255", borderColor: null, boxShadow: "none", transform: "none", textDecoration: "none solid rgb(255, 255, 255)", opacity: "1" };

test("a button whose fill and shadow change on hover gets a :hover rule with the hovered values", () => {
  const css = componentCss("button", tokens, { before: rest, after: { ...rest, background: "14,74,76", boxShadow: "rgba(0, 0, 0, 0.2) 0px 4px 12px 0px" } });
  assert.match(css, /\.bouton:hover \{\n {2}background: #0e4a4c;\n {2}box-shadow: rgba\(0, 0, 0, 0\.2\) 0px 4px 12px 0px;\n\}$/);
  assert.match(css, /^\.bouton \{\n {2}background: #186063;/);
});

test("no :hover rule when hovering changes nothing visible", () => {
  const css = componentCss("button", tokens, { before: rest, after: { ...rest, boxShadow: "rgba(0, 0, 0, 0) 0px 0px 0px 0px" } });
  assert.doesNotMatch(css, /:hover/);
});
