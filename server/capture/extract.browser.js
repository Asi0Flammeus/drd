/**
 * Runs inside the captured page, in Chrome, with no access to anything of
 * ours. Plain JavaScript on purpose: it is evaluated as a string by the
 * capture runner, never bundled, and it must not depend on a build step.
 *
 * It returns geometry and computed style only. No captured HTML ever comes
 * back — the client renders screenshots and text extracts, never markup from
 * a page we do not control.
 *
 * The expression value of this file is the payload, so the file is one IIFE.
 */
(() => {
  const LIMIT_ELEMENTS = 400;
  const LIMIT_LINKS = 300;
  const MIN_AREA = 5000;
  const MIN_WIDTH = 72;
  const MIN_HEIGHT = 32;

  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const pageWidth = Math.max(document.documentElement.scrollWidth, window.innerWidth);
  const pageHeight = Math.max(document.documentElement.scrollHeight, window.innerHeight);

  const text = (el) => (el.textContent || "").replace(/\s+/g, " ").trim();

  /** A path a human can read and a developer can paste into the console. */
  function selectorFor(el) {
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && node !== document.documentElement && depth < 6) {
      let part = node.tagName.toLowerCase();
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
        parts.unshift(`#${node.id}`);
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.prototype.filter.call(parent.children, (c) => c.tagName === node.tagName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
      depth += 1;
    }
    return parts.join(" > ");
  }

  function toHex(value) {
    if (!value) return null;
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    const alpha = parts.length > 3 ? parts[3] : 1;
    if (alpha < 0.08) return null;
    const hex = parts
      .slice(0, 3)
      .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0"))
      .join("");
    return `#${hex}`;
  }

  const CREDIT = /(site|website|design(ed)?|built|made|developed|crafted|réalis|conçu|développé|created)\s+(by|par)|^(by|par)\s|credits?|colophon/i;
  const BUTTONISH = /(^|[\s_-])(btn|button|cta|bouton)([\s_-]|$)/i;

  /* ------------------------------------------------------------ meta ----- */

  const metaContent = (selector) => {
    const node = document.querySelector(selector);
    return node ? (node.getAttribute("content") || "").trim() : "";
  };

  const iconLink = document.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
  const canonical = document.querySelector('link[rel="canonical"]');

  const meta = {
    title: (document.title || "").trim(),
    description: metaContent('meta[name="description"]') || metaContent('meta[property="og:description"]'),
    siteName: metaContent('meta[property="og:site_name"]'),
    ogImage: metaContent('meta[property="og:image"]'),
    themeColor: metaContent('meta[name="theme-color"]'),
    generator: metaContent('meta[name="generator"]'),
    lang: (document.documentElement.getAttribute("lang") || "").trim(),
    canonical: canonical ? canonical.href : "",
    favicon: iconLink ? iconLink.href : "",
  };

  /* --------------------------------------------------------- elements ---- */

  const all = Array.prototype.slice.call(document.body.querySelectorAll("*"), 0, 12000);
  const fontUse = new Map();
  const colorUse = new Map();
  const candidates = [];

  const noteColor = (hex, role) => {
    if (!hex) return;
    const entry = colorUse.get(hex) || { hex, count: 0, roles: {} };
    entry.count += 1;
    entry.roles[role] = (entry.roles[role] || 0) + 1;
    colorUse.set(hex, entry);
  };

  for (const el of all) {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;

    const own = text(el).slice(0, 400);
    if (own) {
      const family = style.fontFamily.split(",")[0].replace(/["']/g, "").trim();
      if (family) {
        const entry = fontUse.get(family) || { family, count: 0, sizes: {}, weights: {}, sample: "" };
        entry.count += 1;
        entry.sizes[Math.round(parseFloat(style.fontSize))] = (entry.sizes[Math.round(parseFloat(style.fontSize))] || 0) + 1;
        entry.weights[style.fontWeight] = (entry.weights[style.fontWeight] || 0) + 1;
        if (!entry.sample && own.length > 8) entry.sample = own.slice(0, 90);
        fontUse.set(family, entry);
      }
      noteColor(toHex(style.color), "text");
    }
    noteColor(toHex(style.backgroundColor), "background");
    if (style.borderTopWidth !== "0px" || style.borderBottomWidth !== "0px") noteColor(toHex(style.borderTopColor), "border");

    if (rect.width < MIN_WIDTH || rect.height < MIN_HEIGHT || rect.width * rect.height < MIN_AREA) {
      // Small elements are still candidates when they are clearly components.
      const tag = el.tagName.toLowerCase();
      const small = tag === "button" || (tag === "a" && BUTTONISH.test(el.className || "")) || tag === "img" || tag === "svg";
      if (!small || rect.width < 24 || rect.height < 16) continue;
    }

    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") || "";
    const classes = typeof el.className === "string" ? el.className : "";
    const hasBackground = style.backgroundImage !== "none" || toHex(style.backgroundColor) !== null;
    const hasEdge = style.boxShadow !== "none" || parseFloat(style.borderTopWidth) > 0 || parseFloat(style.borderRadius) > 0;
    const structural = /^(header|nav|main|section|article|aside|footer|form|figure|table|ul|ol|dl|h1|h2|h3|video|picture|img|svg|button|label|blockquote)$/.test(tag);
    const layout = (style.display === "flex" || style.display === "grid") && el.children.length >= 2;
    const buttonish = tag === "button" || (tag === "a" && BUTTONISH.test(classes));
    if (!structural && !layout && !buttonish && !(hasBackground && hasEdge)) continue;

    let guess = "section";
    if (tag === "img" || tag === "picture" || tag === "svg" || tag === "video") guess = "image";
    else if (style.backgroundImage.indexOf("url(") === 0) guess = "image";
    else if (buttonish) guess = "button";
    else if (tag === "header" || tag === "nav" || role === "navigation") guess = "nav";
    else if (tag === "footer" || role === "contentinfo") guess = "footer";
    else if (tag === "form" || tag === "label") guess = "form";
    else if (/^h[1-3]$/.test(tag)) guess = "type";
    else if (rect.top + scrollY < window.innerHeight && rect.height > window.innerHeight * 0.4) guess = "hero";
    else if (layout && el.children.length >= 3) guess = "grid";
    else if (hasEdge && own.length > 20) guess = "card";

    const heading = el.querySelector("h1, h2, h3, h4");
    const label =
      (heading ? text(heading) : "") ||
      (el.getAttribute("aria-label") || "").trim() ||
      (tag === "img" ? (el.getAttribute("alt") || "").trim() : "") ||
      own.slice(0, 60) ||
      (classes ? classes.split(/\s+/)[0] : "") ||
      tag;

    candidates.push({
      selector: selectorFor(el),
      tag,
      label: label.slice(0, 80),
      guess,
      x: Math.round(rect.left + scrollX),
      y: Math.round(rect.top + scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      area: Math.round(rect.width * rect.height),
      depth: (() => {
        let d = 0;
        let p = el.parentElement;
        while (p) {
          d += 1;
          p = p.parentElement;
        }
        return d;
      })(),
      text: own.slice(0, 220),
      styles: {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        textTransform: style.textTransform,
        color: style.color,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage === "none" ? "none" : style.backgroundImage.slice(0, 160),
        borderRadius: style.borderRadius,
        borderWidth: style.borderTopWidth,
        borderColor: style.borderTopColor,
        boxShadow: style.boxShadow === "none" ? "none" : style.boxShadow.slice(0, 160),
        padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
        display: style.display,
        gap: style.gap,
        justifyContent: style.justifyContent,
        alignItems: style.alignItems,
        textAlign: style.textAlign,
        transition: style.transitionDuration === "0s" ? "none" : `${style.transitionDuration} ${style.transitionTimingFunction}`,
      },
    });
    if (candidates.length >= LIMIT_ELEMENTS) break;
  }

  // Collapse wrappers: a parent whose box matches a child within a few pixels
  // adds a selectable region that selects the same pixels. Keep the shallower
  // one — it is the one a designer means by "this block".
  candidates.sort((a, b) => b.area - a.area || a.depth - b.depth);
  const kept = [];
  for (const candidate of candidates) {
    const duplicate = kept.find(
      (other) =>
        Math.abs(other.x - candidate.x) < 6 &&
        Math.abs(other.y - candidate.y) < 6 &&
        Math.abs(other.width - candidate.width) < 8 &&
        Math.abs(other.height - candidate.height) < 8,
    );
    if (!duplicate) kept.push(candidate);
  }

  /* ------------------------------------------------------------ links ---- */

  const links = [];
  const seenHref = new Set();
  for (const anchor of document.querySelectorAll("a[href]")) {
    let href;
    try {
      href = new URL(anchor.getAttribute("href"), document.baseURI);
    } catch {
      continue;
    }
    if (href.protocol !== "http:" && href.protocol !== "https:") continue;
    href.hash = "";
    const key = href.toString();
    if (seenHref.has(key)) continue;
    seenHref.add(key);
    const rect = anchor.getBoundingClientRect();
    const anchorText = text(anchor).slice(0, 120);
    const context = anchor.closest("footer") ? text(anchor.parentElement || anchor).slice(0, 160) : "";
    links.push({
      href: key,
      host: href.hostname,
      anchor: anchorText,
      rel: anchor.getAttribute("rel") || "",
      inFooter: Boolean(anchor.closest("footer")) || rect.top + scrollY > pageHeight - 700,
      creditLike: CREDIT.test(anchorText) || CREDIT.test(context) || /author|designer|me\b/.test(anchor.getAttribute("rel") || ""),
    });
    if (links.length >= LIMIT_LINKS) break;
  }

  /* ---------------------------------------------------------- summary ---- */

  const topOf = (map, n) =>
    Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, n);

  return {
    meta,
    page: { width: pageWidth, height: pageHeight, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight },
    elements: kept,
    links,
    fonts: topOf(fontUse, 12).map((entry) => ({
      family: entry.family,
      count: entry.count,
      sizes: Object.keys(entry.sizes).map(Number).sort((a, b) => a - b),
      weights: Object.keys(entry.weights).sort(),
      sample: entry.sample,
    })),
    colors: topOf(colorUse, 18).map((entry) => ({
      hex: entry.hex,
      count: entry.count,
      role: Object.keys(entry.roles).sort((a, b) => entry.roles[b] - entry.roles[a])[0],
    })),
  };
})
