/**
 * What every view needs from the shell: navigation, the short toast, whether
 * the server answered the last request, and the boards list the pickers use.
 * main.ts owns the implementation; views import this object and nothing else
 * from the shell.
 */

import { get, reachability } from "./api";
import type { Board, User } from "./api";

export const app = {
  user: null as User | null,
  go(route: string): void {
    if (location.hash === route) window.dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = route;
  },
  /** Replaces the current history entry: a tab change inside one screen. */
  replace(route: string): void {
    history.replaceState(null, "", route);
  },
  online(): boolean {
    return reachability.online && navigator.onLine;
  },
  toast: (_message: string, _action?: { label: string; run: () => void }): void => {},
  boards: [] as Board[],
  async loadBoards(): Promise<Board[]> {
    try {
      const { data } = await get<{ boards: Board[] }>("/api/boards");
      app.boards = data.boards;
    } catch {
      /* offline: keep the last list */
    }
    return app.boards;
  },
};

export function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function fullDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

/** French decimal comma, the way every measured number is shown. */
export function num(value: number, digits = 1): string {
  return value.toFixed(digits).replace(".", ",");
}

export function pct(share: number): string {
  const value = share * 100;
  return `${value >= 10 || value === 0 ? Math.round(value) : num(value)} %`;
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API refused (insecure context, permissions): the textarea path.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  app.toast("Copié");
}
