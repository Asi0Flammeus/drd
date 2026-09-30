/**
 * The shape of what the analysis says about a page (§4.9). Every kind's
 * `data` is typed here, field for field with §4.2 to §4.7, because the
 * client, the library and the exports all read it.
 */

import type { Box, ComponentKind, RgbKey } from "../capture/artifacts.ts";
import type { Grade, Oklch } from "./color.ts";

export type Origin = "dom" | "pixels" | "declared" | "network" | "cdp";
export type Confidence = "sure" | "probable" | "check";
export type Evidence = { origin: Origin; note: string };

export type FindingKind = "palette" | "color" | "type" | "component" | "scale" | "mood" | "page";

export type Finding<D = unknown> = {
  kind: FindingKind;
  subkind: string | null;
  title: string;
  confidence: Confidence;
  evidence: Evidence[];
  data: D;
  /** Files in the capture's media folder: crops, hover crop, specimens, font files. */
  media: string[];
  locations: Box[];
  signature: string;
};

/** English because it lands in code (`--color-accent`); `role` is the French label the UI shows. */
export type RoleKey = "background" | "surface" | "text" | "text-muted" | "accent" | "accent-2" | "border" | "error" | "warning" | "success" | "image";

export type PaletteColor = {
  role: string;
  key: RoleKey | null;
  value: Oklch;
  hex: string;
  /** Share of page area, 0-1. */
  share: number;
  /** Share of the page's text (characters × size), 0-1. */
  textShare: number;
  usedOn: string[];
  declaredAs?: string;
  origins: Origin[];
  confidence: Confidence;
  evidence: Evidence[];
  locations: Box[];
};

export type ContrastPair = {
  fg: string;
  bg: string;
  label: string;
  wcag: number;
  grade: Grade;
  where: string;
  /** Share of the page's text area set in this pair. */
  share: number;
};

export type PaletteData = {
  colors: PaletteColor[];
  pairs: ContrastPair[];
  others: { value: Oklch; hex: string; share: number; origins: Origin[] }[];
  theme: "light" | "dark";
};

export type ColorData = { color: PaletteColor; palette: string };

export type TypeRole = "display" | "h1" | "h2" | "h3" | "corps" | "petit" | "label" | "bouton" | "nav" | "mono";

export type TextStyle = {
  family: string;
  declared: string;
  size: number;
  lineHeight: number;
  lineRatio: number;
  /** In em. */
  tracking: number;
  weight: number;
  transform: string;
  italic: boolean;
  role: TypeRole;
  share: number;
  sample: string;
  crop: string | null;
  locations: Box[];
  runs: number;
  origin: Origin;
};

export type FontSourceInfo = { label: string; host: string | null; licence: "OFL probable" | "à vérifier" };

export type TypeFamilyData = {
  family: string;
  declared: string[];
  generic: "serif" | "sans-serif" | "monospace" | "cursive";
  display: boolean;
  weights: number[];
  italic: boolean;
  variation: string[];
  source: FontSourceInfo;
  mismatch: { declared: string; rendered: string } | null;
  specimens: { weight: number; italic: boolean; file: string }[];
  /** The family set as the page sets it, one crop of real text per role (C2): its largest title, its section titles, its running text. */
  roleSpecimens: RoleSpecimen[];
  /** OFL families only (open question 3): the files the page downloaded. */
  fontFiles: { file: string; weight: string; style: string }[];
  share: number;
  roles: TypeRole[];
  bodySize: number | null;
};

export type RoleSpecimen = { role: "display" | "titre" | "corps"; size: number; weight: number; lineHeight: number; sample: string; crop: string };

export type TypePairData = {
  display: { family: string; generic: string; size: number; weight: number; crop: string | null };
  text: { family: string; generic: string; size: number; weight: number; crop: string | null };
};

export type ScaleStep = { size: number; n: number | null; lineHeight: number; role: TypeRole };

export type TypeScaleData = {
  body: number;
  ratio: number | null;
  ratioName: string | null;
  /** Mean relative error of the fit, 0-1. */
  error: number | null;
  verdict: "sûr" | "probable" | "échelle libre";
  steps: ScaleStep[];
  styles: TextStyle[];
  families: string[];
};

export type ColorRef = { hex: string; role: string | null };

export type ComponentTokenView = {
  background: ColorRef | null;
  foreground: ColorRef | null;
  border: { width: number; style: string; color: ColorRef | null } | null;
  radius: [number, number, number, number];
  padding: [number, number, number, number];
  height: number;
  width: number;
  gap: number;
  font: { family: string; size: number; weight: number; lineHeight: number | null; letterSpacing: number; transform: string };
  shadow: string | null;
  transition: { duration: string; easing: string; property: string } | null;
};

export type ComponentData = {
  kind: ComponentKind;
  kindLabel: string;
  label: string;
  count: number;
  tokens: ComponentTokenView;
  hover: { changes: { property: string; from: string; to: string }[]; crop: string | null } | null;
  css: string;
  dhash: string | null;
  crop: string;
};

export type SpacingData = {
  base: number;
  steps: number[];
  explained: number;
  contentWidth: number | null;
  columns: number | null;
  values: { value: number; count: number }[];
};

export type RadiusData = {
  system: "droit" | "doux" | "pilule" | "mixte";
  rule: string;
  byKind: { kind: string; kindLabel: string; values: number[] }[];
};

export type ElevationData = { shadows: { value: string; blur: number; count: number }[] };

export type MoodImage = {
  box: Box;
  palette: string[];
  meanL: number;
  meanC: number;
  meanB: number;
  stdL: number;
  distinct: number;
  nature: "aplat" | "photo";
  crop: string | null;
};

export type MoodData = {
  images: MoodImage[];
  palette: { hex: string; value: Oklch; share: number }[];
  descriptors: { name: string; word: string; value: number; unit: string }[];
  density: { share: number; word: string };
  nature: "aplat" | "photo" | null;
};

export type PageData = {
  url: string;
  title: string;
  description: string;
  lang: string;
  siteName: string;
  themeColor: string;
  favicon: string;
  generator: string;
  width: number;
  height: number;
  darkScheme: boolean;
  capturedAt: string;
  partial: boolean;
};

export const COMPONENT_LABEL: Record<ComponentKind, string> = {
  button: "Bouton",
  "link-button": "Lien-bouton",
  field: "Champ",
  card: "Carte",
  navigation: "Navigation",
  hero: "Hero",
  footer: "Pied de page",
  badge: "Badge",
  form: "Formulaire",
  heading: "Titre",
};

export type { RgbKey };
