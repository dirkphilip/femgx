import type { SceneRuntime } from "../../src/index";
import type { WorkbenchCommands } from "./snapshot";
import type { SectionAxis } from "./section-controls";
import type { VisibilityRowTarget } from "./tree-hover";
import type { WorkbenchVisibilityActions } from "./visibility-actions";

interface WorkbenchCommandOwner {
  readonly runtime: SceneRuntime;
  readonly visibilityActions: WorkbenchVisibilityActions;
  setProjection(): void;
  setBackground(value: string): void;
  setEdges(): void;
  setNodes(): void;
  setContinuous(): void;
  setSelectionGranularity(value: string): void;
  fitView(): void;
  hideSelected(): void;
  showAll(): void;
  reset(): void;
  setModel(id: string): void;
  setResultField(id: string): void;
  setSectionAxis(axis: string): void;
}

/** Adapts existing controller methods to the typed presentation command surface. */
export function createWorkbenchCommands(owner: WorkbenchCommandOwner): WorkbenchCommands {
  return {
    setProjection: () => {
      owner.setProjection();
    },
    setBackground: (value) => {
      owner.setBackground(value);
    },
    toggleEdges: () => {
      owner.setEdges();
    },
    toggleNodes: () => {
      owner.setNodes();
    },
    toggleContinuous: () => {
      owner.setContinuous();
    },
    setSelectionGranularity: (value) => {
      owner.setSelectionGranularity(value);
    },
    fitView: () => {
      owner.fitView();
    },
    hideSelected: () => {
      owner.hideSelected();
    },
    showAll: () => {
      owner.showAll();
    },
    reset: () => {
      owner.reset();
    },
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
