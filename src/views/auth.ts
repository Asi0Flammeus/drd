/**
 * Register and sign in.
 *
 * One decision per screen: either you are creating an account or you are
 * signing in, and the other option is one clearly-labelled link away. The
 * pending capture URL — someone who opened `drd.example/{url}` while signed
 * out — is carried through visibly, so the reason they are looking at a login
 * form is on the screen.
 */

import { post } from "../api";
import type { User } from "../api";
import { h } from "../ui/controls";
import { field, primaryButton, textInput } from "../ui/shell";

export type AuthMode = "login" | "register";

export function buildAuthPanel(
  mode: AuthMode,
  pendingUrl: string | null,
  onAuthenticated: (user: User) => void,
  go: (route: string) => void,
): HTMLElement {
  const email = textInput({ type: "email", autocomplete: "email", placeholder: "vous@exemple.fr", inputmode: "email" });
  const password = h("input", {
    class: "fld-input",
    type: "password",
    autocomplete: mode === "register" ? "new-password" : "current-password",
    placeholder: "10 caractères minimum",
  });
  const invite = textInput({ placeholder: "Si votre instance en demande un" });
  const error = h("p", { class: "form-error", role: "alert" });

  const submit = async () => {
    error.textContent = "";
    try {
      const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const body: Record<string, string> = { email: email.value.trim(), password: password.value };
      if (mode === "register" && invite.value.trim()) body.inviteCode = invite.value.trim();
      const result = await post<{ user: User }>(path, body);
      onAuthenticated(result.user);
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : "Échec de la connexion.";
    }
  };

  const form = h("form", { class: "auth-form" });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });

  const fields: Node[] = [field("Adresse e-mail", email), field("Mot de passe", password)];
  if (mode === "register") fields.push(field("Code d'invitation", invite, "Facultatif."));

  const switchLink = h("button", {
    type: "button",
    class: "link-button",
    text: mode === "register" ? "J'ai déjà un compte" : "Créer un compte",
  });
  switchLink.addEventListener("click", () => {
    const next = mode === "register" ? "login" : "register";
    go(`#/${next}${pendingUrl ? `?next=${encodeURIComponent(pendingUrl)}` : ""}`);
  });

  form.append(
    ...fields,
    error,
    primaryButton(mode === "register" ? "Créer le compte" : "Se connecter", () => void submit()),
    switchLink,
  );

  const intro = pendingUrl
    ? h("p", { class: "auth-pending" }, [
        h("span", { text: "À capturer après connexion : " }),
        h("strong", { text: pendingUrl }),
      ])
    : h("p", { class: "auth-blurb", text: "Capturez des sites, annotez ce qui vous plaît, exportez un pack de références." });

  return h("div", { class: "auth" }, [
    h("h2", { class: "auth-title", text: mode === "register" ? "Créer un compte DRD" : "Se connecter à DRD" }),
    intro,
    form,
  ]);
}
