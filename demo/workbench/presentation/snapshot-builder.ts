import {
  selectedElementVisibilitySummary,
  selectedTargetSummary,
} from "@/interaction/selection-queries";
import type { InteractionState } from "@/entries/interaction";
import type { Camera } from "@/entries/camera";
import type { SceneOccurrences, ViewportBackground } from "@/entries/root";
import {
  DEFORMATION_OFF_VALUE,
  displayedScalarFieldId,
  resultScalarFieldsForModel,
  resultVectorFieldsForModel,
  VECTOR_OFF_VALUE,
} from "../results/result-controls";
import { sectionRange } from "../section-controls";
import { hasVisibleSelection } from "../selection/selection";
import { emptyResultLegend } from "../results/result-legend";
import type { WorkbenchResultPlaybackActions } from "../results/result-playback";
import type { WorkbenchModel } from "../models/model";
import type { WorkbenchCatalogMode } from "../models/model-catalog";
import type { WorkbenchVisibilitySnapshot } from "../state/visibility-snapshot";
import type { DisplayToggles, ResultDisplayMode, TouchInteractionMode } from "../types";
import type {
  WorkbenchLivePartDialogSnapshot,
  WorkbenchResultField,
  WorkbenchSnapshot,
  WorkbenchSnapshotInput,
  WorkbenchPresentationSnapshot,
  WorkbenchSnapshotListener,
} from "./snapshot";
import type { WorkbenchElementDetailSnapshot } from "../state/show-state";
import type { BoxSelectionStrategy } from "../selection/box-selection-resolver";
import type { SelectionGranularity } from "../selection/pick";
import type { SectionAxis } from "../section-controls";
import type { VectorDisplayState } from "../results/result-controls";

/** Builds a presentation snapshot from controller-owned state. */
export function createWorkbenchSnapshot(input: WorkbenchSnapshotInput): WorkbenchSnapshot {
  const presentation = input.presentation ?? defaultPresentationSnapshot(input.toggles.diagnostics);
  const visibility = input.visibility ?? {
    context: "",
    rows: [],
    page: 0,
    pageCount: 0,
    rowCount: 0,
    materializedRowCount: 0,
  };
  const active = Object.freeze({
    id: input.model.id,
    name: input.model.name,
    source: input.model.source,
  });
  const available = Object.freeze(
    input.models.map((model) =>
      Object.freeze({ id: model.id, name: model.name, source: model.source }),
    ),
  );
  return Object.freeze({
    model: Object.freeze({
      mode: input.catalogMode,
      selectedId: input.catalogSelectionId,
      active,
      available,
      partCount: input.model.scene.parts.size,
      loading: presentation.loading,
      selectionDisabled: presentation.modelSelectionDisabled,
      openDisabled: presentation.modelOpenDisabled,
    }),
    toolbar: createToolbarSnapshot(input),
    analysis: createAnalysisSnapshot(input),
    hierarchy: Object.freeze({
      occurrenceCount: input.runtime.assemblyOccurrenceCount,
      visiblePartOccurrences: input.runtime.visibleCount,
      selectedCount: selectedTargetSummary(input.interaction).count,
      hideSelectedElementCount: selectedElementVisibilitySummary(input.interaction).visibleCount,
      elementDetail:
        input.elementDetail === undefined ? undefined : Object.freeze({ ...input.elementDetail }),
      visibility,
    }),
    overlays: createOverlaySnapshot(presentation, input.livePartDialog),
  });
}

function createToolbarSnapshot(input: WorkbenchSnapshotInput): WorkbenchSnapshot["toolbar"] {
  return Object.freeze({
    rendererName: input.rendererName,
    rendererState: input.rendererState,
    projection: input.cameraMode,
    background: input.background,
    edges: input.toggles.edges,
    nodes: input.toggles.nodes,
    continuous: input.continuous,
    fitSelectionAvailable: hasVisibleSelection(input.interaction, input.runtime),
    selectionGranularity: input.selectionGranularity,
    boxSelectionStrategy: input.boxSelectionStrategy,
    touchInteractionMode: input.touchInteractionMode,
    activeSlot: input.activeSlot,
    secondaryOpen: input.secondaryOpen,
    secondaryBusy: input.secondaryBusy,
  });
}

