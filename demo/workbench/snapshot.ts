import { selectedTargets } from "../../src/index";
import type { Camera, InteractionState, SceneRuntime, ViewportBackground } from "../../src/index";
import type { WorkbenchModel } from "./model";
import type { SelectionGranularity } from "./pick";
import { sectionAxisBounds, type SectionAxis } from "./section-controls";
import {
  BASE_RESULT_VALUE,
  DEFORMATION_OFF_VALUE,
  resultVectorFieldsForModel,
  VECTOR_OFF_VALUE,
} from "./result-controls";
import type { DisplayToggles } from "./types";
import type { ResultDisplayMode } from "./types";
import type { VectorDisplayState } from "./result-controls";
import type { VisibilityRowTarget } from "./tree-hover";

export interface WorkbenchSnapshot {
  readonly model: {
    readonly active: {
      readonly id: string;
      readonly name: string;
      readonly source: "example" | "file";
    };
    readonly available: readonly {
      readonly id: string;
      readonly name: string;
      readonly source: "example" | "file";
    }[];
    readonly partCount: number;
  };
  readonly toolbar: {
    readonly rendererName: string;
    readonly rendererState: string;
    readonly projection: Camera["mode"];
    readonly background: ViewportBackground;
    readonly edges: boolean;
    readonly nodes: boolean;
    readonly continuous: boolean;
    readonly selectionGranularity: SelectionGranularity;
  };
  readonly analysis: {
    readonly resultControlsVisible: boolean;
    readonly resultMode: ResultDisplayMode;
    readonly scalarFields: readonly WorkbenchResultField[];
    readonly scalarFieldId: string;
    readonly deformationFields: readonly WorkbenchResultField[];
    readonly deformationFieldId: string;
    readonly deformationDisabled: boolean;
    readonly deformationScale: number;
    readonly vector: Readonly<VectorDisplayState>;
    readonly vectorFields: readonly WorkbenchVectorField[];
    readonly vectorControlsDisabled: boolean;
    readonly sectionAxis: SectionAxis;
    readonly sectionOffset: number;
    readonly sectionRange: Readonly<SectionRange> | undefined;
  };
  readonly hierarchy: {
    readonly occurrenceCount: number;
    readonly visibleInstances: number;
    readonly selectedCount: number;
  };
  readonly overlays: {
    readonly diagnostics: boolean;
  };
}

export interface WorkbenchResultField {
  readonly id: string;
  readonly name: string;
  readonly location: "nodal" | "elemental";
}

export interface WorkbenchVectorField {
  readonly id: string;
  readonly name: string;
}

export interface SectionRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export interface WorkbenchSnapshotInput {
  readonly model: WorkbenchModel;
  readonly models: readonly WorkbenchModel[];
  readonly runtime: SceneRuntime;
  readonly interaction: InteractionState;
  readonly rendererName: string;
  readonly rendererState: string;
  readonly cameraMode: Camera["mode"];
  readonly background: ViewportBackground;
  readonly toggles: Readonly<DisplayToggles>;
  readonly continuous: boolean;
  readonly selectionGranularity: SelectionGranularity;
  readonly resultMode: ResultDisplayMode;
  readonly deformationScale: number;
  readonly vectorDisplay: VectorDisplayState;
  readonly sectionAxis: SectionAxis;
  readonly sectionOffset: number;
}

export interface WorkbenchSnapshotOwner {
  readonly model: WorkbenchModel;
  readonly models: readonly WorkbenchModel[];
  readonly runtime: SceneRuntime;
  readonly interaction: InteractionState;
  readonly rendererName: string;
  readonly rendererState: string;
  readonly background: ViewportBackground;
  readonly toggles: Readonly<DisplayToggles>;
  readonly continuousEnabled: boolean;
  readonly selectionGranularity: SelectionGranularity;
  readonly resultMode: ResultDisplayMode;
  readonly deformationScale: number;
  readonly vectorDisplay: VectorDisplayState;
  readonly sectionAxis: SectionAxis;
  readonly sectionOffset: number;
  activeViewport(): { readonly camera: Pick<Camera, "mode"> };
}

/** Commands exposed to a future presentation shell; each delegates to one existing owner. */
export interface WorkbenchCommands {
  setProjection(): void;
  setBackground(value: string): void;
  toggleEdges(): void;
  toggleNodes(): void;
  toggleContinuous(): void;
  setSelectionGranularity(value: string): void;
  setDeformationField(id: string): void;
  setDeformationScale(value: string): void;
  setVectorField(id: string): void;
  setVectorGlyph(value: string): void;
  setVectorTransform(value: string): void;
  setVectorLengthScale(value: string): void;
  fitView(): void;
  hideSelected(): void;
  showAll(): void;
  reset(): void;
  selectModel(id: string): void;
  setResultField(id: string): void;
  setSectionAxis(axis: SectionAxis): void;
  setSectionOffset(value: string): void;
  toggleVisibility(target: VisibilityRowTarget): void;
}

