/**
 * Playground · colour.
 *
 * Two editing paths, switchable, because they answer different questions:
 *   RAW — "the client's brand hex is #b1532e, put it in step 9." Per-swatch,
 *         exact, destructive to the ramp's internal logic and that is fine.
 *   HSL — "this palette is right but too purple." Ramp-wide hue/saturation and
 *         a lightness-spread that opens or closes the whole contrast range.
 *
 * Both write into the same resolved palette: HSL transforms the source ramp,
 * RAW stores per-swatch overrides on top. Switching modes loses nothing.
 */

import { isHex } from "../color";
import { PALETTES, paletteById, rolesFor } from "../data/palettes";
import { resolvePalette, hexFromHsl, hslOf } from "../state";
import { applyVars, contrastChecks, previewVars } from "../tokens";
import { chips, fieldset, h, icon, ICONS, slider, textButton } from "../ui/controls";
import { mockup } from "../ui/previews";
import { saveEntry } from "./save";
import type { Panel, ViewContext } from "./view";

const STEP_ROLES = [
  "surface",
  "surface-raised",
  "fill",
  "fill-hover",
  "fill-active",
  "line-soft",
  "line",
  "line-strong",
  "neutral-solid",
  "neutral-solid-hover",
  "ink-dim",
  "ink",
];

const ACCENT_KEYS: [string, string][] = [
  ["accent-soft", "Accent soft"],
  ["accent-solid", "Accent solid"],
  ["accent-deep", "Accent deep"],
  ["accent-on", "On accent"],
];

