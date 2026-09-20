/**
 * Discovery, with its evidence shown.
 *
 * Every candidate carries the reasons it scored — "crédit en pied de page sur
 * X", "cité par trois sites que vous avez capturés" — because a suggestion
 * you cannot audit is a suggestion you cannot trust, and this list is built
 * from a link graph, not from an oracle. Providers that are not configured say
 * so rather than quietly returning nothing.
 */

import { get, post } from "../api";
import type { Candidate } from "../api";
import { h, ICONS, textButton } from "../ui/controls";
import { emptyState, sectionHead } from "../ui/shell";

export type DiscoveryHost = { toast(message: string): void; go(route: string): void };

type Payload = {
  candidates: Candidate[];
  providers: { id: string; label: string; available: boolean; reason: string | null }[];
  profile: { tags: [string, number][]; words: [string, number][]; hosts: string[] };
};

export function buildDiscoveryPanel(host: DiscoveryHost): HTMLElement {
  const root = h("section", { class: "panel" });
  const body = h("div", { class: "discovery-body" });

  const refresh = textButton("Recalculer", ICONS.reset, async () => {
    body.replaceChildren(h("p", { class: "loading", text: "Analyse du graphe de liens…" }));
    try {
      await post("/api/discovery/refresh");
      host.toast("Suggestions recalculées");
    } catch (failure) {
      host.toast(failure instanceof Error ? failure.message : "Recalcul impossible");
    }
    void load();
  });

  root.append(
    sectionHead("Découverte", "Des pistes réelles, tirées de ce que vos captures citent.", [refresh]),
    body,
  );

  const load = async () => {
    body.replaceChildren(h("p", { class: "loading", text: "Chargement…" }));
    try {
      const { data, stale } = await get<Payload>("/api/discovery");
      body.replaceChildren();
      if (stale) body.append(h("p", { class: "meta-item is-stale", text: "Hors ligne — dernières suggestions connues." }));

      body.append(profileCard(data.profile), providerCard(data.providers));

      if (data.candidates.length === 0) {
        body.append(
          emptyState(
            "Aucune piste pour l'instant",
            "Capturez deux ou trois sites : les crédits de pied de page et les liens croisés font apparaître les studios derrière.",
          ),
        );
        return;
      }
      const list = h("div", { class: "candidate-list" });
      for (const candidate of data.candidates) list.append(candidateCard(candidate, host, load));
      body.append(list);
    } catch (failure) {
      body.replaceChildren(emptyState("Découverte indisponible", failure instanceof Error ? failure.message : "Erreur."));
    }
  };

  void load();
  return root;
}

function profileCard(profile: Payload["profile"]): HTMLElement {
  const tags = profile.tags.length
    ? profile.tags.map(([tag, count]) => `${tag} (${count})`).join(" · ")
    : "Aucun tag encore — annotez quelques références.";
  const words = profile.words.length ? profile.words.slice(0, 8).map(([word]) => word).join(" · ") : "—";
  return h("section", { class: "profile-card" }, [
    h("h3", { class: "inv-title", text: "Votre profil de goût" }),
    h("p", { class: "profile-line" }, [h("strong", { text: "Tags : " }), h("span", { text: tags })]),
    h("p", { class: "profile-line" }, [h("strong", { text: "Mots de vos « pourquoi » : " }), h("span", { text: words })]),
    h("p", { class: "profile-line" }, [
      h("strong", { text: "Déjà capturé : " }),
      h("span", { text: profile.hosts.length ? profile.hosts.join(", ") : "rien" }),
    ]),
  ]);
}

function providerCard(providers: Payload["providers"]): HTMLElement {
  const list = h("ul", { class: "provider-list" });
  for (const provider of providers) {
    list.append(
      h("li", { class: provider.available ? "is-on" : "is-off" }, [
        h("strong", { text: provider.label }),
        h("span", { text: provider.available ? " — actif" : ` — ${provider.reason ?? "non configuré"}` }),
      ]),
    );
  }
  return h("section", { class: "provider-card" }, [h("h3", { class: "inv-title", text: "Sources de suggestions" }), list]);
}

function candidateCard(candidate: Candidate, host: DiscoveryHost, refresh: () => void): HTMLElement {
  const reasons = h("ul", { class: "reason-list" });
  for (const reason of candidate.reasons) reasons.append(h("li", { text: reason }));

  const accept = textButton("Capturer", ICONS.check, async () => {
    try {
      const result = await post<{ captureId: string }>(`/api/discovery/${candidate.id}/accept`);
      host.toast("Capture lancée");
      host.go(`#/captures/${result.captureId}`);
    } catch (failure) {
      host.toast(failure instanceof Error ? failure.message : "Impossible");
    }
  });
  const dismiss = textButton("Écarter", ICONS.dash, async () => {
    await post(`/api/discovery/${candidate.id}/dismiss`);
    host.toast("Piste écartée");
    refresh();
  });

  return h("article", { class: "candidate" }, [
    h("div", { class: "candidate-head" }, [
      h("h4", { class: "candidate-host", text: candidate.host }),
      h("span", { class: "candidate-score", text: `score ${candidate.score}` }),
    ]),
    h("a", { class: "candidate-url", href: candidate.url, target: "_blank", rel: "noreferrer noopener", text: candidate.url }),
    reasons,
    h("div", { class: "candidate-actions" }, [accept, dismiss]),
  ]);
}
