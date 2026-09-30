/**
 * Runs inside the captured page, in Chrome, with no access to anything of
 * ours. Plain JavaScript on purpose: it is evaluated as a string by the
 * capture runner, never bundled, and it must not depend on a build step.
 *
 * It returns geometry, computed style and measured colour only. No captured
 * HTML ever comes back: the client renders screenshots, crops and short text
 * samples, never markup from a page we do not control.
 *
 * The file is one function `(mode, arg) => result`; the runner calls it once
 * per stage. Elements the later stages need again (components, text-style
 * representatives, fixed layers) are tagged with `data-drd-*` attributes
 * during the DOM pass, so every later call finds the same nodes.
 */
((mode, arg) => {
  const W = window;
  const doc = document;
  const root = doc.documentElement;
  const vw = W.innerWidth;
  const vh = W.innerHeight;
  const scrollY = W.scrollY;
  const scrollX = W.scrollX;
  const pageWidth = Math.max(root.scrollWidth, vw);
  const pageHeight = Math.max(root.scrollHeight, doc.body ? doc.body.scrollHeight : 0, vh);

  /* ------------------------------------------------------------ colour ---- */

  const parsed = new Map();
  let ctx2d = null;

  /** Any computed colour string to [r, g, b, a] in sRGB, or null when invisible. */
  function rgba(value) {
    if (!value || value === "transparent" || value === "none" || value === "currentcolor") return null;
    const hit = parsed.get(value);
    if (hit !== undefined) return hit;
    let out = null;
    const m = /^rgba?\(([^)]+)\)$/.exec(value);
    if (m) {
      const parts = m[1].split(/[\s,/]+/).filter(Boolean);
      const n = parts.map((p) => (p.endsWith("%") ? (parseFloat(p) / 100) * (parts.indexOf(p) < 3 ? 255 : 1) : parseFloat(p)));
      if (n.length >= 3 && n.every((x) => Number.isFinite(x))) out = [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
    } else {
      // oklch(), lab(), color(display-p3 …): let the canvas convert, it
      // gamut-maps exactly the way the page itself was painted.
      if (!ctx2d) {
        const canvas = doc.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        ctx2d = canvas.getContext("2d", { willReadFrequently: true });
      }
      ctx2d.clearRect(0, 0, 1, 1);
      ctx2d.fillStyle = "#000";
      ctx2d.fillStyle = value;
      ctx2d.fillRect(0, 0, 1, 1);
      const d = ctx2d.getImageData(0, 0, 1, 1).data;
      out = [d[0], d[1], d[2], d[3] / 255];
    }
    if (out && out[3] < 0.02) out = null;
    parsed.set(value, out);
    return out;
  }

  const over = (top, bottom) => {
    const a = top[3];
    return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
  };
  const key = (c) => `${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])}`;
  const WHITE = [255, 255, 255, 1];
  const COLOR_TOKEN = /(rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)|color\([^)]*\)|hsla?\([^)]*\))/gi;

  const styles = new Map();
  const css = (el) => {
    let s = styles.get(el);
    if (!s) {
      s = W.getComputedStyle(el);
      styles.set(el, s);
    }
    return s;
  };

  /**
   * What is painted behind an element: its own and its ancestors' background
   * layers composited down to the first opaque one (the canvas is white).
   * `image` is true when a background image or media sits in that stack, so
   * the colour is not the whole story.
   */
  const backdrops = new Map();
  function backdrop(el) {
    const cached = backdrops.get(el);
    if (cached) return cached;
    const layers = [];
    let image = false;
    let gradient = null;
    let node = el;
    while (node && node.nodeType === 1) {
      const s = css(node);
      const tag = node.tagName;
      if (tag === "IMG" || tag === "VIDEO" || tag === "CANVAS" || tag === "PICTURE") image = true;
      const bi = s.backgroundImage;
      if (bi && bi !== "none") {
        if (bi.indexOf("url(") >= 0) image = true;
        else if (!gradient && bi.indexOf("gradient(") >= 0) {
          const first = (bi.match(COLOR_TOKEN) || [])[0];
          const c = first ? rgba(first) : null;
          if (c) gradient = [c[0], c[1], c[2], 1];
        }
      }
      const bg = rgba(s.backgroundColor);
      if (bg) {
        layers.push(bg);
        if (bg[3] >= 0.99) break;
      }
      if (gradient && !bg) {
        layers.push(gradient);
        break;
      }
      node = node.parentElement;
    }
    let color = WHITE;
    for (let i = layers.length - 1; i >= 0; i -= 1) color = over(layers[i], color);
    const result = { color, image };
    backdrops.set(el, result);
    return result;
  }

  /** What is painted at a viewport point: every layer of the hit-test stack, top down, to the first opaque one. */
  function backdropAt(x, y) {
    const layers = [];
    let image = false;
    for (const el of doc.elementsFromPoint(x, y)) {
      const tag = el.tagName;
      if (tag === "IMG" || tag === "VIDEO" || tag === "CANVAS" || tag === "PICTURE" || tag === "IFRAME") {
        image = true;
        break;
      }
      if (tag === "svg" || tag === "SVG") {
        const r = el.getBoundingClientRect();
        if (r.width * r.height > 14400) {
          image = true;
          break;
        }
      }
      if (el instanceof SVGElement) continue;
      const s = css(el);
      if (opacity(el) < 0.05) continue;
      const bi = s.backgroundImage;
      const own = rgba(s.backgroundColor);
      // A layer faded with `opacity` lets what is below show through.
      const fade = opacity(el);
      const bg = own ? [own[0], own[1], own[2], own[3] * fade] : null;
      if (bg) layers.push(bg);
      if (bg && bg[3] >= 0.99) break;
      if (bi && bi !== "none") {
        if (bi.indexOf("url(") >= 0) {
          image = true;
          break;
        }
        const first = (bi.match(COLOR_TOKEN) || [])[0];
        const c = first ? rgba(first) : null;
        if (c) {
          layers.push([c[0], c[1], c[2], 1]);
          break;
        }
      }
    }
    let color = WHITE;
    for (let i = layers.length - 1; i >= 0; i -= 1) color = over(layers[i], color);
    return { color, image };
  }

  const opacities = new Map();
  function opacity(el) {
    if (!el || el.nodeType !== 1) return 1;
    const hit = opacities.get(el);
    if (hit !== undefined) return hit;
    const value = Number(css(el).opacity) * opacity(el.parentElement);
    opacities.set(el, value);
    return value;
  }

  function visible(el, rect) {
    if (!rect || rect.width < 1 || rect.height < 1) return false;
    if (typeof el.checkVisibility === "function" && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
    return opacity(el) >= 0.1;
  }

  const pageBox = (r) => ({ x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) });
  const viewBox = (r) => ({ x: r.left, y: r.top, width: r.width, height: r.height });
  const px = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim();

  /* ------------------------------------------------------------- modes ---- */

  if (mode === "scrollTo") {
    root.style.setProperty("scroll-behavior", "auto", "important");
    if (doc.body) doc.body.style.setProperty("scroll-behavior", "auto", "important");
    W.scrollTo({ top: arg, left: 0, behavior: "instant" });
    return { y: W.scrollY, height: pageHeight, viewport: vh };
  }

  if (mode === "metrics") {
    return { width: pageWidth, height: pageHeight, viewportWidth: vw, viewportHeight: vh, y: scrollY };
  }

  if (mode === "hideFixed" || mode === "showFixed") {
    let style = doc.getElementById("drd-hide-fixed");
    if (mode === "hideFixed" && !style) {
      style = doc.createElement("style");
      style.id = "drd-hide-fixed";
      style.textContent = "[data-drd-f]{visibility:hidden!important}";
      (doc.head || root).appendChild(style);
    }
    if (mode === "showFixed" && style) style.remove();
    return true;
  }

  if (mode === "inview") {
    // Components and text-style representatives fully inside the viewport,
    // and settled: a reveal animation that is still fading would crop grey.
    const out = [];
    const hidden = Boolean(doc.getElementById("drd-hide-fixed"));
    for (const el of doc.querySelectorAll("[data-drd-c],[data-drd-t]")) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (hidden && el.closest("[data-drd-f]")) continue;
      if (r.top < 0 || r.left < 0 || r.bottom > vh || r.right > vw) continue;
      const settled = opacity(el) >= 0.98;
      if (el.hasAttribute("data-drd-c")) out.push({ kind: "c", id: Number(el.getAttribute("data-drd-c")), box: viewBox(r), settled });
      if (el.hasAttribute("data-drd-t")) out.push({ kind: "t", id: Number(el.getAttribute("data-drd-t")), box: viewBox(r), settled });
    }
    return out;
  }

  if (mode === "sample") {
    // Which colour is painted at every point of a 24 px grid: that is area,
    // the thing an element count can never measure. The whole hit-test stack
    // is read, not the ancestors: site builders paint section backgrounds on
    // a sibling layer behind the content, which no ancestor walk ever sees.
    const step = arg.step || 24;
    const from = arg.from || 0;
    const unlock = doc.createElement("style");
    unlock.textContent = "*,*::before,*::after{pointer-events:auto!important}";
    (doc.head || root).appendChild(unlock);
    const bg = {};
    let img = 0;
    let total = 0;
    try {
      for (let y = step / 2; y < vh; y += step) {
        const py = scrollY + y;
        if (py < from || py >= pageHeight) continue;
        for (let x = step / 2; x < vw; x += step) {
          total += 1;
          const b = backdropAt(x, y);
          if (b.image) {
            img += 1;
            continue;
          }
          const k = key(b.color);
          bg[k] = (bg[k] || 0) + 1;
        }
      }
      // Text runs whose centre is on this screen: the colour really behind them.
      const at = {};
      for (const [index, cx, cy] of arg.points || []) {
        const vy = cy - scrollY;
        if (vy < 0 || vy >= vh || cx < 0 || cx >= vw) continue;
        const b = backdropAt(cx, vy);
        at[index] = [b.image ? null : key(b.color), b.image];
      }
      return { bg, img, total, at };
    } finally {
      unlock.remove();
    }
  }

  if (mode === "hoverStyle") {
    const el = doc.querySelector(`[data-drd-c="${Number(arg)}"]`);
    if (!el) return null;
    const s = W.getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const bgc = rgba(s.backgroundColor);
    const fg = rgba(s.color);
    const bc = rgba(s.borderTopColor);
    return {
      background: bgc ? key(backdrop(el).color) : null,
      color: fg ? key(over(fg, backdrop(el).color)) : null,
      borderColor: bc && px(s.borderTopWidth) > 0 ? key(over(bc, backdrop(el).color)) : null,
      boxShadow: s.boxShadow,
      transform: s.transform,
      textDecoration: s.textDecorationLine,
      opacity: s.opacity,
      box: viewBox(r),
    };
  }

  if (mode === "specimen") {
    const old = doc.getElementById("drd-specimen");
    if (old) old.remove();
    const node = doc.createElement("div");
    node.id = "drd-specimen";
    node.textContent = arg.text;
    node.setAttribute(
      "style",
      [
        "position:fixed", "left:0", "top:0", "z-index:2147483647", "margin:0", "padding:18px 22px",
        "background:#ffffff", "color:#161616", "white-space:nowrap", "font-size:44px", "line-height:1.25",
        `font-family:${arg.stack}`, `font-weight:${arg.weight}`, `font-style:${arg.italic ? "italic" : "normal"}`,
        "letter-spacing:0", "text-transform:none", "font-variation-settings:normal", "opacity:1", "visibility:visible",
        "transform:none", "filter:none", "max-width:none", "width:auto",
      ].join(";"),
    );
    root.appendChild(node);
    const r = node.getBoundingClientRect();
    return viewBox(r);
  }

  if (mode === "unspecimen") {
    const old = doc.getElementById("drd-specimen");
    if (old) old.remove();
    return true;
  }

  if (mode === "resolveVars") {
    const out = [];
    const probe = doc.createElement("span");
    probe.style.display = "none";
    root.appendChild(probe);
    const rootStyle = W.getComputedStyle(root);
    for (const name of arg.slice(0, 400)) {
      const value = rootStyle.getPropertyValue(name).trim();
      if (!value) continue;
      probe.style.color = "";
      probe.style.color = `var(${name})`;
      const color = probe.style.color ? rgba(W.getComputedStyle(probe).color) : null;
      out.push({ name, value: value.slice(0, 200), color: color && /^(#|rgb|hsl|oklch|oklab|lab|lch|color\()/i.test(value) ? key(over(color, WHITE)) : null });
    }
    probe.remove();
    return out;
  }

  if (mode !== "dom") throw new Error(`unknown mode ${mode}`);

  /* ------------------------------------------------------------ DOM pass --- */

  const LIMITS = { elements: 15000, runs: 4000, components: 140, images: 80, links: 300, styles: 40, boxes: 40 };

  const metaContent = (selector) => {
    const node = doc.querySelector(selector);
    return node ? clean(node.getAttribute("content")) : "";
  };
  const iconLink = doc.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
  const canonical = doc.querySelector('link[rel="canonical"]');
  const meta = {
    title: clean(doc.title),
    description: metaContent('meta[name="description"]') || metaContent('meta[property="og:description"]'),
    siteName: metaContent('meta[property="og:site_name"]'),
    ogImage: metaContent('meta[property="og:image"]'),
    themeColor: metaContent('meta[name="theme-color"]'),
    generator: metaContent('meta[name="generator"]'),
    lang: clean(root.getAttribute("lang")),
    canonical: canonical ? canonical.href : "",
    favicon: iconLink ? iconLink.href : "",
  };

  // Clear tags from a previous run in this same page (a retried stage).
  for (const el of doc.querySelectorAll("[data-drd-c],[data-drd-t],[data-drd-f]")) {
    el.removeAttribute("data-drd-c");
    el.removeAttribute("data-drd-t");
    el.removeAttribute("data-drd-f");
  }

  const colors = new Map();
  function usage(c) {
    const k = key(c);
    let u = colors.get(k);
    if (!u) {
      u = { rgb: k, bgCount: 0, bgArea: 0, textArea: 0, textCount: 0, border: 0, interactive: 0, svg: 0, gradient: 0, where: {}, bgBoxes: [], textBoxes: [], states: {} };
      colors.set(k, u);
    }
    return u;
  }
  const note = (u, tag) => {
    u.where[tag] = (u.where[tag] || 0) + 1;
  };
  const STATE = [
    ["error", /(^|[\s_-])(error|errors|invalid|danger|alert-danger|is-error|has-error)([\s_-]|$)/i],
    ["warning", /(^|[\s_-])(warning|warn|caution|alert-warning)([\s_-]|$)/i],
    ["success", /(^|[\s_-])(success|valid|is-valid|alert-success|confirmed)([\s_-]|$)/i],
  ];
  function stateOf(el) {
    const cls = typeof el.className === "string" ? el.className : "";
    if (el.getAttribute("aria-invalid") === "true") return "error";
    for (const [name, re] of STATE) if (re.test(cls) || re.test(el.getAttribute("role") === "alert" ? "alert-danger" : "")) return name;
    return null;
  }
  const INTERACTIVE = "a[href],button,input,select,textarea,[role=button],[role=link],summary";

  const all = Array.prototype.slice.call(doc.body ? doc.body.querySelectorAll("*") : [], 0, LIMITS.elements);
  const rects = new Map();
  const rectOf = (el) => {
    let r = rects.get(el);
    if (!r) {
      r = el.getBoundingClientRect();
      rects.set(el, r);
    }
    return r;
  };

  const spacing = {};
  const widths = {};
  const columns = {};
  const shadows = {};
  const bump = (map, k, n = 1) => {
    map[k] = (map[k] || 0) + n;
  };
  const SVG_SHAPES = /^(path|circle|rect|polygon|ellipse|line|polyline|text|use)$/i;

  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "template" || tag === "link" || tag === "meta") continue;
    const r = rectOf(el);
    if (!visible(el, r)) continue;
    const s = css(el);
    const area = r.width * r.height;
    const interactive = el.matches(INTERACTIVE);
    const state = stateOf(el);

    if (el instanceof SVGElement) {
      if (SVG_SHAPES.test(tag)) {
        const behind = backdrop(el.ownerSVGElement || el.parentElement || el).color;
        for (const prop of ["fill", "stroke"]) {
          const v = s[prop];
          if (!v || v === "none" || v.indexOf("url(") >= 0) continue;
          const c = rgba(v);
          if (!c) continue;
          const u = usage(over(c, behind));
          u.svg += Math.min(area, 40000);
          note(u, "svg");
        }
      }
      continue;
    }

    const own = rgba(s.backgroundColor);
    if (own) {
      const behind = el.parentElement ? backdrop(el.parentElement).color : WHITE;
      const u = usage(over(own, behind));
      u.bgCount += 1;
      u.bgArea += area;
      if (interactive) u.interactive += area;
      if (state) u.states[state] = (u.states[state] || 0) + 1;
      if (u.bgBoxes.length < LIMITS.boxes && area >= 64) u.bgBoxes.push(pageBox(r));
      note(u, tag);
    }
    const bi = s.backgroundImage;
    if (bi && bi !== "none" && bi.indexOf("gradient(") >= 0) {
      const stops = bi.match(COLOR_TOKEN) || [];
      for (const stop of stops) {
        const c = rgba(stop);
        if (!c) continue;
        const u = usage(over(c, WHITE));
        u.gradient += area / stops.length;
        note(u, tag);
      }
    }
    const sides = [
      ["Top", r.width],
      ["Bottom", r.width],
      ["Left", r.height],
      ["Right", r.height],
    ];
    for (const [side, length] of sides) {
      const w = px(s[`border${side}Width`]);
      if (w <= 0 || s[`border${side}Style`] === "none" || s[`border${side}Style`] === "hidden") continue;
      const c = rgba(s[`border${side}Color`]);
      if (!c) continue;
      const u = usage(over(c, backdrop(el).color));
      u.border += w * length;
      if (state) u.states[state] = (u.states[state] || 0) + 1;
      note(u, tag);
    }

    if (s.boxShadow && s.boxShadow !== "none" && area >= 400) bump(shadows, s.boxShadow.slice(0, 200));

    if (area >= 2000 && el.children.length >= 1 && tag !== "svg") {
      for (const side of ["Top", "Right", "Bottom", "Left"]) {
        const v = px(s[`padding${side}`]);
        if (v > 0 && v <= 256) bump(spacing, String(Math.round(v * 2) / 2));
      }
      for (const side of ["Top", "Bottom"]) {
        const v = px(s[`margin${side}`]);
        if (v > 0 && v <= 256) bump(spacing, String(Math.round(v * 2) / 2));
      }
      if (s.display.indexOf("flex") >= 0 || s.display.indexOf("grid") >= 0) {
        for (const g of [s.rowGap, s.columnGap]) {
          const v = px(g);
          if (v > 0 && v <= 256) bump(spacing, String(Math.round(v * 2) / 2));
        }
      }
      if (r.width >= 480 && r.width <= vw - 16 && Math.abs(r.left - (vw - r.right)) <= 2) bump(widths, String(Math.round(r.width)));
      if (s.display.indexOf("grid") >= 0 && el.children.length >= 3) {
        const tracks = s.gridTemplateColumns.split(/\s+(?![^(]*\))/).filter(Boolean).length;
        if (tracks >= 2 && tracks <= 12) bump(columns, String(tracks), el.children.length);
      }
    }
  }

  /* ---------------------------------------------------------- text runs --- */

  const ownText = new Map();
  if (doc.body) {
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = node.nodeValue;
      if (!value || !/\S/.test(value)) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      if (parent.closest("script,style,noscript,template,svg,textarea,[aria-hidden=true] svg")) continue;
      ownText.set(parent, (ownText.get(parent) || "") + value);
    }
  }

  const runs = [];
  const styleGroups = new Map();
  for (const [el, raw] of ownText) {
    if (runs.length >= LIMITS.runs) break;
    const text = clean(raw);
    if (!text) continue;
    const r = rectOf(el);
    if (!visible(el, r)) continue;
    const s = css(el);
    const size = px(s.fontSize);
    if (size < 4) continue;
    const lineHeight = s.lineHeight === "normal" ? Math.round(size * 1.2 * 10) / 10 : px(s.lineHeight);
    const tracking = s.letterSpacing === "normal" ? 0 : px(s.letterSpacing);
    const fg = rgba(s.color);
    if (!fg) continue;
    const b = backdrop(el);
    const color = over(fg, b.color);
    const heading = el.closest("h1,h2,h3,h4,h5,h6");
    const context = {
      heading: heading ? Number(heading.tagName[1]) : 0,
      button: Boolean(el.closest("button,[role=button],input[type=submit],input[type=button]")),
      link: Boolean(el.closest("a[href]")),
      nav: Boolean(el.closest("nav,[role=navigation],header")),
      footer: Boolean(el.closest("footer,[role=contentinfo]")),
      label: Boolean(el.closest("label,legend")),
      mono: Boolean(el.closest("code,pre,kbd,samp")),
      small: Boolean(el.closest("small,figcaption,sup,sub")),
    };
    const chars = text.length;
    const glyph = chars * size * size * 0.5;
    const run = {
      text: text.slice(0, 80),
      chars,
      tag: el.tagName.toLowerCase(),
      family: s.fontFamily,
      size,
      weight: Number(s.fontWeight) || 400,
      lineHeight,
      tracking,
      transform: s.textTransform,
      italic: s.fontStyle !== "normal",
      variation: s.fontVariationSettings === "normal" ? "" : s.fontVariationSettings,
      color: key(color),
      background: b.image ? null : key(b.color),
      onImage: b.image,
      glyph,
      box: pageBox(r),
      context,
      style: -1,
    };
    const u = usage(color);
    u.textArea += glyph;
    u.textCount += 1;
    if (context.button || context.link || el.matches(INTERACTIVE)) u.interactive += glyph;
    const state = stateOf(el) || (el.parentElement ? stateOf(el.parentElement) : null);
    if (state) u.states[state] = (u.states[state] || 0) + 1;
    if (u.textBoxes.length < LIMITS.boxes) u.textBoxes.push(run.box);
    note(u, run.tag);

    const groupKey = [s.fontFamily, run.weight, Math.round(size * 2) / 2, Math.round((lineHeight / size) * 20) / 20, Math.round((tracking / size) * 200) / 200, run.transform, run.italic ? 1 : 0].join("|");
    let group = styleGroups.get(groupKey);
    if (!group) {
      group = { key: groupKey, glyph: 0, runs: 0, rep: null, repGlyph: -1, locations: [] };
      styleGroups.set(groupKey, group);
    }
    group.glyph += glyph;
    group.runs += 1;
    if (group.locations.length < LIMITS.boxes) group.locations.push(run.box);
    // The representative is the biggest block that still fits a viewport, so
    // the crop can be taken from a real, settled screen of the page.
    if (glyph > group.repGlyph && r.height <= vh * 0.8 && r.width <= vw) {
      group.rep = el;
      group.repGlyph = glyph;
      group.repRun = runs.length;
    }
    run.style = groupKey;
    runs.push(run);
  }

  const textStyles = [...styleGroups.values()]
    .filter((g) => g.rep)
    .sort((a, b) => b.glyph - a.glyph)
    .slice(0, LIMITS.styles)
    .map((g, index) => {
      g.rep.setAttribute("data-drd-t", String(index));
      return { id: index, key: g.key, glyph: g.glyph, runs: g.runs, rep: g.repRun, locations: g.locations };
    });

  /* --------------------------------------------------------- components --- */

  const components = [];
  const taken = new Set();
  const tokensOf = (el) => {
    const s = css(el);
    const r = rectOf(el);
    const behind = el.parentElement ? backdrop(el.parentElement).color : WHITE;
    const own = rgba(s.backgroundColor);
    const fg = rgba(s.color);
    const bc = rgba(s.borderTopColor);
    return {
      background: own ? key(over(own, behind)) : null,
      backgroundImage: s.backgroundImage === "none" ? null : (s.backgroundImage.indexOf("url(") >= 0 ? "image" : "gradient"),
      color: fg ? key(over(fg, backdrop(el).color)) : null,
      borderWidth: px(s.borderTopWidth),
      borderStyle: s.borderTopStyle,
      borderColor: bc && px(s.borderTopWidth) > 0 ? key(over(bc, backdrop(el).color)) : null,
      radius: [px(s.borderTopLeftRadius), px(s.borderTopRightRadius), px(s.borderBottomRightRadius), px(s.borderBottomLeftRadius)],
      padding: [px(s.paddingTop), px(s.paddingRight), px(s.paddingBottom), px(s.paddingLeft)],
      width: Math.round(r.width),
      height: Math.round(r.height),
      gap: s.display.indexOf("flex") >= 0 || s.display.indexOf("grid") >= 0 ? px(s.columnGap) || px(s.rowGap) : 0,
      fontFamily: s.fontFamily,
      fontSize: px(s.fontSize),
      fontWeight: Number(s.fontWeight) || 400,
      lineHeight: s.lineHeight === "normal" ? null : px(s.lineHeight),
      letterSpacing: s.letterSpacing === "normal" ? 0 : px(s.letterSpacing),
      textTransform: s.textTransform,
      shadow: s.boxShadow === "none" ? null : s.boxShadow.slice(0, 240),
      transition: s.transitionDuration && s.transitionDuration !== "0s" ? { duration: s.transitionDuration.split(",")[0].trim(), easing: s.transitionTimingFunction.split(/,(?![^(]*\))/)[0].trim(), property: s.transitionProperty.split(",")[0].trim() } : null,
    };
  };
  const nameOf = (el) => {
    const aria = clean(el.getAttribute("aria-label"));
    if (aria) return aria;
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = clean(by.split(/\s+/).map((id) => (doc.getElementById(id) || {}).textContent || "").join(" "));
      if (t) return t;
    }
    if (el.tagName === "INPUT") {
      const v = clean(el.getAttribute("value")) || clean(el.getAttribute("placeholder"));
      if (v) return v;
      if (el.id) {
        const label = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label && clean(label.textContent)) return clean(label.textContent);
      }
    }
    const own = clean(ownText.get(el));
    if (own) return own;
    const heading = el.querySelector("h1,h2,h3,h4,h5,h6");
    if (heading && clean(heading.textContent)) return clean(heading.textContent);
    const img = el.querySelector("img[alt]");
    if (img && clean(img.getAttribute("alt"))) return clean(img.getAttribute("alt"));
    // Visible text inside, never script source: own text of descendants only.
    let text = "";
    for (const [node, value] of ownText) {
      if (text.length > 60) break;
      if (node !== el && el.contains(node)) text += " " + value;
    }
    return clean(text);
  };
  const hasSurface = (el) => {
    const s = css(el);
    const own = rgba(s.backgroundColor);
    const parent = el.parentElement ? backdrop(el.parentElement).color : WHITE;
    const differs = own && key(over(own, parent)) !== key(parent);
    return Boolean(differs || px(s.borderTopWidth) > 0 || px(s.borderBottomWidth) > 0 || s.boxShadow !== "none" || (s.backgroundImage !== "none" && s.backgroundImage.indexOf("gradient") >= 0));
  };
  const addComponent = (el, kind) => {
    if (components.length >= LIMITS.components || taken.has(el)) return;
    const r = rectOf(el);
    if (!visible(el, r)) return;
    taken.add(el);
    const id = components.length;
    el.setAttribute("data-drd-c", String(id));
    const s = css(el);
    components.push({
      id,
      kind,
      tag: el.tagName.toLowerCase(),
      name: nameOf(el).slice(0, 80),
      box: pageBox(r),
      fixed: s.position === "fixed" || s.position === "sticky",
      tokens: tokensOf(el),
      state: stateOf(el),
    });
  };

  // Navigation, footer, hero first: they are single and structural.
  const navCandidates = [...doc.querySelectorAll("header, nav, [role=navigation]")].filter((el) => {
    if (el.tagName === "HEADER" && el.querySelectorAll("a[href]").length < 3) return false;
    return !el.parentElement || !el.parentElement.closest("header, nav, [role=navigation]");
  });
  for (const el of navCandidates.slice(0, 4)) addComponent(el, "navigation");

  const h1 = doc.querySelector("h1");
  if (h1) {
    let node = h1;
    let hero = null;
    while (node && node !== doc.body && node !== root) {
      const r = rectOf(node);
      if (r.top + scrollY < vh && r.height >= vh * 0.4 && r.width >= vw * 0.6) {
        hero = node;
        break;
      }
      node = node.parentElement;
    }
    if (hero && rectOf(hero).height <= vh * 2.2) addComponent(hero, "hero");
  }

  for (const el of [...doc.querySelectorAll("footer, [role=contentinfo]")].filter((el) => !el.parentElement || !el.parentElement.closest("footer, [role=contentinfo]")).slice(0, 2)) {
    addComponent(el, "footer");
  }

  let buttons = 0;
  for (const el of doc.querySelectorAll("button, input[type=submit], input[type=button], [role=button], a[href]")) {
    if (buttons >= 48) break;
    const r = rectOf(el);
    if (r.width < 24 || r.height < 20 || r.height > 140 || r.width > vw * 0.9) continue;
    const s = css(el);
    const isLink = el.tagName === "A";
    if (isLink) {
      const hpad = Math.min(px(s.paddingLeft), px(s.paddingRight));
      const radius = px(s.borderTopLeftRadius);
      if (!hasSurface(el) || !(hpad >= 8 || radius > 0)) continue;
      // An image link with a border is a card or a thumbnail, not a button.
      if (el.querySelector("img, picture, video") && r.height > 80) continue;
    }
    addComponent(el, isLink ? "link-button" : "button");
    buttons += 1;
  }

  let fields = 0;
  for (const el of doc.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea, select")) {
    if (fields >= 12) break;
    const r = rectOf(el);
    if (r.width < 40 || r.height < 16) continue;
    addComponent(el, "field");
    fields += 1;
  }
  for (const el of [...doc.querySelectorAll("form")].slice(0, 4)) {
    if (el.querySelector("input:not([type=hidden]), textarea, select")) addComponent(el, "form");
  }

  // Cards: repetition is the signal. Siblings sharing a structural signature,
  // three or more, each with a surface of its own.
  const stem = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] || "" : "";
    return `${el.tagName}.${cls.replace(/(--|__)[\w-]*$/, "").replace(/[-_]?\d+$/, "")}`;
  };
  let cards = 0;
  const parents = new Set();
  for (const el of all) if (el.children.length >= 3) parents.add(el);
  for (const parent of parents) {
    if (cards >= 36) break;
    const groups = new Map();
    for (const child of parent.children) {
      const r = rectOf(child);
      if (r.width < 120 || r.height < 80 || !visible(child, r)) continue;
      const sig = stem(child);
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig).push(child);
    }
    for (const members of groups.values()) {
      if (members.length < 3) continue;
      const boxed = members.filter((m) => {
        if (hasSurface(m) || px(css(m).borderTopLeftRadius) > 0) return true;
        // The surface is often one wrapper down (a link around the card).
        const only = m.children.length === 1 ? m.children[0] : null;
        return Boolean(only && (hasSurface(only) || px(css(only).borderTopLeftRadius) > 0));
      });
      if (boxed.length < 3) continue;
      for (const m of boxed.slice(0, 8)) {
        if (cards >= 36) break;
        const target = hasSurface(m) || px(css(m).borderTopLeftRadius) > 0 ? m : m.children[0];
        if (rectOf(target).height > vh * 1.5) continue;
        addComponent(target, "card");
        cards += 1;
      }
    }
  }

  let badges = 0;
  for (const el of all) {
    if (badges >= 12) break;
    if (taken.has(el) || el.matches(INTERACTIVE) || el.closest("a[href],button")) continue;
    const r = rectOf(el);
    if (r.height < 14 || r.height > 32 || r.width > 200 || r.width < 20) continue;
    const text = clean(ownText.get(el));
    if (!text || text.length > 24) continue;
    const s = css(el);
    if (!hasSurface(el) || px(s.borderTopLeftRadius) < 2) continue;
    addComponent(el, "badge");
    badges += 1;
  }

  /* ------------------------------------------------------------- images --- */

  const images = [];
  for (const el of all) {
    if (images.length >= LIMITS.images) break;
    const tag = el.tagName;
    const r = rectOf(el);
    if (r.width < 48 || r.height < 48 || !visible(el, r)) continue;
    let kind = null;
    if (tag === "IMG" && el.complete && el.naturalWidth > 0) kind = "img";
    else if (tag === "VIDEO") kind = "video";
    else if (tag === "CANVAS") kind = "canvas";
    else if ((tag === "svg" || tag === "SVG") && r.width >= 120 && r.height >= 120) kind = "svg";
    else if (css(el).backgroundImage.indexOf("url(") >= 0) kind = "background";
    if (!kind) continue;
    images.push({ kind, box: pageBox(r), alt: tag === "IMG" ? clean(el.getAttribute("alt")).slice(0, 80) : "" });
  }

  /* ------------------------------------------------------- fixed layers --- */

  const fixed = [];
  for (const el of all) {
    const s = css(el);
    if (s.position !== "fixed" && s.position !== "sticky") continue;
    if (el.parentElement && el.parentElement.closest("[data-drd-f]")) continue;
    const r = rectOf(el);
    if (r.width * r.height < 1000 || !visible(el, r)) continue;
    el.setAttribute("data-drd-f", "1");
    fixed.push({ position: s.position, box: pageBox(r), tag: el.tagName.toLowerCase() });
  }

  /* -------------------------------------------------- stylesheets ---------- */

  const customProperties = new Set();
  let darkScheme = false;
  const walkRules = (rules) => {
    for (const rule of rules) {
      if (rule.media && /prefers-color-scheme:\s*dark/.test(rule.media.mediaText || "")) darkScheme = true;
      if (rule.selectorText && /(^|,)\s*(:root|html)\b/.test(rule.selectorText) && rule.style) {
        for (let i = 0; i < rule.style.length; i += 1) {
          const name = rule.style[i];
          if (name.startsWith("--")) customProperties.add(name);
        }
      }
      if (rule.cssRules) walkRules(rule.cssRules);
    }
  };
  for (const sheet of doc.styleSheets) {
    try {
      walkRules(sheet.cssRules);
    } catch {
      // Cross-origin sheet: the runner reads its text from the network instead.
    }
  }

  /* ------------------------------------------------------------- links --- */

  const CREDIT = /(site|website|design(ed)?|built|made|developed|crafted|réalis|conçu|développé|created)\s+(by|par)|^(by|par)\s|credits?|colophon/i;
  const links = [];
  const seenHref = new Set();
  for (const anchor of doc.querySelectorAll("a[href]")) {
    let href;
    try {
      href = new URL(anchor.getAttribute("href"), doc.baseURI);
    } catch {
      continue;
    }
    if (href.protocol !== "http:" && href.protocol !== "https:") continue;
    href.hash = "";
    const k = href.toString();
    if (seenHref.has(k)) continue;
    seenHref.add(k);
    const r = anchor.getBoundingClientRect();
    const anchorText = clean(anchor.textContent).slice(0, 120);
    const context = anchor.closest("footer") ? clean((anchor.parentElement || anchor).textContent).slice(0, 160) : "";
    links.push({
      href: k,
      host: href.hostname,
      anchor: anchorText,
      rel: anchor.getAttribute("rel") || "",
      inFooter: Boolean(anchor.closest("footer")) || r.top + scrollY > pageHeight - 700,
      creditLike: CREDIT.test(anchorText) || CREDIT.test(context) || /author|designer|me\b/.test(anchor.getAttribute("rel") || ""),
    });
    if (links.length >= LIMITS.links) break;
  }

  return {
    meta,
    page: { width: pageWidth, height: pageHeight, viewportWidth: vw, viewportHeight: vh },
    colors: [...colors.values()],
    runs,
    textStyles,
    components,
    images,
    fixed,
    spacing,
    widths,
    columns,
    shadows,
    customProperties: [...customProperties],
    darkScheme,
    links,
  };
})
