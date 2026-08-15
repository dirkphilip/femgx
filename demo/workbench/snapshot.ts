import type {
  BodyId,
  Camera,
  ElementId,
  InstanceId,
  InteractionState,
  SceneRuntime,
  ViewportBackground,
} from "../../src/index";
import type { WorkbenchModel } from "./model";
import type { SelectionGranularity } from "./pick";
import type { BoxSelectionStrategy } from "./box-selection-resolver";
import type { SectionAxis } from "./section-controls";
import type { DisplayToggles } from "./types";
import type { ResultDisplayMode } from "./types";
import type { VectorDisplayState } from "./result-controls";
import type { VisibilityRowTarget } from "./visibility-snapshot";
import type { WorkbenchVisibilitySnapshot } from "./visibility-snapshot";
import type { WorkbenchResultLegendSnapshot } from "./result-legend";
import { createWorkbenchSnapshot } from "./snapshot-builder";

export { createWorkbenchSnapshot } from "./snapshot-builder";

export type WorkbenchMenuAction =
  | "highlight"
  | "select"
  | "select-block"
  | "select-element"
  | "hide-element"
  | "hide-instance"
  | "hide-part"
  | "edges"
  | "diagnostics"
  | "fit-selection"
  | "reset"
  | "clear-selection"
  | "show-all";

export interface WorkbenchMenuEntry {
  readonly kind: "section" | "button";
  readonly label: string;
  readonly action?: WorkbenchMenuAction;
  readonly help?: string;
}

export interface WorkbenchContextMenuSnapshot {
  readonly visible: boolean;
  readonly x: number;
  readonly y: number;
  readonly title: string;
  readonly entries: readonly WorkbenchMenuEntry[];
}

export interface WorkbenchPresentationSnapshot {
  readonly loading: boolean;
  readonly modelSelectionDisabled: boolean;
  readonly modelOpenDisabled: boolean;
  readonly feedback: { readonly message: string; readonly kind: "info" | "error" } | undefined;
  readonly rendererStatus: string;
  readonly rendererStatusVisible: boolean;
  readonly status: string;
  readonly statusVisible: boolean;
  readonly inspection: { readonly visible: boolean; readonly text: string };
  readonly diagnostics: { readonly visible: boolean; readonly text: string };
  readonly resultLegend: WorkbenchResultLegendSnapshot;
  readonly contextMenu: WorkbenchContextMenuSnapshot;
}

export interface WorkbenchStartupStatus {
  readonly rendererStatus: string;
  readonly status: string;
}

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
    readonly loading: boolean;
    readonly selectionDisabled: boolean;
    readonly openDisabled: boolean;
  };
  readonly toolbar: {
    readonly rendererName: string;
    readonly rendererState: string;
    readonly projection: Camera["mode"];
    readonly background: ViewportBackground;
    readonly edges: boolean;
    readonly nodes: boolean;
    readonly continuous: boolean;
    readonly fitSelectionAvailable: boolean;
    readonly selectionGranularity: SelectionGranularity;
    readonly boxSelectionStrategy: BoxSelectionStrategy;
    readonly secondaryOpen: boolean;
    readonly secondaryBusy: boolean;
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
    readonly elementDetail: WorkbenchElementDetailSnapshot | undefined;
    readonly visibility: WorkbenchVisibilitySnapshot;
  };
  readonly overlays: {
    readonly diagnostics: boolean;
    readonly rendererStatus: string;
    readonly rendererStatusVisible: boolean;
    readonly status: string;
    readonly statusVisible: boolean;
    readonly feedback: WorkbenchPresentationSnapshot["feedback"];
    readonly inspection: WorkbenchPresentationSnapshot["inspection"];
    readonly diagnosticsText: string;
    readonly resultLegend: WorkbenchPresentationSnapshot["resultLegend"];
    readonly contextMenu: WorkbenchContextMenuSnapshot;
  };
}

