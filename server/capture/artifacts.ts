/**
 * What one capture leaves on disk, and the only thing the analysis reads.
 *
 * The capture needs a browser and the network; the analysis must not. This
 * file is the seam between them: `media/<capture>/artifacts.json` plus the
 * images it names. A capture written by version 1 of the pipeline has no
 * artifacts file; `server/analyse/load.ts` rebuilds a partial one from its
 * database rows so old captures can still be analysed.
 */

export type Box = { x: number; y: number; width: number; height: number };

/** `"r,g,b"` in sRGB 0-255, already composited over what is painted behind. */
export type RgbKey = string;

export type ColorUsage = {
  rgb: RgbKey;
  bgCount: number;
  bgArea: number;
  textArea: number;
  textCount: number;
  border: number;
  interactive: number;
  svg: number;
  gradient: number;
  where: Record<string, number>;
  bgBoxes: Box[];
  textBoxes: Box[];
  states: Partial<Record<"error" | "warning" | "success", number>>;
};

export type TextRun = {
  text: string;
  chars: number;
  tag: string;
  family: string;
  size: number;
  weight: number;
  lineHeight: number;
  tracking: number;
  transform: string;
  italic: boolean;
  variation: string;
  color: RgbKey;
  background: RgbKey | null;
  onImage: boolean;
  glyph: number;
  box: Box;
  context: { heading: number; button: boolean; link: boolean; nav: boolean; footer: boolean; label: boolean; mono: boolean; small: boolean };
  /** Key of the text style this run belongs to. */
  style: string;
};

export type TextStyleRep = { id: number; key: string; glyph: number; runs: number; rep: number; locations: Box[] };

/** `heading` is never detected by the capture: it names a title kept as a component before version 2. */
export type ComponentKind = "button" | "link-button" | "field" | "card" | "navigation" | "hero" | "footer" | "badge" | "form" | "heading";

export type ComponentTokens = {
  background: RgbKey | null;
  backgroundImage: "image" | "gradient" | null;
  color: RgbKey | null;
  borderWidth: number;
  borderStyle: string;
  borderColor: RgbKey | null;
  radius: [number, number, number, number];
  padding: [number, number, number, number];
  width: number;
  height: number;
  gap: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number | null;
  letterSpacing: number;
  textTransform: string;
  shadow: string | null;
  transition: { duration: string; easing: string; property: string } | null;
};

export type DomComponent = {
  id: number;
  kind: ComponentKind;
  tag: string;
  name: string;
  box: Box;
  fixed: boolean;
  tokens: ComponentTokens;
  state: string | null;
};

export type HoverStyle = {
  background: RgbKey | null;
  color: RgbKey | null;
  borderColor: RgbKey | null;
  boxShadow: string;
  transform: string;
  textDecoration: string;
  opacity: string;
};

export type DomPass = {
  meta: Record<string, string>;
  page: { width: number; height: number; viewportWidth: number; viewportHeight: number };
  colors: ColorUsage[];
  runs: TextRun[];
  textStyles: TextStyleRep[];
  components: DomComponent[];
  images: { kind: string; box: Box; alt: string }[];
  fixed: { position: string; box: Box; tag: string }[];
  spacing: Record<string, number>;
  widths: Record<string, number>;
  columns: Record<string, number>;
  shadows: Record<string, number>;
  customProperties: string[];
  darkScheme: boolean;
  links: { href: string; host: string; anchor: string; rel: string; inFooter: boolean; creditLike: boolean }[];
};

export type FontSource = "google" | "adobe" | "fontshare" | "self" | "other";

export type CaptureArtifacts = {
  version: 2;
  url: string;
  capturedAt: string;
  /** True when rebuilt from a version-1 capture: no text runs, no CDP fonts, no hover. */
  partial: boolean;
  page: { width: number; height: number; viewportWidth: number; viewportHeight: number };
  meta: Record<string, string>;
  dom: Omit<DomPass, "meta" | "page" | "links" | "customProperties" | "darkScheme">;
  darkScheme: boolean;
  customProperties: { name: string; value: string; color: RgbKey | null }[];
  /** Grid sampling of every revealed viewport: painted background per point. */
  samples: { bg: Record<RgbKey, number>; img: number; total: number };
  fonts: {
    /** CDP: the family that actually painted each text style's glyphs. */
    rendered: { style: number; families: { family: string; glyphs: number; custom: boolean }[] }[];
    network: { url: string; host: string; source: FontSource; bytes: number; family: string | null; weight: string | null; style: string | null; file: string | null }[];
  };
  hover: { id: number; before: HoverStyle; after: HoverStyle; file: string | null }[];
  media: {
    page: string;
    /** Component id → crop file (DPR 2 when cut from a settled viewport, 1 when cut from the stitched page). */
    crops: Record<string, { file: string; scale: number }>;
    /** Text-style id → crop of its representative element. */
    typeCrops: Record<string, { file: string; scale: number }>;
    specimens: { family: string; weight: number; italic: boolean; file: string }[];
  };
};

export const FONT_SOURCE_LABEL: Record<FontSource, string> = {
  google: "Google Fonts",
  adobe: "Adobe Fonts",
  fontshare: "Fontshare",
  self: "auto-hébergée",
  other: "autre hôte",
};

export function fontSource(fontHost: string, pageHost: string): FontSource {
  const host = fontHost.toLowerCase();
  if (host === "fonts.gstatic.com" || host === "fonts.googleapis.com") return "google";
  if (host === "use.typekit.net" || host === "p.typekit.net") return "adobe";
  if (host === "api.fontshare.com" || host === "cdn.fontshare.com") return "fontshare";
  const bare = (h: string) => h.replace(/^www\./, "").split(".").slice(-2).join(".");
  if (bare(host) === bare(pageHost.toLowerCase())) return "self";
  return "other";
}

/** Families whose files DRD may keep: the two OFL catalogues (open question 3). */
export function isOflSource(source: FontSource): boolean {
  return source === "google" || source === "fontshare";
}