export type WorkbenchSnapshotListener = (snapshot: WorkbenchSnapshot) => void;

/** Owns one workbench snapshot stream without creating a second mutable state owner. */
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

/** Adapts the controller's existing state owner to the bounded snapshot input. */
export function snapshotInputFromOwner(owner: WorkbenchSnapshotOwner): WorkbenchSnapshotInput {
  return {
    model: owner.model,
    models: owner.models,
    runtime: owner.runtime,
    interaction: owner.interaction,
    rendererName: owner.rendererName,
    rendererState: owner.rendererState,
    cameraMode: owner.activeViewport().camera.mode,
    background: owner.background,
    toggles: owner.toggles,
    continuous: owner.continuousEnabled,
    selectionGranularity: owner.selectionGranularity,
    resultMode: owner.resultMode,
    deformationScale: owner.deformationScale,
    vectorDisplay: owner.vectorDisplay,
    sectionAxis: owner.sectionAxis,
    sectionOffset: owner.sectionOffset,
  };
}

/** Builds a bounded immutable presentation snapshot without exposing runtime or GPU storage. */
export function createWorkbenchSnapshot(input: WorkbenchSnapshotInput): WorkbenchSnapshot {
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
  const analysis = createAnalysisSnapshot(input);
  return Object.freeze({
    model: Object.freeze({ active, available, partCount: input.model.scene.parts.size }),
    toolbar: Object.freeze({
      rendererName: input.rendererName,
      rendererState: input.rendererState,
      projection: input.cameraMode,
      background: input.background,
      edges: input.toggles.edges,
      nodes: input.toggles.nodes,
      continuous: input.continuous,
      selectionGranularity: input.selectionGranularity,
    }),
    analysis,
    hierarchy: Object.freeze({
      occurrenceCount: input.runtime.occurrenceCount,
      visibleInstances: input.runtime.visibleCount,
      selectedCount: selectedTargetCount(input.interaction),
    }),
    overlays: Object.freeze({ diagnostics: input.toggles.diagnostics }),
  });
}

function createAnalysisSnapshot(input: WorkbenchSnapshotInput): WorkbenchSnapshot["analysis"] {
  const results = input.model.results;
  const scalar = results?.scalar?.field;
  const deformation = results?.deformation?.field;
  const scalarFields = scalar === undefined ? [] : [resultField(scalar)];
  const deformationFields = deformation === undefined ? [] : [resultField(deformation)];
  const vectorFields = resultVectorFieldsForModel(input.model).map((field) =>
    Object.freeze({ id: field.id, name: field.name }),
  );
  const resultControlsVisible =
    scalar !== undefined || deformation !== undefined || vectorFields.length > 0;
  const vectorFieldId = vectorFields.some((field) => field.id === input.vectorDisplay.fieldId)
    ? input.vectorDisplay.fieldId
    : VECTOR_OFF_VALUE;
  const vectorControlsDisabled = vectorFieldId === VECTOR_OFF_VALUE;
  return Object.freeze({
    resultControlsVisible,
    resultMode: input.resultMode,
    scalarFields: Object.freeze(scalarFields),
    scalarFieldId:
      input.resultMode === "base" || scalar === undefined ? BASE_RESULT_VALUE : scalar.id,
    deformationFields: Object.freeze(deformationFields),
    deformationFieldId:
      input.resultMode === "deformed" && deformation !== undefined
        ? deformation.id
        : DEFORMATION_OFF_VALUE,
    deformationDisabled: input.resultMode === "base" || deformation === undefined,
    deformationScale: input.deformationScale,
    vector: Object.freeze({ ...input.vectorDisplay, fieldId: vectorFieldId }),
    vectorFields: Object.freeze(vectorFields),
    vectorControlsDisabled,
    sectionAxis: input.sectionAxis,
    sectionOffset: input.sectionOffset,
    sectionRange: sectionRange(input.model.bounds, input.sectionAxis),
  });
}

function resultField(field: {
  readonly id: string;
  readonly name: string;
  readonly location: "nodal" | "elemental";
}): WorkbenchResultField {
  return Object.freeze({ id: field.id, name: field.name, location: field.location });
}

function sectionRange(
  bounds: WorkbenchModel["bounds"],
  axis: SectionAxis,
): Readonly<SectionRange> | undefined {
  if (axis === "off") return undefined;
  const range = sectionAxisBounds(bounds, axis);
  return Object.freeze({
    min: range.min,
    max: range.max,
    step: Math.max((range.max - range.min) / 200, 1e-6),
  });
}

function selectedTargetCount(interaction: InteractionState): number {
  return selectedTargets(interaction).length;
}
