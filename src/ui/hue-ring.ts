/**
 * Hue ring (Eagle, Muzli): tap or drag around the ring to pick a hue, or
 * paste a hex or oklch() value. Keyboard: arrows step 10°.
 */

import { h } from "./controls";

export function hueRing(initial: number | null, onPick: (value: { hue: number } | { color: string }) => void): HTMLElement {
  let hue = initial ?? 200;
  const knob = h("span", { class: "hue-knob" });
  const ring = h("div", { class: "hue-ring", role: "slider", tabindex: "0", "aria-label": "Teinte", "aria-valuemin": "0", "aria-valuemax": "359" }, [knob]);
  const readout = h("output", { class: "val" });
  const place = () => {
    const angle = (hue * Math.PI) / 180;
    // The conic gradient starts at 90° (east) and turns clockwise, like OKLCH hue on screen.
    knob.style.left = `${50 + 41 * Math.cos(angle)}%`;
    knob.style.top = `${50 + 41 * Math.sin(angle)}%`;
    ring.setAttribute("aria-valuenow", String(Math.round(hue)));
    readout.textContent = `teinte ${Math.round(hue)}°`;
  };
  const fromPointer = (event: PointerEvent) => {
    const box = ring.getBoundingClientRect();
    const angle = Math.atan2(event.clientY - (box.top + box.height / 2), event.clientX - (box.left + box.width / 2));
    hue = ((angle * 180) / Math.PI + 360) % 360;
    place();
  };
  ring.addEventListener("pointerdown", (event) => {
    ring.setPointerCapture(event.pointerId);
    fromPointer(event);
  });
  ring.addEventListener("pointermove", (event) => {
    if (ring.hasPointerCapture(event.pointerId)) fromPointer(event);
  });
  ring.addEventListener("pointerup", () => onPick({ hue: Math.round(hue) }));
  ring.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") hue = (hue + 10) % 360;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") hue = (hue + 350) % 360;
    else if (event.key === "Enter") {
      // The same keypress would otherwise activate the chip that regains focus.
      event.preventDefault();
      onPick({ hue: Math.round(hue) });
      return;
    }
    else return;
    event.preventDefault();
    place();
  });
  const input = h("input", { class: "input", placeholder: "#186063 ou oklch(0.448 0.068 199)", "aria-label": "Couleur exacte" });
  const apply = h("button", { type: "button", class: "btn", text: "Chercher cette couleur" });
  apply.addEventListener("click", () => {
    if (input.value.trim()) onPick({ color: input.value.trim() });
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && input.value.trim()) {
      event.preventDefault();
      onPick({ color: input.value.trim() });
    }
  });
  place();
  return h("div", { class: "field" }, [ring, readout, input, apply]);
}
