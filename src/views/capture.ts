/**
 * The capture: a real screenshot with the page's real geometry drawn on top.
 *
 * The regions are not guesses about where things are — they are
 * `getBoundingClientRect()` from the browser that rendered the page, scaled
 * into whatever width the screenshot is displayed at. That is the reason the
 * server-side capture exists at all, so the overlay is the payoff.
 *
 * Two ways in, because a 1280 px page shown on a 380 px phone makes an overlay
 * tap a lottery: the image view for choosing by eye, and the list view — every
 * region as a row with its crop, big enough for a thumb. Both save through the
 * same sheet.
 */

import { del, get, post } from "../api";
import type { CaptureElement, CaptureLink, CaptureSummary } from "../api";
import { chips, h, icon, ICONS, textButton } from "../ui/controls";
import { confirmSheet, emptyState, sectionHead, statusPill } from "../ui/shell";
import { ensureCollections, saveCaptureSheet, saveElementSheet } from "./save";

type Payload = { capture: CaptureSummary; elements: CaptureElement[]; links: CaptureLink[] };

const GUESS_LABEL: Record<string, string> = {
  button: "Bouton",
  image: "Image",
  card: "Carte",
  nav: "Navigation",
  hero: "Hero",
  footer: "Pied de page",
  form: "Formulaire",
  grid: "Grille",
  type: "Titre",
  section: "Bloc",
};

export type CapturePanelHost = {
  toast(message: string): void;
  go(route: string): void;
  rerender(): void;
};

