/**
 * Collections and the references inside them.
 *
 * Nested, because taste is nested: "restaurants / cartes de menu" is a real
 * distinction and a flat tag list loses it. The tree is rendered as indented
 * rows rather than a drag-and-drop canvas — moving a reference is a select,
 * not a gesture, so it works with one thumb and with a screen reader.
 */

import { del, get, patch, post } from "../api";
import type { Ref } from "../api";
import { h, ICONS, textButton } from "../ui/controls";
import { collectionPath, collectionTree, loadCollections, store } from "../store";
import { confirmSheet, emptyState, field, openSheet, sectionHead, select, textArea, textInput } from "../ui/shell";

export type CollectionsHost = { toast(message: string): void; go(route: string): void };

const TYPE_LABEL: Record<Ref["type"], string> = {
  site: "Site",
  component: "Composant",
  font: "Typo",
  palette: "Palette",
  image: "Image",
};

export function buildCollectionsPanel(selectedId: string | null, host: CollectionsHost): HTMLElement {
  const root = h("section", { class: "panel" });
  const tree = h("nav", { class: "tree", "aria-label": "Collections" });
  const body = h("div", { class: "collection-body" });

  const newCollection = textButton("Nouvelle collection", ICONS.save, () => {
    const name = textInput({ placeholder: "Restaurants — cartes" });
    const parent = select(
      [{ value: "", label: "À la racine" }, ...collectionTree().map(({ collection, depth }) => ({
        value: collection.id,
        label: `${"— ".repeat(depth)}${collection.name}`,
      }))],
      selectedId ?? "",
    );
    openSheet({
      title: "Nouvelle collection",
      body: [field("Nom", name), field("Dans", parent)],
      confirmLabel: "Créer",
      async onConfirm() {
        if (!name.value.trim()) return;
        await post("/api/collections", { name: name.value.trim(), parentId: parent.value || null });
        await loadCollections();
        host.toast("Collection créée");
        render();
      },
    });
  });

  const makePack = textButton("Créer un pack", ICONS.download, () => {
    if (!selectedId) {
      host.toast("Choisissez une collection d'abord");
      return;
    }
    const name = textInput({ value: collectionPath(selectedId) });
    const brief = textArea({ placeholder: "Le projet, la contrainte, l'audience." });
    openSheet({
      title: "Créer un pack depuis cette collection",
      body: [field("Nom du pack", name), field("Intention", brief)],
      confirmLabel: "Créer le pack",
      async onConfirm() {
        try {
          const result = await post<{ pack: { id: string } }>("/api/packs", {
            name: name.value.trim() || "Pack",
            brief: brief.value,
            collectionId: selectedId,
          });
          host.toast("Pack créé");
          host.go(`#/packs/${result.pack.id}`);
        } catch (failure) {
          host.toast(failure instanceof Error ? failure.message : "Création impossible");
        }
      },
    });
  });

  root.append(
    sectionHead("Collections", "Ce que vous gardez, et pourquoi vous le gardez.", [newCollection, makePack]),
    h("div", { class: "collection-layout" }, [tree, body]),
  );

  const renderTree = () => {
    tree.replaceChildren();
    for (const { collection, depth } of collectionTree()) {
      const current = collection.id === selectedId;
      const item = h("button", {
        type: "button",
        class: `tree-item${current ? " is-current" : ""}`,
        style: `padding-left:${12 + depth * 16}px`,
        "aria-current": current ? "true" : "false",
      }, [
        h("span", { class: "tree-name", text: collection.name }),
        h("span", { class: "tree-count", text: String(collection.count) }),
      ]);
      item.addEventListener("click", () => host.go(`#/collections/${collection.id}`));
      tree.append(item);
    }
  };

  const renderBody = async () => {
    if (!selectedId) {
      body.replaceChildren(
        emptyState("Choisissez une collection", "Les références enregistrées depuis une capture ou le playground arrivent dans la boîte de réception."),
      );
      return;
    }
    body.replaceChildren(h("p", { class: "loading", text: "Chargement…" }));
    try {
      const { data, stale } = await get<{ refs: Ref[] }>(`/api/refs?collectionId=${encodeURIComponent(selectedId)}`);
      const collection = store.collections.find((entry) => entry.id === selectedId);
      body.replaceChildren();
      const head = h("div", { class: "collection-head" }, [
        h("h3", { class: "collection-title", text: collectionPath(selectedId) }),
        h("span", { class: "meta-item", text: `${data.refs.length} référence(s)` }),
      ]);
      if (stale) head.append(h("span", { class: "meta-item is-stale", text: "hors ligne · cache" }));
      if (collection && collection.kind !== "inbox") {
        const rename = textButton("Renommer", ICONS.copy, () => {
          const name = textInput({ value: collection.name });
          openSheet({
            title: "Renommer la collection",
            body: [field("Nom", name)],
            confirmLabel: "Renommer",
            async onConfirm() {
              await patch(`/api/collections/${collection.id}`, { name: name.value.trim() });
              await loadCollections();
              host.toast("Collection renommée");
              render();
            },
          });
        });
        const remove = textButton("Supprimer", ICONS.trash, () => {
          confirmSheet(
            "Supprimer cette collection ?",
            "Les références qu'elle contient repartent dans la boîte de réception ; rien n'est perdu.",
            "Supprimer",
            async () => {
              await del(`/api/collections/${collection.id}`);
              await loadCollections();
              host.toast("Collection supprimée");
              host.go("#/collections");
            },
          );
        });
        remove.classList.add("is-danger");
        head.append(rename, remove);
      }
      body.append(head);

      if (data.refs.length === 0) {
        body.append(emptyState("Collection vide", "Capturez un site, puis gardez une région."));
        return;
      }
      const grid = h("div", { class: "ref-grid" });
      for (const ref of data.refs) grid.append(refCard(ref, host, render));
      body.append(grid);
    } catch (failure) {
      body.replaceChildren(emptyState("Références indisponibles", failure instanceof Error ? failure.message : "Erreur."));
    }
  };

  const render = () => {
    renderTree();
    void renderBody();
  };

  void (async () => {
    if (store.collections.length === 0) await loadCollections();
    render();
  })();

  return root;
}

