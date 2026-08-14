import type { InteractionTarget } from "../../src/index";
import { interactionTargetsForRow, type VisibilityRowTarget } from "./tree-hover";
import { isDestroyedViewportError } from "./workbench-values";

interface TreeHoverOwner {
  readonly runtime: Parameters<typeof interactionTargetsForRow>[0];
  readonly viewportSlots: {
    all: () => readonly { readonly pane: { readonly canvas: HTMLCanvasElement } }[];
  };
  treeHoverTargets: readonly InteractionTarget[];
  render: () => void;
}

/** Applies one visibility-row hover to every viewport and publishes its state. */
export function setTreeHover(
  owner: TreeHoverOwner,
  target: VisibilityRowTarget | undefined,
  isDisposed: () => boolean,
): void {
  if (isDisposed()) return;
  owner.treeHoverTargets =
    target === undefined ? [] : interactionTargetsForRow(owner.runtime, target);
  const encoded = owner.treeHoverTargets.map((value) => JSON.stringify(value)).join("|");
  for (const slot of owner.viewportSlots.all()) slot.pane.canvas.dataset["treeHover"] = encoded;
  try {
    owner.render();
  } catch (error) {
    if (!isDestroyedViewportError(error)) throw error;
  }
}
