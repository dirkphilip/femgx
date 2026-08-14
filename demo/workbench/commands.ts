import type { SceneRuntime } from "../../src/index";
import type { WorkbenchCommands, WorkbenchMenuAction } from "./snapshot";
import type { VisibilityRowTarget } from "./tree-hover";
import type { WorkbenchVisibilityActions } from "./visibility-actions";
import type { WorkbenchInteraction } from "./interaction";
import type { WorkbenchMenu } from "./menu";

interface WorkbenchCommandOwner {
  readonly runtime: SceneRuntime;
  readonly visibilityActions: WorkbenchVisibilityActions;
  readonly visibilityPanel: { toggleExpanded(occurrenceId: string): void };
  readonly menu: WorkbenchMenu;
  readonly interactionController: WorkbenchInteraction;
  setProjection(): void;
  setBackground(value: string): void;
  setEdges(): void;
  setNodes(): void;
  setContinuous(): void;
  setSelectionGranularity(value: string): void;
  toggleSecondaryViewport(): Promise<void>;
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
  openModel(file: File): Promise<void>;
  setResultField(id: string): void;
  setSectionAxis(axis: string): void;
  setSectionOffset(value: string): void;
  setTreeHover(target: VisibilityRowTarget | undefined): void;
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
    toggleSecondaryViewport: () => {
      void owner.toggleSecondaryViewport();
    },
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
    openModel: (file) => {
      void owner.openModel(file);
    },
    setResultField: owner.setResultField.bind(owner),
    setSectionAxis: owner.setSectionAxis.bind(owner),
    setSectionOffset: owner.setSectionOffset.bind(owner),
    contextMenuAction: (action: WorkbenchMenuAction) => {
      owner.menu.activate(action);
    },
    clearContextMenu: () => {
      owner.interactionController.clearContext();
    },
    toggleVisibility: (target) => {
      toggleVisibility(owner, target);
    },
    toggleVisibilityTree: (occurrenceId) => {
      owner.visibilityPanel.toggleExpanded(occurrenceId);
    },
    toggleBodyHighlight: (target) => {
      owner.visibilityActions.bodyHighlight(target.instanceId, target.bodyId);
    },
    setTreeHover: owner.setTreeHover.bind(owner),
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