/** Bounded metadata for the body-scoped element detail view. */
export interface WorkbenchElementDetailSnapshot {
  readonly instanceId: InstanceId;
  readonly bodyId: BodyId;
  readonly label: string;
  readonly partName: string;
  readonly count: number;
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
  readonly boxSelectionStrategy: BoxSelectionStrategy;
  readonly scalarFieldId: string;
  readonly secondaryOpen: boolean;
  readonly secondaryBusy: boolean;
  readonly resultMode: ResultDisplayMode;
  readonly deformationScale: number;
  readonly vectorDisplay: VectorDisplayState;
  readonly sectionAxis: SectionAxis;
  readonly sectionOffset: number;
  readonly elementDetail?: WorkbenchElementDetailSnapshot;
  readonly presentation?: WorkbenchPresentationSnapshot;
  readonly visibility?: WorkbenchVisibilitySnapshot;
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
  readonly boxSelectionStrategy: BoxSelectionStrategy;
  readonly scalarFieldId: string;
  readonly resultMode: ResultDisplayMode;
  readonly deformationScale: number;
  readonly vectorDisplay: VectorDisplayState;
  readonly sectionAxis: SectionAxis;
  readonly sectionOffset: number;
  readonly elementDetail: WorkbenchElementDetailSnapshot | undefined;
  readonly presentation: { snapshot(): WorkbenchPresentationSnapshot };
  readonly visibilityPanel: { snapshot(): WorkbenchVisibilitySnapshot };
  readonly viewportSlots: {
    isSecondaryVisible(): boolean;
    isSecondaryOpening(): boolean;
  };
  activeViewport(): { readonly camera: Pick<Camera, "mode"> };
}

export interface WorkbenchCommands {
  setProjection(): void;
  setBackground(value: string): void;
  toggleEdges(): void;
  toggleNodes(): void;
  toggleContinuous(): void;
  setSelectionGranularity(value: string): void;
  setBoxSelectionStrategy(value: string): void;
  toggleSecondaryViewport(): void;
  setDeformationField(id: string): void;
  setDeformationScale(value: string): void;
  setVectorField(id: string): void;
  setVectorGlyph(value: string): void;
  setVectorTransform(value: string): void;
  setVectorLengthScale(value: string): void;
  setVectorWidthPixels(value: string): void;
  fitSelection(): void;
  hideSelected(): void;
  showAll(): void;
  reset(): void;
  selectModel(id: string): void;
  openModel(file: File): Promise<void>;
  setResultField(id: string): void;
  setSectionAxis(axis: SectionAxis): void;
  setSectionOffset(value: string): void;
  toggleVisibility(target: VisibilityRowTarget): void;
  toggleVisibilityTree(occurrenceId: string): void;
  toggleBodyHighlight(target: Extract<VisibilityRowTarget, { kind: "body" }>): void;
  toggleBlockHighlight(target: Extract<VisibilityRowTarget, { kind: "block" }>): void;
  openElementDetail(target: Extract<VisibilityRowTarget, { kind: "body" }>): void;
  closeElementDetail(): void;
  selectElementDetail(detail: WorkbenchElementDetailSnapshot, elementId: ElementId): void;
  setElementDetailHover(detail: WorkbenchElementDetailSnapshot, elementId: ElementId): void;
  clearElementDetailHover(detail: WorkbenchElementDetailSnapshot, elementId: ElementId): void;
  setHierarchyHover(target: VisibilityRowTarget): void;
  clearHierarchyHover(target: VisibilityRowTarget): void;
  contextMenuAction(action: WorkbenchMenuAction): void;
  clearContextMenu(): void;
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
    boxSelectionStrategy: owner.boxSelectionStrategy,
    scalarFieldId: owner.scalarFieldId,
    secondaryOpen: owner.viewportSlots.isSecondaryVisible(),
    secondaryBusy: owner.viewportSlots.isSecondaryOpening(),
    resultMode: owner.resultMode,
    deformationScale: owner.deformationScale,
    vectorDisplay: owner.vectorDisplay,
    sectionAxis: owner.sectionAxis,
    sectionOffset: owner.sectionOffset,
    ...(owner.elementDetail === undefined ? {} : { elementDetail: owner.elementDetail }),
    presentation: owner.presentation.snapshot(),
    visibility: owner.visibilityPanel.snapshot(),
  };
}
