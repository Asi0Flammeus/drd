/**
 * Export packs — what leaves the app.
 *
 * The preview shows the exact Markdown and CSS that the ZIP contains, because
 * the pack is a document you are about to hand to an agent and you should
 * read it first. Building one is deterministic and offline: no model is
 * involved, so nothing here can be unavailable when you need it.
 */

import { del, get, post } from "../api";
import type { Pack, Ref } from "../api";
import { chips, h, ICONS, textButton } from "../ui/controls";
import { loadCollections, store } from "../store";
import { confirmSheet, emptyState, field, openSheet, sectionHead, textArea, textInput } from "../ui/shell";

export type PacksHost = { toast(message: string): void; go(route: string): void };

export function buildPacksPanel(host: PacksHost): HTMLElement {
  const root = h("section", { class: "panel" });
  const list = h("div", { class: "pack-list" });

  const create = textButton("Nouveau pack", ICONS.save, () => void openBuilder(host, load));
  root.append(sectionHead("Packs d'export", "Un brief portable, plusieurs inspirations, aucune copie.", [create]), list);

  const load = async () => {
    list.replaceChildren(h("p", { class: "loading", text: "Chargement…" }));
    try {
      const { data, stale } = await get<{ packs: Pack[] }>("/api/packs");
      list.replaceChildren();
      if (stale) list.append(h("p", { class: "meta-item is-stale", text: "Hors ligne — derniers packs connus." }));
      if (data.packs.length === 0) {
        list.append(emptyState("Aucun pack", "Sélectionnez des références, puis fabriquez un pack à donner à un agent."));
        return;
      }
      for (const pack of data.packs) list.append(packCard(pack, host, load));
    } catch (failure) {
      list.replaceChildren(emptyState("Packs indisponibles", failure instanceof Error ? failure.message : "Erreur."));
    }
  };

  void load();
  return root;
}

function packCard(pack: Pack, host: PacksHost, refresh: () => void): HTMLElement {
  const open = textButton("Voir", ICONS.copy, () => host.go(`#/packs/${pack.id}`));
  const download = h("a", { class: "action", href: `/api/packs/${pack.id}/download`, download: "" }, [
    h("span", { text: "Télécharger le ZIP" }),
  ]);
  const remove = textButton("Supprimer", ICONS.trash, () => {
    confirmSheet("Supprimer ce pack ?", `« ${pack.name} » sera supprimé. Les références restent.`, "Supprimer", async () => {
      await del(`/api/packs/${pack.id}`);
      host.toast("Pack supprimé");
      refresh();
    });
  });
  remove.classList.add("is-danger");

  return h("article", { class: "pack-card" }, [
    h("h3", { class: "card-title", text: pack.name }),
    h("p", { class: "card-host", text: `${pack.refCount} référence(s) · ${pack.sources.length} source(s)` }),
    h("p", { class: "pack-sources", text: pack.sources.join(" · ") }),
    h("div", { class: "card-foot" }, [open, download, remove]),
  ]);
}

