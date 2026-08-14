import type { SceneRuntime } from "../../src/index";
import type { WorkbenchCommands } from "./snapshot";
import type { SectionAxis } from "./section-controls";
import type { VisibilityRowTarget } from "./tree-hover";
import type { WorkbenchVisibilityActions } from "./visibility-actions";

interface WorkbenchCommandOwner {
  readonly runtime: SceneRuntime;
  readonly visibilityActions: WorkbenchVisibilityActions;
  setModel(id: string): void;
  setResultField(id: string): void;
  setSectionAxis(axis: string): void;
}

/** Adapts existing controller methods to the typed presentation command surface. */
export function createWorkbenchCommands(owner: WorkbenchCommandOwner): WorkbenchCommands {
  return {
    selectModel: (id) => {
      owner.setModel(id);
    },
    setResultField: (id) => {
      owner.setResultField(id);
    },
    setSectionAxis: (axis: SectionAxis) => {
      owner.setSectionAxis(axis);
    },
    toggleVisibility: (target) => {
      toggleVisibility(owner, target);
    },
  };
}

function toggleVisibility(owner: WorkbenchCommandOwner, target: VisibilityRowTarget): void {
  switch (target.kind) {
    case "assembly": {
      const occurrence = owner.runtime.getOccurrence(target.occurrenceId);
      if (occurrence !== undefined) {
        owner.visibilityActions.setAssemblyOccurrence(target.occurrenceId, !occurrence.visible);
      }
      break;
    }
    case "instance": {
      const instance = owner.runtime.getInstance(target.instanceId);
      if (instance !== undefined) {
        owner.visibilityActions.setInstance(target.instanceId, !instance.visible);
      }
      break;
    }
    case "body":
      owner.visibilityActions.setBody(
        target.instanceId,
        target.bodyId,
        !owner.visibilityActions.bodyVisible(target.instanceId, target.bodyId),
      );
      break;
  }
}