function createAnalysisSnapshot(input: WorkbenchSnapshotInput): WorkbenchSnapshot["analysis"] {
  const deformation = input.model.results?.deformation?.field;
  const playback = input.resultPlayback;
  const playbackActive = playback?.active === true;
  const scalarFields = resultScalarFieldsForModel(input.model).map(resultField);
  const deformationFields = deformation === undefined ? [] : [resultField(deformation)];
  const vectorFields = resultVectorFieldsForModel(input.model).map((field) =>
    Object.freeze({ id: field.id, name: field.name, shape: field.shape }),
  );
  const resultControlsVisible =
    scalarFields.length > 0 || deformation !== undefined || vectorFields.length > 0;
  const vectorFieldId = vectorFields.some((field) => field.id === input.vectorDisplay.fieldId)
    ? input.vectorDisplay.fieldId
    : VECTOR_OFF_VALUE;
  return Object.freeze({
    resultControlsVisible,
    resultMode: input.resultMode,
    scalarFields: Object.freeze(scalarFields),
    scalarFieldId: playbackActive
      ? playback.scalar.id
      : displayedScalarFieldId(input.resultMode, input.scalarFieldId),
    deformationFields: Object.freeze(deformationFields),
    deformationFieldId: playbackActive
      ? playback.deformation.id
      : input.resultMode === "deformed" && deformation !== undefined
        ? deformation.id
        : DEFORMATION_OFF_VALUE,
    deformationDisabled: playbackActive
      ? false
      : input.resultMode === "base" || deformation === undefined,
    deformationScale: input.deformationScale,
    vector: Object.freeze({ ...input.vectorDisplay, fieldId: vectorFieldId }),
    vectorFields: Object.freeze(vectorFields),
    vectorControlsDisabled: vectorFieldId === VECTOR_OFF_VALUE,
    sectionAxis: input.sectionAxis,
    sectionOffset: input.sectionOffset,
    sectionRange: sectionRange(input.model.bounds, input.sectionAxis),
    playback,
  });
}

function createOverlaySnapshot(
  presentation: WorkbenchPresentationSnapshot,
  livePartDialog: WorkbenchSnapshotInput["livePartDialog"],
): WorkbenchSnapshot["overlays"] {
  return Object.freeze({
    diagnostics: presentation.diagnostics.visible,
    rendererStatus: presentation.rendererStatus,
    rendererStatusVisible: presentation.rendererStatusVisible,
    status: presentation.status,
    statusVisible: presentation.statusVisible,
    feedback: presentation.feedback,
    inspection: presentation.inspection,
    diagnosticsText: presentation.diagnostics.text,
    resultLegend: presentation.resultLegend,
    contextMenu: presentation.contextMenu,
    ...(livePartDialog === undefined
      ? {}
      : { livePartDialog: Object.freeze({ ...livePartDialog }) }),
  });
}

function defaultPresentationSnapshot(diagnostics: boolean): WorkbenchPresentationSnapshot {
  return {
    loading: false,
    modelSelectionDisabled: false,
    modelOpenDisabled: false,
    feedback: undefined,
    rendererStatus: "",
    rendererStatusVisible: false,
    status: "",
    statusVisible: false,
    inspection: {
      visible: false,
      text: "Click or right-click a visible element, face, node, or authored edge to inspect it.",
    },
    diagnostics: { visible: diagnostics, text: "" },
    resultLegend: emptyResultLegend(),
    contextMenu: { visible: false, x: 0, y: 0, title: "", entries: [] },
  };
}

function resultField(field: {
  readonly id: string;
  readonly name: string;
  readonly location: "nodal" | "elemental";
}): WorkbenchResultField {
  return Object.freeze({ id: field.id, name: field.name, location: field.location });
}

