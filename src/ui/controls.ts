/**
 * Control factory. Touch-first by contract: every interactive element here is
 * at least 44 px tall on a coarse pointer (see app.css), every slider shows its
 * current value as a number, and every change fires on `input` so a specimen
 * re-renders while the thumb is still moving.
 */

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else el.setAttribute(key, value);
  }
  for (const child of children) el.append(child);
  return el;
}

export function icon(path: string, size = 16): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}

export const ICONS = {
  save: "M5 4h11l3 3v13H5z M9 4v5h6V4 M8 13h8 M8 17h5",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13",
  copy: "M8 8h11v12H8z M5 16V4h11",
  download: "M12 4v11 M7 11l5 5 5-5 M4 20h16",
  upload: "M12 20V9 M7 13l5-5 5 5 M4 4h16",
  reset: "M4 10a8 8 0 1 1 2 6 M4 5v5h5",
  chevron: "M9 6l6 6-6 6",
  check: "M5 13l4 4L19 7",
  warn: "M12 4l9 16H3z M12 10v4 M12 17h.01",
  dash: "M6 12h12",
};

export type SliderSpec = {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Rendered next to the label — the unit or the token it maps to. */
  hint?: string;
  format?: (value: number) => string;
  onInput: (value: number) => void;
};

export function slider(spec: SliderSpec): HTMLElement {
  const format = spec.format ?? ((v: number) => String(v));
  const readout = h("output", { class: "ctl-value", text: format(spec.value) });
  const input = h("input", {
    type: "range",
    class: "ctl-range",
    min: String(spec.min),
    max: String(spec.max),
    step: String(spec.step),
    value: String(spec.value),
    "aria-label": spec.label,
  });
  const hint = spec.hint ? h("span", { class: "ctl-hint", text: spec.hint }) : null;
  input.addEventListener("input", () => {
    const value = Number(input.value);
    readout.textContent = format(value);
    spec.onInput(value);
  });
  const head = h("div", { class: "ctl-head" }, [
    h("span", { class: "ctl-label", text: spec.label }),
    readout,
  ]);
  const wrap = h("label", { class: "ctl" }, [head, input]);
  if (hint) wrap.append(hint);
  return wrap;
}

export type ChipSpec<T extends string> = {
  label: string;
  options: { value: T; label: string; sub?: string }[];
  value: T;
  onSelect: (value: T) => void;
};

export function chips<T extends string>(spec: ChipSpec<T>): HTMLElement {
  const group = h("div", { class: "chips", role: "radiogroup", "aria-label": spec.label });
  for (const option of spec.options) {
    const button = h("button", {
      type: "button",
      class: "chip",
      role: "radio",
      "aria-checked": option.value === spec.value ? "true" : "false",
      "data-value": option.value,
    });
    button.append(h("span", { class: "chip-label", text: option.label }));
    if (option.sub) button.append(h("span", { class: "chip-sub", text: option.sub }));
    button.addEventListener("click", () => {
      // Chips own their visible state: some callers (the playbook filter, the
      // editing-path switch) never rebuild, and a radiogroup whose selection is
      // invisible is worse than no radiogroup.
      for (const sibling of group.children) {
        sibling.setAttribute("aria-checked", sibling === button ? "true" : "false");
      }
      spec.onSelect(option.value);
    });
    group.append(button);
  }
  return h("div", { class: "ctl ctl-chips" }, [
    h("span", { class: "ctl-label", text: spec.label }),
    group,
  ]);
}

export function toggle(label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement {
  const button = h("button", {
    type: "button",
    class: "switch",
    role: "switch",
    "aria-checked": value ? "true" : "false",
  }, [h("span", { class: "switch-knob" })]);
  button.addEventListener("click", () => {
    const next = button.getAttribute("aria-checked") !== "true";
    button.setAttribute("aria-checked", next ? "true" : "false");
    onChange(next);
  });
  return h("div", { class: "ctl ctl-row" }, [
    h("span", { class: "ctl-label", text: label }),
    button,
  ]);
}

export function textButton(label: string, iconPath: string, onClick: () => void): HTMLButtonElement {
  const button = h("button", { type: "button", class: "action" }, [icon(iconPath), h("span", { text: label })]);
  button.addEventListener("click", onClick);
  return button;
}

export function fieldset(title: string, note: string, controls: Node[]): HTMLElement {
  const body = h("div", { class: "group-body" }, controls);
  return h("section", { class: "group" }, [
    h("h3", { class: "group-title", text: title }),
    note ? h("p", { class: "group-note", text: note }) : h("span"),
    body,
  ]);
}
