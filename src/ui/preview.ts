/**
 * An item shows the extracted thing itself, isolated, never the page it came
 * from (asi0, 30/09): a palette its bands with hex and role, a component its
 * own crop (or a live re-render from its computed styles) with its CSS, a
 * type item real glyphs in its family, size and weight. The source is a small
 * link underneath, drawn by the caller.
 */

import { mediaUrl } from "../api";
import type { ComponentData, ElevationData, Item, MoodData, PageData, PaletteData, RadiusData, RoleSpecimen, SpacingData, TextStyle, TypeFamilyData, TypePairData, TypeScaleData } from "../api";
import { num } from "../app";
import { bands, miniBands } from "./bands";
import type { BandColor } from "./bands";
import { h } from "./controls";
import { plate } from "./plate";

type Size = "row" | "detail";

const loadedFaces = new Set<string>();

/** OFL families kept with their files (open question 3) are set live, in their own glyphs. */
function liveFamily(files: { file: string; weight: string; style: string }[], family: string): string | null {
  if (!files.length) return null;
  const name = `drd-${family.replace(/[^a-z0-9]/gi, "").toLowerCase()}`;
  if (!loadedFaces.has(name)) {
    const css = files
      .map((f) => {
        const url = mediaUrl(f.file);
        return url ? `@font-face{font-family:"${name}";src:url("${url}");font-weight:${f.weight};font-style:${f.style};font-display:swap}` : "";
      })
      .join("\n");
    document.head.append(h("style", { text: css }));
    loadedFaces.add(name);
  }
  return name;
}

function paletteColors(data: Partial<PaletteData> & { roles?: Record<string, string>; ramp?: string[] }): BandColor[] {
  if (Array.isArray(data.colors) && data.colors.length) return data.colors.map((c) => ({ role: c.role || "couleur", hex: c.hex, value: c.value ?? null, share: c.share || c.textShare || undefined }));
  if (data.roles) return Object.entries(data.roles).filter(([, hex]) => typeof hex === "string" && hex.startsWith("#")).map(([role, hex]) => ({ role, hex, value: null }));
  if (Array.isArray(data.ramp)) return data.ramp.map((hex, i) => ({ role: String(i + 1), hex, value: null }));
  return [];
}

function styleCrop(style: Pick<TextStyle, "crop" | "family" | "size" | "weight" | "sample">, captureId: string | null): HTMLElement {
  return plate(mediaUrl(style.crop, captureId), `${style.sample} (${style.family} ${style.size} px, graisse ${style.weight})`);
}

const SPECIMEN_ROLE_LABEL: Record<RoleSpecimen["role"], string> = { display: "Display", titre: "Titre", corps: "Corps" };

/** A family as the page sets it: its display, title and running text, real crops with their size, leading and weight (C2). */
export function roleSpecimenRows(specimens: RoleSpecimen[], family: string, captureId: string | null): HTMLElement {
  return h(
    "div",
    { class: "styles" },
    specimens.map((s) =>
      h("div", { class: "style-row" }, [
        plate(mediaUrl(s.crop, captureId), `${s.sample} (${family} ${s.size} px, graisse ${s.weight})`),
        h("div", { class: "style-meta" }, [h("b", { text: SPECIMEN_ROLE_LABEL[s.role] }), h("span", { class: "val", text: `${num(s.size, s.size % 1 ? 1 : 0)} / ${num(s.lineHeight, 0)} · ${s.weight}` })]),
      ]),
    ),
  );
}

function componentLive(data: ComponentData): HTMLElement {
  const t = data.tokens;
  const el = h("span", {
    text: data.label || data.kindLabel,
    style: [
      `background:${t.background?.hex ?? "transparent"}`,
      `color:${t.foreground?.hex ?? "#111"}`,
      t.border && t.border.width ? `border:${t.border.width}px ${t.border.style} ${t.border.color?.hex ?? "currentColor"}` : "",
      `border-radius:${t.radius.map((r) => `${r}px`).join(" ")}`,
      `padding:${t.padding.map((p) => `${p}px`).join(" ")}`,
      `font-size:${Math.min(t.font.size, 48)}px`,
      `font-weight:${t.font.weight}`,
      `text-transform:${t.font.transform || "none"}`,
      t.shadow ? `box-shadow:${t.shadow}` : "",
      "display:inline-flex;align-items:center;max-width:100%;overflow:hidden;white-space:nowrap",
    ].join(";"),
  });
  return h("div", { class: "live-component", title: "Rendu en direct à partir des styles calculés" }, [el]);
}

