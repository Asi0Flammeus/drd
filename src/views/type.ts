/**
 * Playground · type.
 *
 * The preview is one element tree built once; every control writes a custom
 * property on its root. Nothing re-renders, so dragging a slider is a style
 * recalculation and not a DOM rebuild — which is why the specimen tracks the
 * thumb instead of stepping behind it.
 */

import { FAMILIES, familyById, SAMPLES } from "../data/fonts";
import type { FontFamily } from "../data/fonts";
import { chips, fieldset, h, ICONS, slider, textButton } from "../ui/controls";
import { applyVars, previewVars } from "../tokens";
import type { Panel, ViewContext } from "./view";
import { saveEntry } from "./save";

function specimen(family: FontFamily, bodyFamily: FontFamily, sampleId: string): HTMLElement {
  const sample = SAMPLES.find((s) => s.id === sampleId) ?? SAMPLES[0];
  return h("div", { class: "specimen", "data-figure": "type-specimen" }, [
    h("p", { class: "specimen-kicker", text: sample.kicker }),
    h("h2", { class: "specimen-display", text: sample.heading }),
    h("p", { class: "specimen-body", text: sample.body }),
    h("p", { class: "specimen-meta", text: sample.meta }),
    // Prose alone hides the expressive axes: Fraunces' WONK swaps the g/y/R,
    // Recursive's CASL and MONO show on a/g/l, Anybody's width shows on the
    // round letters. Measured on a French hero line with no lowercase g, where
    // WONK 0 and WONK 1 rendered identically — so the specimen now carries the
    // glyphs the sliders actually move.
    h("p", { class: "specimen-glyphs", text: "a g y R k Q & 1 4 7 — ligature fi" }),
    h("div", { class: "specimen-foot" }, [
      h("span", { class: "specimen-tag", text: `display · ${family.name}` }),
      h("span", { class: "specimen-tag", text: `body · ${bodyFamily.name}` }),
    ]),
  ]);
}

function familyCard(family: FontFamily): HTMLElement {
  return h("div", { class: "info-card" }, [
    h("p", { class: "info-role", text: family.role }),
    h("p", { class: "info-why", text: family.why }),
    h("dl", { class: "info-meta" }, [
      h("dt", { text: "Designer" }),
      h("dd", { text: family.designer }),
      h("dt", { text: "Licence" }),
      h("dd", { text: family.license }),
      h("dt", { text: "Upstream" }),
      h("dd", { text: family.upstream }),
      h("dt", { text: "Axes" }),
      h("dd", { text: family.axes.map((a) => `${a.tag} ${a.min}–${a.max}`).join(" · ") }),
    ]),
  ]);
}

function axisControls(
  ctx: ViewContext,
  role: "display" | "body",
  familyId: string,
  title: string,
): HTMLElement {
  const family = familyById(familyId);
  const map = role === "display" ? ctx.ws.type.displayAxes : ctx.ws.type.bodyAxes;
  const values = map[familyId] ?? {};
  const controls = family.axes
    .filter((a) => a.tag !== "wght")
    .map((a) =>
      slider({
        label: `${a.label} · ${a.tag}`,
        min: a.min,
        max: a.max,
        step: a.step,
        value: values[a.tag] ?? a.default,
        hint: a.note,
        onInput: (value) => {
          map[familyId] = { ...(map[familyId] ?? {}), [a.tag]: value };
          ctx.commit();
        },
      }),
    );
  if (!controls.length) {
    return fieldset(title, "", [
      h("p", { class: "group-empty", text: "Weight is this family's only axis — it is on the panel above." }),
    ]);
  }
  return fieldset(
    title,
    "Family-specific axes, held separately for the display and body roles. These are the ones no static font can give you.",
    controls,
  );
}

