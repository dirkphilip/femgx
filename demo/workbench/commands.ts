import type { SceneRuntime } from "../../src/index";
import type { WorkbenchCommands } from "./snapshot";
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
  setDeformationField(value: string): void;
  setDeformationScale(value: string): void;
  setVectorField(value: string): void;
  setVectorGlyph(value: string): void;
  setVectorTransform(value: string): void;
  setVectorLengthScale(value: string): void;
  fitView(): void;
  hideSelected(): void;
  showAll(): void;
  reset(): void;
  setModel(id: string): void;
  setResultField(id: string): void;
  setSectionAxis(axis: string): void;
  setSectionOffset(value: string): void;
}

/** Adapts existing controller methods to the typed presentation command surface. */
export function createWorkbenchCommands(owner: WorkbenchCommandOwner): WorkbenchCommands {
  return {
    setProjection: owner.setProjection.bind(owner),
    setBackground: owner.setBackground.bind(owner),
    toggleEdges: owner.setEdges.bind(owner),
    toggleNodes: owner.setNodes.bind(owner),
    toggleContinuous: owner.setContinuous.bind(owner),
    setSelectionGranularity: owner.setSelectionGranularity.bind(owner),
    setDeformationField: owner.setDeformationField.bind(owner),
    setDeformationScale: owner.setDeformationScale.bind(owner),
    setVectorField: owner.setVectorField.bind(owner),
    setVectorGlyph: owner.setVectorGlyph.bind(owner),
    setVectorTransform: owner.setVectorTransform.bind(owner),
    setVectorLengthScale: owner.setVectorLengthScale.bind(owner),
    fitView: owner.fitView.bind(owner),
    hideSelected: owner.hideSelected.bind(owner),
    showAll: owner.showAll.bind(owner),
    reset: owner.reset.bind(owner),
    selectModel: owner.setModel.bind(owner),
    setResultField: owner.setResultField.bind(owner),
    setSectionAxis: owner.setSectionAxis.bind(owner),
    setSectionOffset: owner.setSectionOffset.bind(owner),
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
