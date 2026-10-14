/**
 * Register and sign in. One decision per screen; the pending capture URL (a
 * `dnd.alysis.cat/https://…` opened while signed out) stays visible, so the
 * reason for the login form is on the screen.
 */

import { post } from "../api";
import type { User } from "../api";
import { h } from "../ui/controls";

export type AuthMode = "login" | "register";

export function buildAuth(mode: AuthMode, pendingUrl: string | null, onAuthenticated: (user: User) => void, go: (route: string) => void): HTMLElement {
  const email = h("input", { class: "input", type: "email", autocomplete: "email", inputmode: "email", placeholder: "vous@exemple.fr", required: "" });
  const password = h("input", { class: "input", type: "password", autocomplete: mode === "register" ? "new-password" : "current-password", placeholder: "10 caractères minimum", required: "" });
  const invite = h("input", { class: "input", placeholder: "Si votre instance en demande un" });
  const error = h("p", { class: "error-text", role: "alert" });
  const submit = h("button", { type: "submit", class: "btn primary", text: mode === "register" ? "Créer le compte" : "Se connecter" });
  const form = h("form", {}, [
    h("label", { class: "field" }, [h("span", { text: "Adresse e-mail" }), email]),
    h("label", { class: "field" }, [h("span", { text: "Mot de passe" }), password]),
    ...(mode === "register" ? [h("label", { class: "field" }, [h("span", { text: "Code d'invitation (facultatif)" }), invite])] : []),
    error,
    submit,
  ]);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    submit.disabled = true;
    try {
      const body: Record<string, string> = { email: email.value.trim(), password: password.value };
      if (mode === "register" && invite.value.trim()) body.inviteCode = invite.value.trim();
      const result = await post<{ user: User }>(mode === "register" ? "/api/auth/register" : "/api/auth/login", body);
      onAuthenticated(result.user);
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : "Échec de la connexion.";
    } finally {
      submit.disabled = false;
    }
  });
  const other = h("button", { type: "button", class: "link-btn", text: mode === "register" ? "J'ai déjà un compte" : "Créer un compte" });
  other.addEventListener("click", () => go(`#/${mode === "register" ? "login" : "register"}${pendingUrl ? `?next=${encodeURIComponent(pendingUrl)}` : ""}`));
  return h("main", { class: "auth" }, [
    h("span", { class: "wordmark", style: "text-align:left;padding:0", text: "DRD" }),
    h("h1", { text: mode === "register" ? "Créer un compte" : "Se connecter" }),
    pendingUrl ? h("p", {}, [h("span", { text: "À capturer après connexion : " }), h("strong", { class: "val", text: pendingUrl })]) : h("p", { class: "muted", text: "Capturer un site, garder ce qui plaît, dire pourquoi, exporter." }),
    form,
    other,
  ]);
}
