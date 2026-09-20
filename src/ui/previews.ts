/**
 * The preview surfaces, shared by the playground and the library.
 *
 * Each one is markup plus class names only: every value it displays arrives as
 * a custom property on an ancestor. That is the whole reason a library card and
 * a full-size playground stage can be the same component at two sizes.
 */

import { h, icon, ICONS } from "./controls";
import { SAMPLES } from "../data/fonts";
import { familyById } from "../data/fonts";
import type { ColorRoles } from "../data/palettes";
import type { CompSpec, TypeSpec, Workspace } from "../state";
import { applyVars, previewVars } from "../tokens";

/** A throwaway workspace so a library entry can be rendered with its own spec. */
export function varsForSpec(ws: Workspace, patch: Partial<Workspace>): Record<string, string> {
  return previewVars({ ...ws, ...patch });
}

export function miniSpecimen(spec: TypeSpec): HTMLElement {
  const sample = SAMPLES.find((s) => s.id === spec.sample) ?? SAMPLES[0];
  return h("div", { class: "mini mini-type" }, [
    h("p", { class: "specimen-display mini-display", text: sample.heading }),
    h("p", { class: "specimen-body mini-body", text: sample.body.slice(0, 130) + "…" }),
    h("p", {
      class: "mini-caption",
      text: `${familyById(spec.displayFamily).name} × ${familyById(spec.bodyFamily).name}`,
    }),
  ]);
}

export function swatchRow(ramp: string[], accent: { soft: string; solid: string; deep: string }): HTMLElement {
  const row = h("div", { class: "swatch-row" });
  ramp.forEach((hex, i) => {
    row.append(h("span", { class: "swatch-cell", style: `background:${hex}`, title: `step ${i + 1} · ${hex}` }));
  });
  for (const [name, hex] of Object.entries(accent)) {
    row.append(h("span", { class: "swatch-cell swatch-accent", style: `background:${hex}`, title: `${name} · ${hex}` }));
  }
  return row;
}

/** Buttons render from one class per variant; all six read the same comp tokens. */
export function buttonSet(variantId: string, compact = false): HTMLElement {
  const label = (text: string) => h("span", { class: "pv-btn-label", text });
  const primary = h("button", { type: "button", class: `pv-btn pv-btn--${variantId}` }, [label("Réserver une table")]);
  const secondary = h("button", { type: "button", class: `pv-btn pv-btn--${variantId} is-secondary` }, [
    label("Voir la carte"),
  ]);
  const row = h("div", { class: "pv-btn-row" }, compact ? [primary] : [primary, secondary]);
  return row;
}

/**
 * The mockup. Deliberately a real fragment of a client page — surface, raised
 * card, heading, body, price, badge, a field and two buttons — because a row of
 * swatches never shows that step 6 is invisible against step 2.
 */
export function mockup(variantId: string): HTMLElement {
  const nav = h("div", { class: "mk-nav" }, [
    h("span", { class: "mk-brand", text: "L'Entre-Deux" }),
    h("nav", { class: "mk-links" }, [
      h("span", { text: "Carte" }),
      h("span", { text: "Producteurs" }),
      h("span", { class: "is-current", text: "Réserver" }),
    ]),
  ]);

  const card = h("article", { class: "mk-card" }, [
    h("div", { class: "mk-thumb" }, [h("span", { class: "mk-thumb-note", text: "16 / 9" })]),
    h("div", { class: "mk-card-body" }, [
      h("div", { class: "mk-card-head" }, [
        h("span", { class: "mk-badge", text: "Menu du jour" }),
        h("span", { class: "mk-price", text: "24,00 €" }),
      ]),
      h("h3", { class: "mk-title", text: "Lieu jaune, beurre blanc au cidre" }),
      h("p", {
        class: "mk-body",
        text:
          "Pêché au large de Belle-Île le matin. Servi avec les pommes de terre de Jean-Marc, " +
          "qui livre le mardi et le vendredi.",
      }),
      h("div", { class: "mk-field" }, [
        h("label", { class: "mk-label", for: "mk-covers", text: "Nombre de couverts" }),
        h("input", { class: "mk-input", id: "mk-covers", type: "text", value: "4 personnes" }),
      ]),
      buttonSet(variantId),
    ]),
  ]);

  const strip = h("div", { class: "mk-strip" }, [
    h("div", { class: "mk-stat" }, [
      h("span", { class: "mk-stat-value", text: "4,9" }),
      h("span", { class: "mk-stat-label", text: "Note Google · 212 avis" }),
    ]),
    h("div", { class: "mk-stat" }, [
      h("span", { class: "mk-stat-value", text: "12" }),
      h("span", { class: "mk-stat-label", text: "Places en terrasse" }),
    ]),
    h("div", { class: "mk-note" }, [icon(ICONS.check, 14), h("span", { text: "Confirmation immédiate" })]),
  ]);

  return h("div", { class: "mockup" }, [nav, card, strip]);
}

export function miniPalette(ws: Workspace, patch: Partial<Workspace>, roles: ColorRoles): HTMLElement {
  const wrap = h("div", { class: "mini mini-palette" }, [
    swatchRow([
      roles.surface,
      roles.surfaceRaised,
      roles.fill,
      roles.lineSoft,
      roles.line,
      roles.lineStrong,
      roles.neutralSolid,
      roles.inkDim,
      roles.ink,
    ], { soft: roles.accentSoft, solid: roles.accent, deep: roles.accentDeep }),
    h("div", { class: "mini-mock" }, [
      h("p", { class: "mini-mock-title", text: "Menu du jour" }),
      h("p", { class: "mini-mock-body", text: "Lieu jaune, beurre blanc au cidre — 24,00 €" }),
      buttonSet(ws.components.variantId, true),
    ]),
  ]);
  applyVars(wrap, varsForSpec(ws, patch));
  return wrap;
}

export function miniComponent(ws: Workspace, spec: CompSpec): HTMLElement {
  const wrap = h("div", { class: "mini mini-comp" }, [
    buttonSet(spec.variantId),
    h("p", { class: "mini-caption", text: `radius ${spec.radius}px · ${spec.duration}ms · travel ${spec.travel}px` }),
  ]);
  applyVars(wrap, varsForSpec(ws, { components: spec }));
  return wrap;
}