interface WorkbenchSnapshotOwner {
  readonly model: WorkbenchModel;
  readonly models: readonly WorkbenchModel[];
  readonly catalogMode: WorkbenchCatalogMode;
  readonly catalogSelectionId: string;
  readonly runtime: SceneOccurrences;
  readonly interaction: InteractionState;
  readonly rendererName: string;
  readonly rendererState: string;
  readonly background: ViewportBackground;
  readonly toggles: Readonly<DisplayToggles>;
  readonly continuousEnabled: boolean;
  readonly selectionGranularity: SelectionGranularity;
  readonly boxSelectionStrategy: BoxSelectionStrategy;
  readonly touchInteractionMode: TouchInteractionMode;
  readonly scalarFieldId: string;
  readonly resultMode: ResultDisplayMode;
  readonly deformationScale: number;
  readonly vectorDisplay: VectorDisplayState;
  readonly sectionAxis: SectionAxis;
  readonly sectionOffset: number;
  readonly elementDetail: WorkbenchElementDetailSnapshot | undefined;
  readonly livePartDialog: WorkbenchLivePartDialogSnapshot | undefined;
  readonly resultPlaybackActions: Pick<WorkbenchResultPlaybackActions, "snapshot">;
  readonly presentation: { snapshot(): WorkbenchPresentationSnapshot };
  readonly visibilityPanel: { snapshot(): WorkbenchVisibilitySnapshot };
  readonly viewportSlots: {
    activeSlot(): { readonly id: "primary" | "secondary" };
    isSecondaryVisible(): boolean;
    isSecondaryOpening(): boolean;
  };
  activeViewport(): { readonly view: { readonly camera: Pick<Camera, "mode"> } };
}

/** Owns one presentation snapshot stream without creating a second state owner. */
export class WorkbenchSnapshotBridge {
  private readonly listeners = new Set<WorkbenchSnapshotListener>();

  constructor(private readonly read: () => WorkbenchSnapshotInput) {}

  get current(): WorkbenchSnapshot {
    return createWorkbenchSnapshot(this.read());
  }

  subscribe(listener: WorkbenchSnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.current;
    for (const listener of this.listeners) listener(snapshot);
  }
}

/** Adapts the controller's state owner to the immutable presentation snapshot input. */
export function snapshotInputFromOwner(owner: WorkbenchSnapshotOwner): WorkbenchSnapshotInput {
  const resultPlayback = owner.resultPlaybackActions.snapshot();
  return {
    model: owner.model,
    models: owner.models,
    catalogMode: owner.catalogMode,
    catalogSelectionId: owner.catalogSelectionId,
    runtime: owner.runtime,
    interaction: owner.interaction,
    rendererName: owner.rendererName,
    rendererState: owner.rendererState,
    cameraMode: owner.activeViewport().view.camera.mode,
    background: owner.background,
    toggles: owner.toggles,
    continuous: owner.continuousEnabled,
    selectionGranularity: owner.selectionGranularity,
    boxSelectionStrategy: owner.boxSelectionStrategy,
    touchInteractionMode: owner.touchInteractionMode,
    activeSlot: owner.viewportSlots.activeSlot().id,
    scalarFieldId: owner.scalarFieldId,
    secondaryOpen: owner.viewportSlots.isSecondaryVisible(),
    secondaryBusy: owner.viewportSlots.isSecondaryOpening(),
    resultMode: owner.resultMode,
    deformationScale: owner.deformationScale,
    vectorDisplay: owner.vectorDisplay,
    sectionAxis: owner.sectionAxis,
    sectionOffset: owner.sectionOffset,
    ...(owner.elementDetail === undefined ? {} : { elementDetail: owner.elementDetail }),
    ...(owner.livePartDialog === undefined ? {} : { livePartDialog: owner.livePartDialog }),
    ...(resultPlayback === undefined ? {} : { resultPlayback }),
    presentation: owner.presentation.snapshot(),
    visibility: owner.visibilityPanel.snapshot(),
  };
}
