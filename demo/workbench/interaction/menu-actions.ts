import type { DisplayToggles } from "../types";
import { elementBlockTarget, type SelectTarget } from "../selection/pick";
import type { WorkbenchInteraction } from "./interaction";
import type { WorkbenchVisibilityActions } from "../state/visibility-actions";

/** Controller callbacks used by the workbench context-menu action dispatcher. */
export interface WorkbenchMenuActionContext {
  readonly target: SelectTarget | undefined;
  readonly interaction: WorkbenchInteraction;
  readonly visibilityActions: WorkbenchVisibilityActions;
  readonly toggles: DisplayToggles;
  readonly setEdges: () => void;
  readonly setDiagnostics: () => void;
  readonly fitSelection: () => void;
  readonly reset: () => void;
}

/** Applies one menu action without adding policy to the DOM menu renderer. */
export function applyMenuAction(action: string, context: WorkbenchMenuActionContext): void {
  const { target } = context;
  switch (action) {
    case "highlight":
      if (target !== undefined) context.interaction.highlight(target);
      break;
    case "select":
      if (target !== undefined) context.interaction.select(target);
      break;
    case "select-element":
      if (target !== undefined) context.interaction.selectElement(target);
      break;
    case "select-block": {
      const block = target === undefined ? undefined : elementBlockTarget(target);
      if (block !== undefined) context.interaction.select(block);
      break;
    }
    case "hide-element":
      if (target !== undefined) context.visibilityActions.toggleElement(target);
      break;
    case "hide-instance":
      if (target !== undefined) context.visibilityActions.toggleInstance(target);
      break;
    case "hide-part":
      if (target !== undefined) context.visibilityActions.togglePart(target);
      break;
    case "clear-selection":
      context.interaction.clearSelection();
      break;
    case "show-all":
      context.visibilityActions.showAll();
      break;
    case "edges":
      context.setEdges();
      break;
    case "diagnostics":
      context.setDiagnostics();
      break;
    case "fit-selection":
      context.fitSelection();
      break;
    case "reset":
      context.reset();
      break;
  }
}