export function buildTypePanel(ctx: ViewContext): Panel {
  const t = ctx.ws.type;
  const display = familyById(t.displayFamily);
  const body = familyById(t.bodyFamily);

  const stage = h("div", { class: "stage" }, [specimen(display, body, t.sample)]);

  const faceOptions = FAMILIES.map((f) => ({ value: f.id, label: f.name, sub: f.axes.map((a) => a.tag).join(" ") }));

  const controls = h("div", { class: "controls" }, [
    chips({
      label: "Display face",
      options: faceOptions,
      value: t.displayFamily,
      onSelect: (value) => {
        const next = familyById(value);
        t.displayFamily = value;
        t.displaySize = next.preset.headingSize;
        t.displayWeight = next.preset.headingWeight;
        t.displayTracking = next.preset.headingTracking;
        t.displayLeading = next.preset.headingLeading;
        ctx.rebuild();
      },
    }),
    chips({
      label: "Body face",
      options: faceOptions,
      value: t.bodyFamily,
      onSelect: (value) => {
        const next = familyById(value);
        t.bodyFamily = value;
        t.bodySize = next.preset.bodySize;
        t.bodyWeight = next.preset.bodyWeight;
        t.bodyTracking = next.preset.bodyTracking;
        t.bodyLeading = next.preset.bodyLeading;
        ctx.rebuild();
      },
    }),
    chips({
      label: "Sample content",
      options: SAMPLES.map((s) => ({ value: s.id, label: s.label })),
      value: t.sample,
      onSelect: (value) => {
        t.sample = value;
        ctx.rebuild();
      },
    }),
    fieldset("Display — " + display.name, "", [
      slider({
        label: "Size",
        min: 20,
        max: 112,
        step: 1,
        value: t.displaySize,
        format: (v) => `${v} px`,
        onInput: (v) => {
          t.displaySize = v;
          ctx.commit();
        },
      }),
      slider({
        label: "Weight · wght",
        min: display.axes.find((a) => a.tag === "wght")?.min ?? 400,
        max: display.axes.find((a) => a.tag === "wght")?.max ?? 700,
        step: 1,
        value: t.displayWeight,
        onInput: (v) => {
          t.displayWeight = v;
          ctx.commit();
        },
      }),
      slider({
        label: "Tracking",
        min: -0.06,
        max: 0.16,
        step: 0.002,
        value: t.displayTracking,
        format: (v) => `${v.toFixed(3)} em`,
        onInput: (v) => {
          t.displayTracking = v;
          ctx.commit();
        },
      }),
      slider({
        label: "Line height",
        min: 0.82,
        max: 1.8,
        step: 0.01,
        value: t.displayLeading,
        format: (v) => v.toFixed(2),
        onInput: (v) => {
          t.displayLeading = v;
          ctx.commit();
        },
      }),
    ]),
    axisControls(ctx, "display", t.displayFamily, `Display axes — ${display.name}`),
    fieldset("Body — " + body.name, "", [
      slider({
        label: "Size",
        min: 12,
        max: 26,
        step: 0.5,
        value: t.bodySize,
        format: (v) => `${v} px`,
        onInput: (v) => {
          t.bodySize = v;
          ctx.commit();
        },
      }),
      slider({
        label: "Weight · wght",
        min: body.axes.find((a) => a.tag === "wght")?.min ?? 400,
        max: body.axes.find((a) => a.tag === "wght")?.max ?? 700,
        step: 1,
        value: t.bodyWeight,
        onInput: (v) => {
          t.bodyWeight = v;
          ctx.commit();
        },
      }),
      slider({
        label: "Tracking",
        min: -0.03,
        max: 0.12,
        step: 0.002,
        value: t.bodyTracking,
        format: (v) => `${v.toFixed(3)} em`,
        onInput: (v) => {
          t.bodyTracking = v;
          ctx.commit();
        },
      }),
      slider({
        label: "Line height",
        min: 1.1,
        max: 2.1,
        step: 0.01,
        value: t.bodyLeading,
        format: (v) => v.toFixed(2),
        onInput: (v) => {
          t.bodyLeading = v;
          ctx.commit();
        },
      }),
    ]),
    // Shown even when both roles use the same family: the axis values are held
    // per role, so Fraunces can be opsz 120 in the headline and opsz 14 in the
    // paragraph at the same time.
    axisControls(ctx, "body", t.bodyFamily, `Body axes — ${body.name}`),
    fieldset("Keep it", "Saves face pair, every axis value and both scales into the library.", [
      textButton("Save this pairing", ICONS.save, () => {
        const label = `${display.name} × ${body.name}`;
        saveEntry(ctx, "type", label, structuredClone(ctx.ws.type));
      }),
    ]),
    familyCard(display),
  ]);

  const el = h("div", { class: "work" }, [stage, controls]);

  const sync = () => applyVars(stage, previewVars(ctx.ws));
  sync();
  return { el, sync };
}
