import { selectedTargetSummary } from "@/interaction/selection-queries";
import {
  DEFORMATION_OFF_VALUE,
  displayedScalarFieldId,
  resultScalarFieldsForModel,
  resultVectorFieldsForModel,
  VECTOR_OFF_VALUE,
} from "./result-controls";
import { sectionRange } from "../section-controls";
import { hasVisibleSelection } from "../selection/selection";
import { visibleSelectedElementTargets } from "../state/visibility-actions";
import { emptyResultLegend } from "./result-legend";
import type {
  WorkbenchResultField,
  WorkbenchSnapshot,
  WorkbenchSnapshotInput,
  WorkbenchPresentationSnapshot,
} from "./snapshot";

/** Builds a bounded immutable presentation snapshot without exposing runtime or GPU storage. */
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
      hideSelectedElementCount: visibleSelectedElementTargets(input.interaction).length,
      elementDetail:
        input.elementDetail === undefined ? undefined : Object.freeze({ ...input.elementDetail }),
      visibility,
    }),
    overlays: createOverlaySnapshot(presentation),
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
