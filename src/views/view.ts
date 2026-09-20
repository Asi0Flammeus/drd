import type { Workspace } from "../state";

export type ViewContext = {
  ws: Workspace;
  /** Cheap update: re-apply custom properties and readouts, then persist. */
  commit(): void;
  /** Structural update: a control's own range or set changed, rebuild the panel. */
  rebuild(): void;
  /** Navigate to a hash route, e.g. `#/collections`. */
  go(route: string): void;
  toast(message: string): void;
};

export type Panel = {
  el: HTMLElement;
  /** Called by commit(); must not allocate DOM. */
  sync(): void;
};