async function openBuilder(host: PacksHost, refresh: () => void): Promise<void> {
  if (store.collections.length === 0) await loadCollections();
  const { data } = await get<{ refs: Ref[] }>("/api/refs");
  if (data.refs.length === 0) {
    host.toast("Enregistrez d'abord des références");
    return;
  }

  const selected = new Set<string>();
  const name = textInput({ placeholder: "Refonte — cabinet d'architecture" });
  const brief = textArea({ placeholder: "Pour qui, quel objectif, quelle contrainte." });
  const counter = h("p", { class: "sheet-text" });
  const listBox = h("div", { class: "pick-list" });

  const paint = () => {
    const hosts = new Set(
      data.refs.filter((ref) => selected.has(ref.id)).map((ref) => ref.sourceHost ?? "playground"),
    );
    counter.textContent = `${selected.size} référence(s), ${hosts.size} source(s). Trois sources minimum pour éviter la copie.`;
  };

  for (const ref of data.refs) {
    const check = h("input", { type: "checkbox", class: "pick-check", id: `pick-${ref.id}` });
    check.addEventListener("change", () => {
      if (check.checked) selected.add(ref.id);
      else selected.delete(ref.id);
      paint();
    });
    listBox.append(
      h("label", { class: "pick-row", for: `pick-${ref.id}` }, [
        check,
        ref.image ? h("img", { class: "pick-thumb", src: ref.image, alt: "", loading: "lazy" }) : h("span", { class: "pick-thumb is-empty" }),
        h("span", { class: "pick-info" }, [
          h("strong", { text: ref.title }),
          h("span", { class: "pick-source", text: ref.sourceHost ?? "playground" }),
        ]),
      ]),
    );
  }
  paint();

  openSheet({
    title: "Nouveau pack",
    body: [field("Nom", name), field("Intention", brief), counter, listBox],
    confirmLabel: "Créer le pack",
    async onConfirm() {
      if (selected.size === 0) {
        host.toast("Sélectionnez au moins une référence");
        return;
      }
      try {
        const result = await post<{ pack: Pack; warnings: string[] }>("/api/packs", {
          name: name.value.trim() || "Pack",
          brief: brief.value,
          refIds: [...selected],
        });
        host.toast(result.warnings.length ? result.warnings[0] : "Pack créé");
        refresh();
        host.go(`#/packs/${result.pack.id}`);
      } catch (failure) {
        host.toast(failure instanceof Error ? failure.message : "Création impossible");
      }
    },
  });
}

type PackDetail = {
  pack: Pack;
  warnings: string[];
  files: { name: string; bytes: number }[];
  preview: { readme: string; prompt: string; tokens: string };
};

export function buildPackPanel(packId: string, host: PacksHost): HTMLElement {
  const root = h("section", { class: "panel" }, [h("p", { class: "loading", text: "Chargement du pack…" })]);

  void (async () => {
    try {
      const { data } = await get<PackDetail>(`/api/packs/${packId}`);
      root.replaceChildren();
      const download = h("a", { class: "action is-primary", href: `/api/packs/${packId}/download`, download: "" }, [
        h("span", { text: "Télécharger le ZIP" }),
      ]);
      const back = textButton("Tous les packs", ICONS.chevron, () => host.go("#/packs"));
      root.append(sectionHead(data.pack.name, `${data.pack.refCount} référence(s) · ${data.pack.sources.join(", ")}`, [download, back]));

      for (const warning of data.warnings) {
        root.append(h("p", { class: "warning", role: "status", text: warning }));
      }

      const files = h("ul", { class: "file-list" });
      for (const file of data.files) {
        files.append(h("li", {}, [h("code", { text: file.name }), h("span", { class: "meta-item", text: `${Math.ceil(file.bytes / 1024)} ko` })]));
      }
      root.append(h("section", {}, [h("h3", { class: "inv-title", text: "Contenu de l'archive" }), files]));

      let tab: "prompt" | "readme" | "tokens" = "prompt";
      const output = h("pre", { class: "pack-preview" });
      const paint = () => {
        output.textContent =
          tab === "prompt" ? data.preview.prompt : tab === "readme" ? data.preview.readme : data.preview.tokens;
      };
      const copy = textButton("Copier", ICONS.copy, () => {
        void navigator.clipboard?.writeText(output.textContent ?? "");
        host.toast("Copié");
      });
      root.append(
        h("div", { class: "pack-tabs" }, [
          chips({
            label: "Fichier",
            options: [
              { value: "prompt", label: "prompt.md" },
              { value: "readme", label: "README.md" },
              { value: "tokens", label: "tokens.css" },
            ],
            value: tab,
            onSelect: (value) => {
              tab = value === "readme" ? "readme" : value === "tokens" ? "tokens" : "prompt";
              paint();
            },
          }),
          copy,
        ]),
        output,
      );
      paint();
    } catch (failure) {
      root.replaceChildren(emptyState("Pack indisponible", failure instanceof Error ? failure.message : "Erreur."));
    }
  })();

  return root;
}
