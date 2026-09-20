/**
 * Playground · components.
 *
 * Six button recipes and three micro-interactions, all reading the same
 * component tokens. The point of showing the other five variants next to the
 * selected one is that a radius or a duration that flatters one recipe usually
 * ruins another, and you only see that side by side.
 */

import { EASINGS, nearestDurationToken, VARIANTS } from "../data/components";
import { applyVars, previewVars } from "../tokens";
import { chips, fieldset, h, ICONS, slider, textButton, toggle } from "../ui/controls";
import { buttonSet } from "../ui/previews";
import { saveEntry } from "./save";
import type { Panel, ViewContext } from "./view";

export function buildComponentPanel(ctx: ViewContext): Panel {
  const spec = ctx.ws.components;
  const selected = VARIANTS.find((v) => v.id === spec.variantId) ?? VARIANTS[0];

  /* ------------------------------------------------------------- stage --- */

  const hero = h("div", { class: "comp-hero" }, [
    h("p", { class: "comp-hero-label", text: selected.name }),
    buttonSet(spec.variantId),
    h("p", { class: "comp-origin", text: selected.origin }),
    h("p", { class: "comp-use", text: selected.use }),
  ]);

  const grid = h("div", { class: "comp-grid" });
  for (const variant of VARIANTS) {
    const cell = h("div", { class: `comp-cell${variant.id === spec.variantId ? " is-current" : ""}` }, [
      h("span", { class: "comp-cell-name", text: variant.name }),
      buttonSet(variant.id, true),
    ]);
    cell.addEventListener("click", () => {
      spec.variantId = variant.id;
      ctx.rebuild();
    });
    grid.append(cell);
  }

  const switchDemo = h("button", { type: "button", class: "pv-switch", role: "switch", "aria-checked": "false" }, [
    h("span", { class: "pv-switch-knob" }),
  ]);
  switchDemo.addEventListener("click", () => {
    switchDemo.setAttribute("aria-checked", switchDemo.getAttribute("aria-checked") === "true" ? "false" : "true");
  });

  const liftCard = h("div", { class: "pv-lift-card", tabindex: "0" }, [
    h("span", { class: "pv-lift-title", text: "Formule midi" }),
    h("span", { class: "pv-lift-sub", text: "Entrée + plat · 19 €" }),
  ]);

  const micro = h("div", { class: "comp-micro" }, [
    h("p", { class: "comp-micro-title", text: "Same duration and easing tokens, three other surfaces" }),
    h("div", { class: "comp-micro-row" }, [
      h("div", { class: "comp-micro-item" }, [switchDemo, h("span", { class: "comp-micro-label", text: "Switch — tap it" })]),
      h("div", { class: "comp-micro-item" }, [
        h("input", { class: "pv-input", type: "text", value: "Focus me", "aria-label": "Focus ring demo" }),
        h("span", { class: "comp-micro-label", text: "Focus ring" }),
      ]),
      h("div", { class: "comp-micro-item" }, [liftCard, h("span", { class: "comp-micro-label", text: "Card — hover or focus" })]),
    ]),
  ]);

  const stage = h("div", { class: "stage stage-comp" }, [hero, grid, micro]);

  /* ---------------------------------------------------------- controls --- */

  const controls = h("div", { class: "controls" }, [
    chips({
      label: "Recipe",
      options: VARIANTS.map((v) => ({ value: v.id, label: v.name })),
      value: spec.variantId,
      onSelect: (value) => {
        spec.variantId = value;
        ctx.rebuild();
      },
    }),
    fieldset("Shape", "One radius token drives all six recipes — including the two that look wrong rounded.", [
      slider({
        label: "Radius",
        min: 0,
        max: 32,
        step: 1,
        value: spec.radius,
        format: (v) => `${v} px`,
        onInput: (v) => {
          spec.radius = v;
          ctx.commit();
        },
      }),
      slider({
        label: "Padding — inline",
        min: 8,
        max: 56,
        step: 1,
        value: spec.padX,
        format: (v) => `${v} px`,
        onInput: (v) => {
          spec.padX = v;
          ctx.commit();
        },
      }),
      slider({
        label: "Padding — block",
        min: 6,
        max: 32,
        step: 1,
        value: spec.padY,
        format: (v) => `${v} px`,
        onInput: (v) => {
          spec.padY = v;
          ctx.commit();
        },
      }),
      slider({
        label: "Border width",
        min: 0,
        max: 5,
        step: 0.5,
        value: spec.borderWidth,
        format: (v) => `${v} px`,
        onInput: (v) => {
          spec.borderWidth = v;
          ctx.commit();
        },
      }),
      slider({
        label: "Shadow depth",
        min: 0,
        max: 3,
        step: 1,
        value: spec.shadow,
        format: (v) => ["none", "hairline", "soft", "deep"][v],
        hint: "Four rungs, flatter than Material's five dp elevations.",
        onInput: (v) => {
          spec.shadow = v;
          ctx.commit();
        },
      }),
    ]),
    fieldset("Motion", "Easings marked md.* are Material 3's published curves, verbatim.", [
      slider({
        label: "Duration",
        min: 0,
        max: 600,
        step: 10,
        value: spec.duration,
        format: (v) => `${v} ms · ${nearestDurationToken(v)}`,
        onInput: (v) => {
          spec.duration = v;
          ctx.commit();
        },
      }),
      chips({
        label: "Easing",
        options: EASINGS.map((e) => ({ value: e.id, label: e.label, sub: e.token })),
        value: spec.easingId,
        onSelect: (value) => {
          spec.easingId = value;
          ctx.commit();
          ctx.rebuild();
        },
      }),
      slider({
        label: "Press travel",
        min: 0,
        max: 8,
        step: 0.5,
        value: spec.travel,
        format: (v) => `${v} px`,
        hint: "How far the button moves under the finger. 0 disables the press.",
        onInput: (v) => {
          spec.travel = v;
          ctx.commit();
        },
      }),
    ]),
    fieldset("Label", "", [
      slider({
        label: "Weight",
        min: 300,
        max: 900,
        step: 10,
        value: spec.weight,
        onInput: (v) => {
          spec.weight = v;
          ctx.commit();
        },
      }),
      slider({
        label: "Tracking",
        min: -0.02,
        max: 0.2,
        step: 0.005,
        value: spec.tracking,
        format: (v) => `${v.toFixed(3)} em`,
        onInput: (v) => {
          spec.tracking = v;
          ctx.commit();
        },
      }),
      toggle("Uppercase", spec.uppercase, (value) => {
        spec.uppercase = value;
        ctx.rebuild();
      }),
    ]),
    fieldset("Keep it", "", [
      textButton("Save this recipe", ICONS.save, () => {
        saveEntry(ctx, "components", `${selected.name} · r${spec.radius} · ${spec.duration}ms`, structuredClone(spec));
      }),
    ]),
  ]);

  const el = h("div", { class: "work" }, [stage, controls]);
  const sync = () => applyVars(stage, previewVars(ctx.ws));
  sync();
  return { el, sync };
}
