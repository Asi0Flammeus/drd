/**
 * Phosphor (MIT), regular weight; the filled bookmark is the kept state.
 * Imported as strings so the bundle carries exactly the icons DRD uses.
 */

import arrowClockwise from "@phosphor-icons/core/assets/regular/arrow-clockwise.svg?raw";
import arrowSquareOut from "@phosphor-icons/core/assets/regular/arrow-square-out.svg?raw";
import bookmark from "@phosphor-icons/core/assets/regular/bookmark-simple.svg?raw";
import bookmarkFill from "@phosphor-icons/core/assets/fill/bookmark-simple-fill.svg?raw";
import books from "@phosphor-icons/core/assets/regular/books.svg?raw";
import caretDown from "@phosphor-icons/core/assets/regular/caret-down.svg?raw";
import caretLeft from "@phosphor-icons/core/assets/regular/caret-left.svg?raw";
import cards from "@phosphor-icons/core/assets/regular/cards.svg?raw";
import check from "@phosphor-icons/core/assets/regular/check.svg?raw";
import checks from "@phosphor-icons/core/assets/regular/list-checks.svg?raw";
import copy from "@phosphor-icons/core/assets/regular/copy.svg?raw";
import crosshair from "@phosphor-icons/core/assets/regular/crosshair.svg?raw";
import download from "@phosphor-icons/core/assets/regular/download-simple.svg?raw";
import dots from "@phosphor-icons/core/assets/regular/dots-three.svg?raw";
import exportIcon from "@phosphor-icons/core/assets/regular/export.svg?raw";
import flask from "@phosphor-icons/core/assets/regular/flask.svg?raw";
import magnifier from "@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw";
import plus from "@phosphor-icons/core/assets/regular/plus.svg?raw";
import signOut from "@phosphor-icons/core/assets/regular/sign-out.svg?raw";
import squares from "@phosphor-icons/core/assets/regular/squares-four.svg?raw";
import trash from "@phosphor-icons/core/assets/regular/trash.svg?raw";
import warning from "@phosphor-icons/core/assets/regular/warning-circle.svg?raw";
import wifiSlash from "@phosphor-icons/core/assets/regular/wifi-slash.svg?raw";
import x from "@phosphor-icons/core/assets/regular/x.svg?raw";

const SVG = {
  "arrow-clockwise": arrowClockwise,
  "arrow-square-out": arrowSquareOut,
  bookmark,
  "bookmark-fill": bookmarkFill,
  books,
  "caret-down": caretDown,
  "caret-left": caretLeft,
  cards,
  check,
  checks,
  copy,
  crosshair,
  download,
  dots,
  export: exportIcon,
  flask,
  magnifier,
  plus,
  "sign-out": signOut,
  squares,
  trash,
  warning,
  "wifi-slash": wifiSlash,
  x,
} as const;

export type IconName = keyof typeof SVG;

export function icon(name: IconName, size = 20): SVGSVGElement {
  const holder = document.createElement("span");
  holder.innerHTML = SVG[name];
  const svg = holder.firstElementChild as SVGSVGElement;
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ic");
  return svg;
}
