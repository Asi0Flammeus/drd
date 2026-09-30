/**
 * Keeping from an Atelier bench: the same one-tap gesture as a finding. The
 * item is created at once with the bench's full state and its resolved
 * tokens, and the keep toast asks why.
 */

import { post } from "../api";
import type { KeepResult } from "../api";
import { app } from "../app";
import { familyById } from "../data/fonts";
import { resolvePalette } from "../state";
import type { DimensionId } from "../state";
import { currentRoles, tokenTree, tokensAsCss } from "../tokens";
import { keepToast } from "../ui/keep";
import type { ViewContext } from "./view";

const KIND: Record<DimensionId, string> = { type: "type", color: "palette", components: "component" };

export async function saveEntry(ctx: ViewContext, dimension: DimensionId, label: string, spec: unknown): Promise<void> {
  const data: Record<string, unknown> = { source: "atelier", dimension, spec, css: tokensAsCss(ctx.ws), tokens: tokenTree(ctx.ws) };
  if (dimension === "color") {
    const resolved = resolvePalette(ctx.ws.color);
    const roles = currentRoles(ctx.ws);
    data.ramp = resolved.ramp;
    data.roles = { fond: roles.surface, surface: roles.surfaceRaised, texte: roles.ink, "texte 2": roles.inkDim, accent: roles.accent, bordure: roles.line };
  }
  if (dimension === "type") {
    // CSS family names, the ones the self-hosted @font-face rules declare.
    data.display = { family: familyById(ctx.ws.type.displayFamily).name, size: ctx.ws.type.displaySize, weight: ctx.ws.type.displayWeight };
    data.body = { family: familyById(ctx.ws.type.bodyFamily).name, size: ctx.ws.type.bodySize, weight: ctx.ws.type.bodyWeight };
  }
  try {
    const result = await post<KeepResult>("/api/items", { kind: KIND[dimension], subkind: "atelier", title: label, data });
    keepToast(result, { onUndo: () => {} });
  } catch (error) {
    app.toast(error instanceof Error ? error.message : "Non gardé");
  }
}
