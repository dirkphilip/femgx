import type { Viewport } from "../types";
import type { ViewportVisibilityPolicy } from "./state";

const policyReaders = new WeakMap<Viewport, () => ViewportVisibilityPolicy>();

/** Registers one viewport implementation with the internal host-state bridge. */
export function registerViewportVisibilityPolicy(
  viewport: Viewport,
  read: () => ViewportVisibilityPolicy,
): void {
  policyReaders.set(viewport, read);
}

/** Captures direct viewport-local visibility causes without exposing them publicly. */
export function captureViewportVisibilityPolicy(viewport: Viewport): ViewportVisibilityPolicy {
  const read = policyReaders.get(viewport);
  if (read === undefined) throw new Error("Viewport visibility policy is unavailable");
  return read();
}

/** Restores one policy after the host replaces a scene with its previous snapshot. */
export function restoreViewportVisibilityPolicy(
  viewport: Viewport,
  policy: ViewportVisibilityPolicy,
): void {
  viewport.batch(() => {
    for (const entry of policy.parts) viewport.visibility.setPartVisible(entry.id, entry.visible);
    for (const entry of policy.assemblies)
      viewport.visibility.setAssemblyVisible(entry.id, entry.visible);
    for (const entry of policy.assemblyOccurrences)
      viewport.visibility.setAssemblyOccurrenceVisible(entry.id, entry.visible);
    for (const entry of policy.partOccurrences)
      viewport.visibility.setPartOccurrenceVisible(entry.id, entry.visible);
  });
}

export type { ViewportVisibilityPolicy } from "./state";
