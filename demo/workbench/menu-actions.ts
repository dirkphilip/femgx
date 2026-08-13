import type { DisplayToggles } from "./types";
import type { SelectTarget } from "./pick";
import type { WorkbenchInteraction } from "./interaction";
import type { WorkbenchVisibilityActions } from "./visibility-actions";

/** Controller callbacks used by the workbench context-menu action dispatcher. */
export interface WorkbenchMenuActionContext {
  readonly target: SelectTarget | undefined;
  readonly interaction: WorkbenchInteraction;
  readonly visibilityActions: WorkbenchVisibilityActions;
  readonly toggles: DisplayToggles;
  readonly setEdges: () => void;
  readonly setDiagnostics: () => void;
  readonly fitView: () => void;
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
    case "fit-view":
      context.fitView();
      break;
    case "reset":
      context.reset();
      break;
  }
}