function refCard(ref: Ref, host: CollectionsHost, refresh: () => void): HTMLElement {
  const visual = ref.image
    ? h("img", { class: "ref-thumb", src: ref.image, alt: "", loading: "lazy" })
    : paletteThumb(ref);

  const edit = textButton("Modifier", ICONS.copy, () => openEdit(ref, host, refresh));
  const remove = textButton("Supprimer", ICONS.trash, () => {
    confirmSheet("Supprimer cette référence ?", `« ${ref.title} » sera définitivement supprimée.`, "Supprimer", async () => {
      await del(`/api/refs/${ref.id}`);
      host.toast("Référence supprimée");
      refresh();
    });
  });
  remove.classList.add("is-danger");

  const source = ref.sourceUrl
    ? h("a", { class: "ref-source", href: ref.sourceUrl, target: "_blank", rel: "noreferrer noopener", text: ref.sourceHost ?? ref.sourceUrl })
    : h("span", { class: "ref-source", text: "playground" });

  return h("article", { class: "ref-card" }, [
    visual,
    h("div", { class: "ref-body" }, [
      h("div", { class: "ref-head" }, [
        h("span", { class: "pill", text: TYPE_LABEL[ref.type] ?? ref.type }),
        source,
      ]),
      h("h4", { class: "ref-title", text: ref.title }),
      ref.what ? h("p", { class: "ref-what", text: ref.what }) : h("span"),
      ref.why ? h("p", { class: "ref-why" }, [h("strong", { text: "Pourquoi : " }), h("span", { text: ref.why })]) : h("span"),
      ref.tags.length ? h("p", { class: "ref-tags", text: ref.tags.join(" · ") }) : h("span"),
      h("div", { class: "ref-actions" }, [edit, remove]),
    ]),
  ]);
}

function paletteThumb(ref: Ref): HTMLElement {
  const row = h("div", { class: "ref-thumb ref-thumb--palette" });
  const ramp = ref.payload.ramp;
  const colors = ref.payload.colors;
  if (Array.isArray(ramp)) {
    for (const hex of ramp) if (typeof hex === "string") row.append(h("span", { style: `background:${hex}` }));
  } else if (Array.isArray(colors)) {
    for (const entry of colors.slice(0, 12)) {
      if (entry && typeof entry === "object" && "hex" in entry && typeof entry.hex === "string") {
        row.append(h("span", { style: `background:${entry.hex}` }));
      }
    }
  }
  if (!row.children.length) row.classList.add("is-empty");
  return row;
}

function openEdit(ref: Ref, host: CollectionsHost, refresh: () => void): void {
  const title = textInput({ value: ref.title });
  const what = textArea({});
  what.value = ref.what;
  const why = textArea({});
  why.value = ref.why;
  const tags = textInput({ value: ref.tags.join(", ") });
  const collection = select(
    collectionTree().map(({ collection: entry, depth }) => ({ value: entry.id, label: `${"— ".repeat(depth)}${entry.name}` })),
    ref.collectionId ?? "",
  );

  openSheet({
    title: "Modifier la référence",
    body: [field("Titre", title), field("Ce que c'est", what), field("Pourquoi", why), field("Tags", tags), field("Collection", collection)],
    confirmLabel: "Enregistrer",
    async onConfirm() {
      await patch(`/api/refs/${ref.id}`, {
        title: title.value.trim(),
        what: what.value.trim(),
        why: why.value.trim(),
        tags: tags.value.split(",").map((tag) => tag.trim()).filter(Boolean),
        collectionId: collection.value || null,
      });
      await loadCollections();
      host.toast("Référence mise à jour");
      refresh();
    },
  });
}