export function buildCapturePanel(captureId: string, host: CapturePanelHost): HTMLElement {
  const root = h("section", { class: "panel panel-capture" }, [h("p", { class: "loading", text: "Chargement de la capture…" })]);
  let poll = 0;

  const stop = () => window.clearTimeout(poll);
  // The panel is replaced on every navigation; stop polling when it leaves.
  const observer = new MutationObserver(() => {
    if (!root.isConnected) {
      stop();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const load = async () => {
    try {
      const { data, stale } = await get<Payload>(`/api/captures/${captureId}`);
      render(data, stale);
      if (data.capture.status === "pending" || data.capture.status === "running") {
        poll = window.setTimeout(load, 1500);
      }
    } catch (error) {
      root.replaceChildren(
        emptyState("Capture indisponible", error instanceof Error ? error.message : "Erreur inconnue."),
      );
    }
  };

  const render = (data: Payload, stale: boolean) => {
    const { capture, elements, links } = data;
    root.replaceChildren();

    const openOriginal = h("a", {
      class: "action",
      href: capture.finalUrl ?? capture.requestedUrl,
      target: "_blank",
      rel: "noreferrer noopener",
    }, [h("span", { text: "Ouvrir le site" })]);

    const remove = textButton("Supprimer", ICONS.trash, () => {
      confirmSheet(
        "Supprimer cette capture ?",
        "Les références déjà enregistrées gardent leur texte, mais perdent leur visuel.",
        "Supprimer",
        async () => {
          await del(`/api/captures/${capture.id}`);
          host.toast("Capture supprimée");
          host.go("#/inbox");
        },
      );
    });
    remove.classList.add("is-danger");

    root.append(
      sectionHead(capture.title ?? capture.host, capture.finalUrl ?? capture.requestedUrl, [openOriginal, remove]),
    );

    const meta = h("div", { class: "capture-meta" }, [
      statusPill(capture.status),
      h("span", { class: "meta-item", text: `${capture.host}` }),
      h("span", { class: "meta-item", text: `${elements.length} régions` }),
      h("span", { class: "meta-item", text: new Date(capture.createdAt).toLocaleString("fr-FR") }),
    ]);
    if (stale) meta.append(h("span", { class: "meta-item is-stale", text: "hors ligne · cache" }));
    root.append(meta);

    if (capture.status === "failed") {
      root.append(emptyState("La capture a échoué", capture.error ?? "Raison inconnue."));
      return;
    }
    if (capture.status !== "ready") {
      root.append(
        emptyState(
          "Capture en cours",
          "Un navigateur charge la page, attend le rendu, puis mesure chaque bloc. Quelques secondes.",
        ),
      );
      return;
    }

    root.append(inventory(capture, host));

    let mode: "image" | "list" = window.matchMedia("(max-width: 720px)").matches ? "list" : "image";
    let filter = "all";
    const stage = h("div", { class: "capture-stage" });

    const draw = () => {
      const shown = filter === "all" ? elements : elements.filter((element) => element.guess === filter);
      stage.replaceChildren(mode === "image" ? imageView(capture, shown, host) : listView(capture, shown, host));
    };

    const kinds = [...new Set(elements.map((element) => element.guess))];
    root.append(
      h("div", { class: "capture-controls" }, [
        chips({
          label: "Vue",
          options: [
            { value: "image", label: "Image" },
            { value: "list", label: "Liste" },
          ],
          value: mode,
          onSelect: (value) => {
            mode = value === "list" ? "list" : "image";
            draw();
          },
        }),
        chips({
          label: "Filtrer",
          options: [
            { value: "all", label: "Tout" },
            ...kinds.map((kind) => ({ value: kind, label: GUESS_LABEL[kind] ?? kind })),
          ],
          value: filter,
          onSelect: (value) => {
            filter = value;
            draw();
          },
        }),
      ]),
      stage,
    );
    draw();

    if (links.length) root.append(linkPanel(links));
  };

  void ensureCollections().then(load);
  return root;
}

/** Page-level references: the site itself, its palette, its type inventory. */
function inventory(capture: CaptureSummary, host: CapturePanelHost): HTMLElement {
  const colors = capture.meta.colors ?? [];
  const fonts = capture.meta.fonts ?? [];

  const swatches = h("div", { class: "swatch-row" });
  for (const color of colors.slice(0, 14)) {
    swatches.append(h("span", { class: "swatch-cell", style: `background:${color.hex}`, title: `${color.hex} · ${color.role}` }));
  }

  const fontList = h("ul", { class: "inv-fonts" });
  for (const font of fonts.slice(0, 5)) {
    fontList.append(
      h("li", {}, [
        h("strong", { text: font.family }),
        h("span", { class: "inv-dim", text: ` ${font.sizes.slice(0, 5).join(", ")} px · ${font.weights.join("/")}` }),
      ]),
    );
  }

  const saveSite = textButton("Enregistrer le site", ICONS.save, () => {
    saveCaptureSheet(capture, "site", { colors, fonts, meta: capture.meta.meta ?? {} }, () => host.rerender(), host.toast);
  });
  const savePalette = textButton("Enregistrer la palette", ICONS.save, () => {
    saveCaptureSheet(capture, "palette", { colors }, () => host.rerender(), host.toast);
  });
  const saveFonts = textButton("Enregistrer les typos", ICONS.save, () => {
    saveCaptureSheet(capture, "font", { fonts }, () => host.rerender(), host.toast);
  });

  return h("section", { class: "inventory" }, [
    h("div", { class: "inv-block" }, [
      h("h3", { class: "inv-title", text: "Couleurs observées" }),
      swatches,
      savePalette,
    ]),
    h("div", { class: "inv-block" }, [h("h3", { class: "inv-title", text: "Typographies" }), fontList, saveFonts]),
    h("div", { class: "inv-block" }, [
      h("h3", { class: "inv-title", text: "La page entière" }),
      h("p", { class: "inv-note", text: capture.description || "Aucune meta description." }),
      saveSite,
    ]),
  ]);
}

function imageView(capture: CaptureSummary, elements: CaptureElement[], host: CapturePanelHost): HTMLElement {
  const frame = h("div", { class: "shot-frame" });
  const image = h("img", {
    class: "shot",
    src: capture.screenshot ?? "",
    alt: `Capture de ${capture.host}`,
    loading: "eager",
  });
  const overlay = h("div", { class: "shot-overlay" });
  frame.append(image, overlay);

  const place = () => {
    const pageWidth = capture.width ?? capture.meta.page?.width ?? 1280;
    const scale = image.clientWidth / pageWidth;
    if (!Number.isFinite(scale) || scale <= 0) return;
    overlay.replaceChildren();
    for (const element of elements) {
      const box = h("button", {
        type: "button",
        class: `region region--${element.guess}`,
        style: `left:${element.box.x * scale}px; top:${element.box.y * scale}px; width:${element.box.width * scale}px; height:${element.box.height * scale}px`,
        "aria-label": `${GUESS_LABEL[element.guess] ?? element.guess} — ${element.label}`,
        title: element.label,
      }, [h("span", { class: "region-tag", text: GUESS_LABEL[element.guess] ?? element.guess })]);
      box.addEventListener("click", () => saveElementSheet(capture, element, () => host.rerender(), host.toast));
      overlay.append(box);
    }
  };

  image.addEventListener("load", place);
  window.addEventListener("resize", place, { passive: true });
  if (image.complete) place();
  return frame;
}

function listView(capture: CaptureSummary, elements: CaptureElement[], host: CapturePanelHost): HTMLElement {
  if (elements.length === 0) return emptyState("Aucune région", "Aucun bloc ne correspond à ce filtre.");
  const list = h("ul", { class: "region-list" });
  for (const element of elements) {
    const thumb = element.crop
      ? h("img", { class: "region-thumb", src: element.crop, alt: "", loading: "lazy" })
      : h("span", { class: "region-thumb is-empty" }, [icon(ICONS.dash, 20)]);
    const row = h("li", { class: "region-row" }, [
      thumb,
      h("div", { class: "region-info" }, [
        h("span", { class: "region-kind", text: GUESS_LABEL[element.guess] ?? element.guess }),
        h("span", { class: "region-label", text: element.label }),
        h("span", {
          class: "region-dim",
          text: `${Math.round(element.box.width)}×${Math.round(element.box.height)} px · ${element.styles.fontFamily?.split(",")[0] ?? element.tag}`,
        }),
      ]),
      textButton("Garder", ICONS.save, () => saveElementSheet(capture, element, () => host.rerender(), host.toast)),
    ]);
    list.append(row);
  }
  return list;
}

function linkPanel(links: CaptureLink[]): HTMLElement {
  const credits = links.filter((link) => link.creditLike === 1);
  const list = h("ul", { class: "link-list" });
  for (const link of [...credits, ...links.filter((link) => link.creditLike !== 1)].slice(0, 18)) {
    list.append(
      h("li", {}, [
        h("a", { href: link.href, target: "_blank", rel: "noreferrer noopener", text: link.anchor || link.host }),
        h("span", { class: "link-host", text: link.host }),
        link.creditLike === 1 ? h("span", { class: "pill pill--credit", text: "crédit" }) : h("span"),
      ]),
    );
  }
  return h("section", { class: "links" }, [
    h("h3", { class: "inv-title", text: "Liens sortants" }),
    h("p", { class: "inv-note", text: "Les liens de crédit en pied de page alimentent la découverte." }),
    list,
  ]);
}

/** Start a capture from anywhere: the inbox field, a discovery card, a pasted URL. */
export async function startCapture(url: string): Promise<string> {
  const result = await post<{ id: string }>("/api/captures", { url });
  return result.id;
}
