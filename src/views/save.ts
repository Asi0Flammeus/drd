/**
 * Saving a reference — the one gesture the whole app is built around.
 *
 * Four questions, always the same four, whether the thing was cut out of a
 * captured page or built in the playground: what kind of reference is this,
 * what is it, **why** do you want it, and where does it live. The `why` is
 * the field that makes a pack worth giving to an agent six weeks later, so it
 * is a real column and it is asked for at save time, not "later".
 */

import { post } from "../api";
import type { CaptureElement, CaptureSummary, Ref } from "../api";
import { chips, h } from "../ui/controls";
import { collectionTree, inbox, loadCollections, store } from "../store";
import { field, openSheet, select, textArea, textInput } from "../ui/shell";
import { tokensAsCss } from "../tokens";
import { resolvePalette } from "../state";
import type { DimensionId, Workspace } from "../state";
import type { ViewContext } from "./view";

export type RefType = Ref["type"];

const TYPE_OPTIONS: { value: RefType; label: string; sub: string }[] = [
  { value: "component", label: "Composant", sub: "bouton, carte, nav" },
  { value: "site", label: "Site", sub: "la page entière" },
  { value: "font", label: "Typo", sub: "une famille, une échelle" },
  { value: "palette", label: "Palette", sub: "des couleurs" },
  { value: "image", label: "Image", sub: "photo, illustration" },
];

/** Element kinds the extractor guesses, mapped to the type the sheet pre-selects. */
const GUESS_TO_TYPE: Record<string, RefType> = {
  image: "image",
  button: "component",
  nav: "component",
  card: "component",
  form: "component",
  grid: "component",
  hero: "site",
  footer: "component",
  type: "font",
  section: "component",
};

export type SaveResult = { ref: Ref };

type SheetFields = {
  type: RefType;
  title: string;
  what: string;
  why: string;
  tags: string;
  collectionId: string;
};

function buildForm(initial: SheetFields, preview: Node | null): { body: Node[]; read: () => SheetFields } {
  let type = initial.type;
  const title = textInput({ value: initial.title, placeholder: "Nom court et parlant" });
  const what = textArea({ placeholder: "Ce que c'est : « bouton plein, coins à 2 px, ombre portée dure »" });
  what.value = initial.what;
  const why = textArea({ placeholder: "Pourquoi vous le gardez : « la pression se voit sans animation, ça tient au doigt »" });
  why.value = initial.why;
  const tags = textInput({ value: initial.tags, placeholder: "brut, contrasté, éditorial" });

  const options = collectionTree().map(({ collection, depth }) => ({
    value: collection.id,
    label: `${"— ".repeat(depth)}${collection.name}`,
  }));
  const collection = select(options.length ? options : [{ value: "", label: "Boîte de réception" }], initial.collectionId);

  const body: Node[] = [];
  if (preview) body.push(h("div", { class: "sheet-preview" }, [preview]));
  body.push(
    chips<RefType>({
      label: "Type de référence",
      options: TYPE_OPTIONS,
      value: type,
      onSelect: (value) => {
        type = value;
      },
    }),
    field("Titre", title),
    field("Ce que c'est", what),
    field("Pourquoi vous le gardez", why, "C'est ce champ qui rend le pack utilisable dans six semaines."),
    field("Tags", tags, "Séparés par des virgules."),
    field("Collection", collection),
  );

  return {
    body,
    read: () => ({
      type,
      title: title.value.trim(),
      what: what.value.trim(),
      why: why.value.trim(),
      tags: tags.value,
      collectionId: collection.value,
    }),
  };
}