export function buildColorPanel(ctx: ViewContext): Panel {
  const spec = ctx.ws.color;
  const palette = paletteById(spec.paletteId);

  /* ------------------------------------------------------------- stage --- */

  const stage = h("div", { class: "stage stage-color" });
  const mock = mockup(ctx.ws.components.variantId);

  const legend = h("div", { class: "legend" });
  const legendCells: HTMLElement[] = [];
  STEP_ROLES.forEach((role, i) => {
    const swatch = h("span", { class: "legend-swatch" });
    const cell = h("div", { class: "legend-cell" }, [
      swatch,
      h("span", { class: "legend-step", text: String(i + 1) }),
      h("span", { class: "legend-role", text: role }),
    ]);
    legendCells.push(swatch);
    legend.append(cell);
  });

  const contrastRows: { ratio: HTMLElement; grade: HTMLElement; pair: HTMLElement }[] = [];
  const contrastTable = h("div", { class: "contrast" }, [
    h("p", { class: "contrast-title", text: "WCAG 2.1 · measured, not assumed" }),
  ]);
  for (const check of contrastChecks(ctx.ws)) {
    const ratio = h("span", { class: "contrast-ratio", text: check.ratio.toFixed(2) });
    const grade = h("span", { class: `contrast-grade is-${check.grade}`, text: check.grade });
    const pair = h("span", { class: "contrast-pair", text: check.pair });
    contrastRows.push({ ratio, grade, pair });
    contrastTable.append(
      h("div", { class: "contrast-row" }, [
        h("span", { class: "contrast-label", text: check.label }),
        pair,
        ratio,
        grade,
      ]),
    );
  }

  stage.append(mock, legend, contrastTable);

  /* ---------------------------------------------------------- controls --- */

  const sourceCard = h("div", { class: "info-card" }, [
    h("p", { class: "info-role", text: `Source · ${palette.source}` }),
    h("p", { class: "info-why", text: palette.learned }),
    palette.derivation
      ? h("p", { class: "info-derivation" }, [icon(ICONS.warn, 14), h("span", { text: palette.derivation })])
      : h("span"),
    h("p", { class: "info-url", text: palette.sourceUrl }),
  ]);

  const rawInputs: { key: string; color: HTMLInputElement; text: HTMLInputElement }[] = [];

  const swatchEditor = (key: string, label: string) => {
    const color = h("input", { type: "color", class: "hex-color", "aria-label": `${label} colour picker` }) as HTMLInputElement;
    const text = h("input", { type: "text", class: "hex-text", spellcheck: "false", "aria-label": `${label} hex` }) as HTMLInputElement;
    const write = (value: string) => {
      spec.overrides[key] = value;
      ctx.commit();
    };
    color.addEventListener("input", () => write(color.value));
    text.addEventListener("input", () => {
      if (isHex(text.value)) write(text.value.startsWith("#") ? text.value : `#${text.value}`);
    });
    const clear = h("button", { type: "button", class: "hex-clear", title: "Back to source value" }, [
      icon(ICONS.reset, 13),
    ]);
    clear.addEventListener("click", () => {
      delete spec.overrides[key];
      ctx.commit();
    });
    rawInputs.push({ key, color, text });
    return h("div", { class: "hex-row" }, [
      h("span", { class: "hex-label", text: label }),
      color,
      text,
      clear,
    ]);
  };

  const rawGroup = fieldset(
    "Raw hex",
    "Per-swatch, exact. The reset arrow drops the override and the source value comes back.",
    [
      ...STEP_ROLES.map((role, i) => swatchEditor(String(i), `${i + 1} · ${role}`)),
      ...ACCENT_KEYS.map(([key, label]) => swatchEditor(key, label)),
    ],
  );

  const selectedHslControls = h("div", { class: "group-body" });

  const buildSelectedHsl = () => {
    selectedHslControls.replaceChildren();
    const resolved = resolvePalette(spec);
    const key = spec.selected;
    const current = key.startsWith("accent")
      ? key === "accent-soft"
        ? resolved.accent.soft
        : key === "accent-deep"
          ? resolved.accent.deep
          : resolved.accent.solid
      : resolved.ramp[Number(key)] ?? resolved.ramp[0];
    const { h: hue, s, l } = hslOf(current);
    const write = (nh: number, ns: number, nl: number) => {
      spec.overrides[key] = hexFromHsl(nh, ns, nl);
      ctx.commit();
    };
    let ch = hue;
    let cs = s;
    let cl = l;
    selectedHslControls.append(
      chips({
        label: "Swatch",
        options: [
          ...STEP_ROLES.map((role, i) => ({ value: String(i), label: String(i + 1), sub: role })),
          ...ACCENT_KEYS.filter(([k]) => k !== "accent-on").map(([k, label]) => ({ value: k, label: label.replace("Accent ", "A·") })),
        ],
        value: key,
        onSelect: (value) => {
          spec.selected = value;
          buildSelectedHsl();
          ctx.commit();
        },
      }),
      slider({
        label: "Hue",
        min: 0,
        max: 360,
        step: 1,
        value: Math.round(ch),
        format: (v) => `${v}°`,
        onInput: (v) => {
          ch = v;
          write(ch, cs, cl);
        },
      }),
      slider({
        label: "Saturation",
        min: 0,
        max: 100,
        step: 1,
        value: Math.round(cs),
        format: (v) => `${v} %`,
        onInput: (v) => {
          cs = v;
          write(ch, cs, cl);
        },
      }),
      slider({
        label: "Lightness",
        min: 0,
        max: 100,
        step: 1,
        value: Math.round(cl),
        format: (v) => `${v} %`,
        onInput: (v) => {
          cl = v;
          write(ch, cs, cl);
        },
      }),
    );
  };
  buildSelectedHsl();

  const hslGroup = fieldset(
    "HSL — whole ramp",
    "Transforms the source palette in OKLCH, so equal steps stay equal steps. Lightness spread opens or closes the contrast range.",
    [
      slider({
        label: "Hue shift",
        min: -180,
        max: 180,
        step: 1,
        value: spec.hueShift,
        format: (v) => `${v > 0 ? "+" : ""}${v}°`,
        onInput: (v) => {
          spec.hueShift = v;
          ctx.commit();
        },
      }),
      slider({
        label: "Saturation",
        min: 0,
        max: 2.5,
        step: 0.05,
        value: spec.satScale,
        format: (v) => `×${v.toFixed(2)}`,
        onInput: (v) => {
          spec.satScale = v;
          ctx.commit();
        },
      }),
      slider({
        label: "Lightness spread",
        min: 0.4,
        max: 1.6,
        step: 0.01,
        value: spec.lightSpread,
        format: (v) => `×${v.toFixed(2)}`,
        onInput: (v) => {
          spec.lightSpread = v;
          ctx.commit();
        },
      }),
      slider({
        label: "Accent hue",
        min: -180,
        max: 180,
        step: 1,
        value: spec.accentHueShift,
        format: (v) => `${v > 0 ? "+" : ""}${v}°`,
        onInput: (v) => {
          spec.accentHueShift = v;
          ctx.commit();
        },
      }),
      slider({
        label: "Accent saturation",
        min: 0,
        max: 2.5,
        step: 0.05,
        value: spec.accentSatScale,
        format: (v) => `×${v.toFixed(2)}`,
        onInput: (v) => {
          spec.accentSatScale = v;
          ctx.commit();
        },
      }),
    ],
  );

  const perSwatchGroup = h("section", { class: "group" }, [
    h("h3", { class: "group-title", text: "HSL — one swatch" }),
    h("p", {
      class: "group-note",
      text: "Writes a hex override for the selected swatch, so it survives a mode switch.",
    }),
    selectedHslControls,
  ]);

  const modeBody = h("div", { class: "mode-body" });
  const paintMode = () => {
    modeBody.replaceChildren(spec.mode === "raw" ? rawGroup : hslGroup, perSwatchGroup);
  };

  const controls = h("div", { class: "controls" }, [
    chips({
      label: "Palette",
      options: PALETTES.map((p) => ({ value: p.id, label: p.name, sub: p.derivation ? "derived" : "verbatim" })),
      value: spec.paletteId,
      onSelect: (value) => {
        spec.paletteId = value;
        spec.overrides = {};
        spec.hueShift = 0;
        spec.satScale = 1;
        spec.lightSpread = 1;
        spec.accentHueShift = 0;
        spec.accentSatScale = 1;
        ctx.rebuild();
      },
    }),
    chips({
      label: "Editing path",
      options: [
        { value: "hsl", label: "HSL", sub: "hue + saturation" },
        { value: "raw", label: "Raw hex", sub: "exact values" },
      ],
      value: spec.mode,
      onSelect: (value) => {
        spec.mode = value as "raw" | "hsl";
        paintMode();
        ctx.commit();
      },
    }),
    modeBody,
    fieldset("Keep it", "Saves palette, transforms and every override.", [
      textButton("Save this palette", ICONS.save, () => {
        saveEntry(ctx, "color", `${palette.name} · ${spec.hueShift > 0 ? "+" : ""}${spec.hueShift}°`, structuredClone(spec));
      }),
      textButton("Reset to source", ICONS.reset, () => {
        spec.overrides = {};
        spec.hueShift = 0;
        spec.satScale = 1;
        spec.lightSpread = 1;
        spec.accentHueShift = 0;
        spec.accentSatScale = 1;
        ctx.rebuild();
      }),
    ]),
    sourceCard,
  ]);
  paintMode();

  const el = h("div", { class: "work" }, [stage, controls]);

  const sync = () => {
    applyVars(stage, previewVars(ctx.ws));
    const resolved = resolvePalette(spec);
    const roles = rolesFor(resolved.ramp, resolved.accent);
    resolved.ramp.forEach((hex, i) => {
      legendCells[i].style.background = hex;
    });
    contrastChecks(ctx.ws).forEach((check, i) => {
      const row = contrastRows[i];
      row.ratio.textContent = check.ratio.toFixed(2);
      row.grade.textContent = check.grade;
      row.grade.className = `contrast-grade is-${check.grade}`;
      row.pair.textContent = check.pair;
    });
    for (const entry of rawInputs) {
      const value = entry.key.startsWith("accent")
        ? entry.key === "accent-soft"
          ? roles.accentSoft
          : entry.key === "accent-deep"
            ? roles.accentDeep
            : entry.key === "accent-on"
              ? roles.onAccent
              : roles.accent
        : resolved.ramp[Number(entry.key)];
      entry.color.value = value;
      if (document.activeElement !== entry.text) entry.text.value = value;
      entry.text.classList.toggle("is-override", Boolean(spec.overrides[entry.key]));
    }
  };
  sync();
  return { el, sync };
}
