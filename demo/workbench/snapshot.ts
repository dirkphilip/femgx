import { selectedTargets } from "../../src/index";
import type { Camera, InteractionState, SceneRuntime, ViewportBackground } from "../../src/index";
import type { WorkbenchModel } from "./model";
import type { SelectionGranularity } from "./pick";
import type { ResultDisplayMode, DisplayToggles } from "./types";
import type { SectionAxis } from "./section-controls";
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
    readonly resultMode: ResultDisplayMode;
    readonly deformationScale: number;
    readonly vector: Readonly<VectorDisplayState>;
    readonly sectionAxis: SectionAxis;
    readonly sectionOffset: number;
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
  fitView(): void;
  hideSelected(): void;
  showAll(): void;
  reset(): void;
  selectModel(id: string): void;
  setResultField(id: string): void;
  setSectionAxis(axis: SectionAxis): void;
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
    analysis: Object.freeze({
      resultMode: input.resultMode,
      deformationScale: input.deformationScale,
      vector: Object.freeze({ ...input.vectorDisplay }),
      sectionAxis: input.sectionAxis,
      sectionOffset: input.sectionOffset,
    }),
    hierarchy: Object.freeze({
      occurrenceCount: input.runtime.occurrenceCount,
      visibleInstances: input.runtime.visibleCount,
      selectedCount: selectedTargetCount(input.interaction),
    }),
    overlays: Object.freeze({ diagnostics: input.toggles.diagnostics }),
  });
}

function selectedTargetCount(interaction: InteractionState): number {
  return selectedTargets(interaction).length;
}