export function itemPreview(item: Item, size: Size = "row"): HTMLElement {
  const data = (item.data ?? {}) as Record<string, unknown>;
  const wrap = h("div", { class: "preview" });
  const cap = item.captureId;

  switch (item.kind) {
    case "palette": {
      const colors = paletteColors(data as Partial<PaletteData>);
      wrap.append(size === "detail" ? bands(colors, { label: `Couleurs de ${item.title}` }) : miniBands(colors));
      if (size === "detail" && (data as Partial<PaletteData>).legacy) wrap.append(h("p", { class: "subtle", text: "Palette gardée avec DRD v1 : rôles tels que notés à l'époque, sans part de surface." }));
      break;
    }
    case "color": {
      const color = (data.color ?? {}) as { role?: string; hex?: string; value?: BandColor["value"]; share?: number };
      if (color.hex) {
        const one: BandColor[] = [{ role: color.role ?? "Couleur", hex: color.hex, value: color.value ?? null }];
        wrap.append(size === "detail" ? bands(one, { label: color.role ?? "Couleur" }) : miniBands(one));
      }
      break;
    }
    case "type": {
      if (item.subkind === "scale") {
        const d = data as unknown as TypeScaleData;
        const styles = (d.styles ?? []).filter((s) => s.crop).slice(0, size === "detail" ? 14 : 2);
        for (const style of styles) {
          wrap.append(size === "detail" ? h("div", { class: "style-row" }, [styleCrop(style, cap), h("div", { class: "style-meta" }, [h("b", { text: style.role }), h("span", { class: "val", text: `${num(style.size, style.size % 1 ? 1 : 0)} / ${num(style.lineHeight, 0)} · ${style.weight}` })])]) : styleCrop(style, cap));
        }
        if (d.ratio) wrap.append(h("p", { class: "val muted", text: `${d.ratioName} ≈ ${num(d.ratio, 3)} · corps ${d.body} px` }));
      } else if (item.subkind === "pair") {
        const d = data as unknown as TypePairData;
        for (const part of [d.display, d.text]) if (part) wrap.append(part.crop ? plate(mediaUrl(part.crop, cap), `${part.family} ${part.size} px`) : h("div", { class: "type-sample", text: part.family }));
      } else if (typeof data.family === "string" && Array.isArray((data as { specimens?: unknown }).specimens)) {
        const d = data as unknown as TypeFamilyData;
        const byRole = d.roleSpecimens ?? [];
        if (size === "detail" && byRole.length) wrap.append(roleSpecimenRows(byRole, d.family, cap));
        else if (byRole[0]) wrap.append(plate(mediaUrl(byRole[0].crop, cap), `${byRole[0].sample} (${d.family} ${byRole[0].size} px)`));
        const live = liveFamily(d.fontFiles ?? [], d.family);
        if (live && (size === "detail" || !byRole.length)) {
          const weight = d.weights[Math.floor(d.weights.length / 2)] ?? 400;
          wrap.append(h("div", { class: "type-sample", style: `font-family:"${live}";font-size:${size === "detail" ? 36 : 26}px;font-weight:${weight}`, text: "Aa Bb Gg Rr 0123 àéç" }));
        }
        for (const specimen of d.specimens.slice(0, size === "detail" ? 6 : live || byRole.length ? 0 : 1)) wrap.append(plate(mediaUrl(specimen.file, cap), `${d.family} graisse ${specimen.weight}`, "checker"));
      } else if (Array.isArray(data.samples) && data.samples.length) {
        // A v1 font reference: real text crops cut from its page at migration.
        for (const sample of (data.samples as { family: string; size: number; weight: number; text: string; crop: string }[]).slice(0, size === "detail" ? 4 : 2)) {
          wrap.append(plate(mediaUrl(sample.crop, cap), `${sample.text} (${sample.family} ${sample.size} px, graisse ${sample.weight})`));
        }
      } else if (data.display && typeof data.display === "object" && typeof (data.display as { family?: unknown }).family === "string") {
        // Atelier pairing: the bench's own self-hosted families, set live.
        const d = data as { display: { family: string; size: number; weight: number }; body?: { family: string; size: number; weight: number } };
        wrap.append(h("div", { class: "type-sample", style: `font-family:"${d.display.family}";font-size:${Math.min(d.display.size, size === "detail" ? 48 : 28)}px;font-weight:${d.display.weight}`, text: "Titre en situation" }));
        if (d.body) wrap.append(h("div", { class: "type-sample", style: `font-family:"${d.body.family}";font-size:${d.body.size}px;font-weight:${d.body.weight}`, text: "Le corps de texte, lisible et posé." }));
      }
      break;
    }
    case "component": {
      const d = data as unknown as ComponentData;
      if (d.crop) wrap.append(plate(mediaUrl(d.crop, cap), `${d.kindLabel ?? "Composant"} ${d.label ?? ""}`, "checker"));
      else if (d.tokens) wrap.append(componentLive(d));
      if (size === "detail" && d.hover?.crop) wrap.append(h("div", { class: "hover-pair" }, [h("figure", {}, [plate(mediaUrl(d.crop, cap), "Au repos"), h("figcaption", { text: "Au repos" })]), h("figure", {}, [plate(mediaUrl(d.hover.crop, cap), "Au survol"), h("figcaption", { text: "Au survol" })])]));
      if (size === "detail" && typeof d.css === "string") wrap.append(h("pre", { class: "code", text: d.css }));
      if (!d.crop && !d.tokens && typeof (data as { css?: unknown }).css === "string") wrap.append(h("pre", { class: "code", text: String((data as { css: string }).css).slice(0, size === "detail" ? 4000 : 400) }));
      break;
    }
    case "scale": {
      if (item.subkind === "spacing") {
        const d = data as unknown as SpacingData;
        wrap.append(h("div", { class: "spacing-bars" }, d.steps.map((step) => h("span", {}, [h("i", { style: `height:${Math.min(step, 120)}px` }), h("span", { class: "val", text: String(step) })]))));
      } else if (item.subkind === "radius") {
        const d = data as unknown as RadiusData;
        wrap.append(h("div", { class: "radius-row" }, d.byKind.flatMap((k) => k.values.map((v) => h("span", {}, [h("i", { style: `border-radius:${v === 999 ? "999px" : `${v}px`}` }), h("span", { class: "val", text: `${k.kindLabel} ${v === 999 ? "pilule" : `${v}px`}` })])))));
      } else if (item.subkind === "elevation") {
        const d = data as unknown as ElevationData;
        wrap.append(h("div", { class: "shadow-row" }, d.shadows.slice(0, size === "detail" ? 8 : 3).map((s) => h("div", { class: "shadow-cell" }, [h("div", { class: "shadow-plate", style: `box-shadow:${s.value}` }), size === "detail" ? h("span", { class: "val", text: s.value }) : h("span")]))));
      }
      break;
    }
    case "mood": {
      if (item.subkind === "image-original" || item.subkind === "image-derivative") {
        const image = mediaUrl(item.cover);
        if (image) wrap.append(h("img", { class: "visual-reference", src: image, alt: item.title, loading: "lazy" }));
        const palettes = Array.isArray(data.palettes) ? data.palettes as { intent: string; colors: { hex: string; share: number }[] }[] : [];
        if (size === "detail") {
          const label: Record<string, string> = { dominant: "Dominante", vibrant: "Vibrante", muted: "Douce et neutre" };
          for (const palette of palettes) {
            wrap.append(h("section", { class: "image-palette" }, [h("b", { text: label[palette.intent] ?? palette.intent }), bands(palette.colors.map((color) => ({ role: color.hex, hex: color.hex, value: null, share: color.share })), { label: label[palette.intent] ?? palette.intent })]));
          }
        } else if (palettes[0]) {
          wrap.append(miniBands(palettes[0].colors.map((color) => ({ role: color.hex, hex: color.hex, value: null, share: color.share }))));
        }
        break;
      }
      const d = data as unknown as MoodData;
      const crops = (d.images ?? []).filter((i) => i.crop);
      if (crops.length) wrap.append(h("div", { class: "mood-images" }, crops.slice(0, size === "detail" ? 6 : 3).map((i) => plate(mediaUrl(i.crop, cap), "Image de la page"))));
      if (d.palette?.length) wrap.append(h("div", { class: "strip" }, d.palette.map((c) => h("span", { style: `background:${c.hex};--w:${Math.max(0.2, c.share * 6)}`, title: c.hex }))));
      if (d.descriptors?.length) wrap.append(h("p", { class: "val muted", text: d.descriptors.map((x) => `${x.name.toLowerCase()} ${x.word}`).join(" · ") }));
      break;
    }
    case "page": {
      const d = data as Partial<PageData> & { meta?: Record<string, string> };
      const title = d.title || d.meta?.title || item.title;
      const color = d.themeColor || d.meta?.themeColor;
      wrap.append(
        h("div", { class: "family" }, [
          h("b", { text: title }),
          ...(d.description || d.meta?.description ? [h("p", { class: "muted", text: (d.description || d.meta?.description || "").slice(0, size === "detail" ? 400 : 120) })] : []),
          h("p", { class: "val muted", text: [d.width && d.height ? `${d.width} × ${d.height}` : "", d.lang ? `langue ${d.lang}` : "", d.darkScheme ? "thème sombre prévu" : ""].filter(Boolean).join(" · ") }),
          ...(color ? [h("span", { class: "val" }, [h("i", { class: "swatch-inline", style: `background:${color}` }), h("span", { text: `theme-color ${color}` })])] : []),
        ]),
      );
      break;
    }
    default:
      break;
  }
  if (!wrap.childElementCount) wrap.append(h("p", { class: "muted val", text: "Rien à montrer pour cet élément." }));
  return wrap;
}

