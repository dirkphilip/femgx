import type { SceneRuntime } from "../../../src/entries/runtime";
import type { WorkbenchCommands, WorkbenchMenuAction } from "../results/snapshot";
import type { WorkbenchElementDetailActions } from "../controllers/controller-element-detail";
import type { WorkbenchResultPlaybackActions } from "../results/result-playback";
import type { WorkbenchModel } from "../models/model";
import { setVectorWidthPixels as applyVectorWidth } from "../results/vector-actions";
import type { VectorDisplayState } from "../results/result-controls";
import type { VisibilityRowTarget } from "../state/visibility-snapshot";
import type { WorkbenchVisibilityActions } from "../state/visibility-actions";
import type { WorkbenchInteraction } from "./interaction";
import type { WorkbenchMenu } from "./menu";

interface WorkbenchCommandOwner {
  readonly model: WorkbenchModel;
  vectorDisplay: VectorDisplayState;
  readonly presentation: { reflectResults: () => void };
  applyResultMode(render: boolean): void;
  readonly runtime: SceneRuntime;
  readonly visibilityActions: WorkbenchVisibilityActions;
  readonly visibilityPanel: { toggleExpanded(occurrenceId: string): void };
  readonly menu: WorkbenchMenu;
  readonly interactionController: WorkbenchInteraction;
  setProjection(): void;
  setCatalogMode(mode: "ordinary" | "performance"): void;
  setBackground(value: string): void;
  setEdges(): void;
  setNodes(): void;
  setContinuous(): void;
  setSelectionGranularity(value: string): void;
  setBoxSelectionStrategy(value: string): void;
  setTouchInteractionMode(value: string): void;
  toggleSecondaryViewport(): Promise<void>;
  setDeformationField(value: string): void;
  setDeformationScale(value: string): void;
  setVectorField(value: string): void;
  setVectorGlyph(value: string): void;
  setVectorTransform(value: string): void;
  setVectorLengthScale(value: string): void;
  fitSelection(): void;
  selectAll(): void;
  hideSelected(): void;
  showAll(): void;
  reset(): void;
  setModel(id: string): void;
  openModel(file: File): Promise<void>;
  setResultField(id: string): void;
  setSectionAxis(axis: string): void;
  setSectionOffset(value: string): void;
  setHierarchyHover(target: VisibilityRowTarget): void;
  clearHierarchyHover(target: VisibilityRowTarget): void;
  readonly elementDetailActions: WorkbenchElementDetailActions;
  readonly resultPlaybackActions: WorkbenchResultPlaybackActions;
}

/** Adapts existing controller methods to the typed presentation command surface. */
export function createWorkbenchCommands(owner: WorkbenchCommandOwner): WorkbenchCommands {
  return {
    setProjection: owner.setProjection.bind(owner),
    setCatalogMode: owner.setCatalogMode.bind(owner),
    setBackground: owner.setBackground.bind(owner),
    toggleEdges: owner.setEdges.bind(owner),
    toggleNodes: owner.setNodes.bind(owner),
    toggleContinuous: owner.setContinuous.bind(owner),
    setSelectionGranularity: owner.setSelectionGranularity.bind(owner),
    setBoxSelectionStrategy: owner.setBoxSelectionStrategy.bind(owner),
    setTouchInteractionMode: owner.setTouchInteractionMode.bind(owner),
    toggleSecondaryViewport: () => {
      void owner.toggleSecondaryViewport();
    },
    setDeformationField: owner.setDeformationField.bind(owner),
    setDeformationScale: owner.setDeformationScale.bind(owner),
    setVectorField: owner.setVectorField.bind(owner),
    setVectorGlyph: owner.setVectorGlyph.bind(owner),
    setVectorTransform: owner.setVectorTransform.bind(owner),
    setVectorLengthScale: owner.setVectorLengthScale.bind(owner),
    setVectorWidthPixels: (value) => {
      applyVectorWidth(owner, value);
    },
    ...selectionCommands(owner),
    reset: owner.reset.bind(owner),
    selectModel: owner.setModel.bind(owner),
    openModel: owner.openModel.bind(owner),
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
    setHierarchyHover: owner.setHierarchyHover.bind(owner),
    clearHierarchyHover: owner.clearHierarchyHover.bind(owner),
    openElementDetail: owner.elementDetailActions.openElementDetail,
    closeElementDetail: owner.elementDetailActions.closeElementDetail,
    selectElementDetail: owner.elementDetailActions.selectElementDetail,
    setElementDetailHover: owner.elementDetailActions.setElementDetailHover,
    clearElementDetailHover: owner.elementDetailActions.clearElementDetailHover,
    ...resultPlaybackCommands(owner),
  };
}

function selectionCommands(
  owner: WorkbenchCommandOwner,
): Pick<
  WorkbenchCommands,
  "fitSelection" | "selectAll" | "hideSelected" | "clearSelection" | "showAll"
> {
  return {
    fitSelection: owner.fitSelection.bind(owner),
    selectAll: owner.selectAll.bind(owner),
    hideSelected: owner.hideSelected.bind(owner),
    clearSelection: () => {
      owner.interactionController.clearSelection();
    },
    showAll: owner.showAll.bind(owner),
  };
}

function resultPlaybackCommands(
  owner: WorkbenchCommandOwner,
): Pick<
  WorkbenchCommands,
  | "setResultPlaybackIndex"
  | "previousResultPlayback"
  | "nextResultPlayback"
  | "toggleResultPlayback"
  | "setResultPlaybackRate"
> {
  return {
    setResultPlaybackIndex: owner.resultPlaybackActions.setIndex,
    previousResultPlayback: owner.resultPlaybackActions.previous,
    nextResultPlayback: owner.resultPlaybackActions.next,
    toggleResultPlayback: owner.resultPlaybackActions.togglePlaying,
    setResultPlaybackRate: owner.resultPlaybackActions.setRate,
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