function tagList(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

/** Save a region cut out of a captured page. */
export function saveElementSheet(
  capture: CaptureSummary,
  element: CaptureElement,
  onSaved: (ref: Ref) => void,
  toast: (message: string) => void,
): void {
  const preview = element.crop
    ? h("img", { class: "sheet-crop", src: element.crop, alt: element.label, loading: "lazy" })
    : h("p", { class: "sheet-text", text: `${element.tag} · ${Math.round(element.box.width)}×${Math.round(element.box.height)} px` });

  const form = buildForm(
    {
      type: GUESS_TO_TYPE[element.guess] ?? "component",
      title: element.label || `${element.tag} — ${capture.host}`,
      what: "",
      why: "",
      tags: "",
      collectionId: inbox()?.id ?? "",
    },
    preview,
  );

  openSheet({
    title: "Enregistrer cette région",
    body: form.body,
    confirmLabel: "Enregistrer",
    async onConfirm() {
      const values = form.read();
      const result = await post<SaveResult>("/api/refs", {
        type: values.type,
        title: values.title || element.label,
        collectionId: values.collectionId || undefined,
        captureId: capture.id,
        elementId: element.id,
        what: values.what,
        why: values.why,
        tags: tagList(values.tags),
      });
      await loadCollections();
      onSaved(result.ref);
      toast(`Référence enregistrée — ${result.ref.title}`);
    },
  });
}

/** Save the whole captured page, its palette, or its type inventory. */
export function saveCaptureSheet(
  capture: CaptureSummary,
  type: RefType,
  payload: Record<string, unknown>,
  onSaved: (ref: Ref) => void,
  toast: (message: string) => void,
): void {
  const defaults: Record<string, string> = {
    site: capture.title ?? capture.host,
    palette: `Palette — ${capture.host}`,
    font: `Typographies — ${capture.host}`,
  };
  const preview = capture.screenshot
    ? h("img", { class: "sheet-crop", src: capture.screenshot, alt: capture.title ?? capture.host, loading: "lazy" })
    : null;

  const form = buildForm(
    { type, title: defaults[type] ?? capture.host, what: "", why: "", tags: "", collectionId: inbox()?.id ?? "" },
    preview,
  );

  openSheet({
    title: "Enregistrer depuis cette capture",
    body: form.body,
    confirmLabel: "Enregistrer",
    async onConfirm() {
      const values = form.read();
      const result = await post<SaveResult>("/api/refs", {
        type: values.type,
        title: values.title || capture.host,
        collectionId: values.collectionId || undefined,
        captureId: capture.id,
        what: values.what,
        why: values.why,
        tags: tagList(values.tags),
        payload,
      });
      await loadCollections();
      onSaved(result.ref);
      toast(`Référence enregistrée — ${result.ref.title}`);
    },
  });
}

const DIMENSION_TYPE: Record<DimensionId, RefType> = { type: "font", color: "palette", components: "component" };

/**
 * The playground's save path, kept API-compatible with the bench this app
 * grew out of: the three parameter panels call `saveEntry(ctx, kind, label,
 * spec)` and land in the same collection model as anything captured, with the
 * resolved token tree stored so an export never has to recompute it.
 */
export function saveEntry(ctx: ViewContext, kind: DimensionId, label: string, spec: unknown): void {
  const workspace: Workspace = { ...ctx.ws };
  const payload: Record<string, unknown> = {
    source: "playground",
    dimension: kind,
    spec,
    css: tokensAsCss(workspace),
  };
  if (kind === "color") {
    const resolved = resolvePalette(ctx.ws.color);
    payload.ramp = resolved.ramp;
    payload.accent = resolved.accent;
  }
  if (kind === "type") {
    payload.display = { family: ctx.ws.type.displayFamily, size: ctx.ws.type.displaySize, weight: ctx.ws.type.displayWeight };
    payload.body = { family: ctx.ws.type.bodyFamily, size: ctx.ws.type.bodySize, weight: ctx.ws.type.bodyWeight };
  }

  const form = buildForm(
    {
      type: DIMENSION_TYPE[kind],
      title: label,
      what: "",
      why: "",
      tags: "playground",
      collectionId: inbox()?.id ?? "",
    },
    null,
  );

  openSheet({
    title: "Enregistrer depuis le playground",
    body: form.body,
    confirmLabel: "Enregistrer",
    async onConfirm() {
      const values = form.read();
      const result = await post<SaveResult>("/api/refs", {
        type: values.type,
        title: values.title || label,
        collectionId: values.collectionId || undefined,
        what: values.what,
        why: values.why,
        tags: tagList(values.tags),
        payload,
      });
      await loadCollections();
      ctx.toast(`Référence enregistrée — ${result.ref.title}`);
    },
  });
}

/** Collections must be loaded before any sheet opens, or the picker is empty. */
export async function ensureCollections(): Promise<void> {
  if (store.collections.length === 0) await loadCollections();
}
