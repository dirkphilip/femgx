import type { FemViewport, InteractionState, SceneRuntime } from "../../src/index";
import { installWorkbenchLifecycle, type WorkbenchLifecycleOptions } from "./lifecycle";
import type { WorkbenchFeatures } from "./features";
import type { WorkbenchInteraction } from "./interaction";
import type { WorkbenchBoxPreview } from "./box-preview";
import type { WorkbenchMenu } from "./menu";
import type { VisibilityPanelController } from "./visibility-panel";
import type { WorkbenchOptions } from "./types";
import type { DemoView, ViewportSlotId } from "./view";
import type { WorkbenchModel } from "./model";
import type { DisplayToggles, ResultDisplayMode } from "./types";
import type { SelectionGranularity } from "./pick";
import type { WorkbenchViewportSlot } from "./viewport-slots";
import type { VisibilityRowTarget } from "./tree-hover";
import type { SectionAxis } from "./section-controls";
import type { VectorDisplayState } from "./result-controls";
import {
  createWorkbenchInfrastructure,
  type WorkbenchInfrastructure,
} from "./controller-infrastructure";

export interface WorkbenchControllerWiringContext {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly viewport: FemViewport;
  readonly model: WorkbenchModel;
  readonly models: readonly WorkbenchModel[];
  readonly toggles: DisplayToggles;
  readonly resultMode: ResultDisplayMode;
  readonly deformationScale: number;
  readonly vectorDisplay: VectorDisplayState;
  readonly continuousEnabled: boolean;
  readonly selectionGranularity: SelectionGranularity;
  readonly sectionAxis: SectionAxis;
  readonly sectionOffset: number;
  readonly interaction: InteractionState;
  readonly activeViewport: () => FemViewport;
  readonly viewports: () => readonly FemViewport[];
  readonly activeSlot: () => WorkbenchViewportSlot;
  readonly runtime: SceneRuntime;
  readonly setInteraction: (value: InteractionState) => void;
  readonly applyDisplayedInteraction: () => void;
  readonly render: () => void;
  readonly setTreeHover: (target: VisibilityRowTarget | undefined) => void;
  readonly setEdges: () => void;
  readonly setDiagnostics: () => void;
  readonly fitView: () => void;
  readonly reset: () => void;
  readonly applySharedState: () => void;
  readonly rebuildVisibility: () => void;
  readonly feedback: (message: string) => void;
  readonly onActiveSlotChanged: () => void;
  readonly menu: WorkbenchMenu;
  readonly visibilityPanel: VisibilityPanelController;
  readonly visibilityActions: WorkbenchFeatures["visibilityActions"];
  readonly interactionController: WorkbenchInteraction;
  readonly boxPreview: WorkbenchBoxPreview;
  readonly listenerController: AbortController;
  readonly isPointerGestureActive: () => boolean;
  readonly setActiveSlot: (slotId: ViewportSlotId) => void;
  readonly toggleSecondaryViewport: () => void;
  readonly setBackground: (value: string) => void;
  readonly setNodes: () => void;
  readonly setContinuous: () => void;
  readonly setSelectionGranularity: (value: string) => void;
  readonly setResultField: (value: string) => void;
  readonly setDeformationField: (value: string) => void;
  readonly setDeformationScale: (value: string) => void;
  readonly setVectorField: (value: string) => void;
  readonly setVectorGlyph: (value: string) => void;
  readonly setVectorTransform: (value: string) => void;
  readonly setVectorLengthScale: (value: string) => void;
  readonly setSectionAxis: (value: string) => void;
  readonly setSectionOffset: (value: string) => void;
  readonly setModel: (id: string) => void;
  readonly openModel: (file: File) => void;
}

/** Builds the feature graph around one controller state owner. */
export function createControllerInfrastructure(
  context: WorkbenchControllerWiringContext,
  options: WorkbenchOptions,
): WorkbenchInfrastructure {
  return createWorkbenchInfrastructure({
    view: context.view,
    canvas: context.canvas,
    rendererName: context.rendererName,
    viewport: context.viewport,
    createViewport: options.createViewport,
    model: () => context.model,
    activeViewport: context.activeViewport.bind(context),
    viewports: context.viewports.bind(context),
    activeSlot: context.activeSlot.bind(context),
    runtime: () => context.runtime,
    toggles: () => context.toggles,
    resultMode: () => context.resultMode,
    deformationScale: () => context.deformationScale,
    vectorFieldId: () => context.vectorDisplay.fieldId,
    vectorGlyph: () => context.vectorDisplay.glyph,
    vectorTransform: () => context.vectorDisplay.transform,
    vectorLengthScale: () => context.vectorDisplay.lengthScale,
    continuous: () => context.continuousEnabled,
    selectionGranularity: () => context.selectionGranularity,
    sectionAxis: () => context.sectionAxis,
    sectionOffset: () => context.sectionOffset,
    interaction: () => context.interaction,
    setInteraction: context.setInteraction.bind(context),
    applyDisplayedInteraction: context.applyDisplayedInteraction.bind(context),
    render: context.render.bind(context),
    setTreeHover: context.setTreeHover.bind(context),
    setEdges: () => {
      context.setEdges();
    },
    setDiagnostics: () => {
      context.setDiagnostics();
    },
    fitView: () => {
      context.fitView();
    },
    reset: () => {
      context.reset();
    },
    applySharedState: () => {
      context.applySharedState();
    },
    rebuildVisibility: () => {
      context.rebuildVisibility();
    },
    feedback: (message) => {
      context.feedback(message);
    },
    onActiveSlotChanged: () => {
      context.onActiveSlotChanged();
    },
  });
}

/** Installs all long-lived DOM bindings for the controller. */
export function installControllerLifecycle(context: WorkbenchControllerWiringContext): () => void {
  return installWorkbenchLifecycle({
    view: context.view,
    canvas: context.canvas,
    signal: context.listenerController.signal,
    interaction: context.interactionController,
    menu: context.menu,
    visibilityPanel: context.visibilityPanel,
    boxPreview: context.boxPreview,
    dragging: () => context.isPointerGestureActive(),
    setActive: () => {
      context.setActiveSlot("primary");
    },
    toggleViewport: () => {
      context.toggleSecondaryViewport();
    },
    ...lifecycleDisplayBindings(context),
    ...lifecycleModelBindings(context),
  });
}

function lifecycleDisplayBindings(
  context: WorkbenchControllerWiringContext,
): Pick<
  WorkbenchLifecycleOptions,
  | "setResultField"
  | "setDeformationField"
  | "setDeformationScale"
  | "setVectorField"
  | "setVectorGlyph"
  | "setVectorTransform"
  | "setVectorLengthScale"
  | "setSectionAxis"
  | "setSectionOffset"
> {
  return {
    ...lifecycleVectorBindings(context),
    setResultField: (value) => {
      context.setResultField(value);
    },
    setDeformationField: (value) => {
      context.setDeformationField(value);
    },
    setDeformationScale: (value) => {
      context.setDeformationScale(value);
    },
    setSectionAxis: (value) => {
      context.setSectionAxis(value);
    },
    setSectionOffset: (value) => {
      context.setSectionOffset(value);
    },
  };
}

function lifecycleVectorBindings(
  context: WorkbenchControllerWiringContext,
): Pick<
  WorkbenchLifecycleOptions,
  "setVectorField" | "setVectorGlyph" | "setVectorTransform" | "setVectorLengthScale"
> {
  return {
    setVectorField: (value) => {
      context.setVectorField(value);
    },
    setVectorGlyph: (value) => {
      context.setVectorGlyph(value);
    },
    setVectorTransform: (value) => {
      context.setVectorTransform(value);
    },
    setVectorLengthScale: (value) => {
      context.setVectorLengthScale(value);
    },
  };
}

function lifecycleModelBindings(
  context: WorkbenchControllerWiringContext,
): Pick<WorkbenchLifecycleOptions, "setModel" | "openModel"> {
  return {
    setModel: (id) => {
      context.setModel(id);
    },
    openModel: (file) => {
      context.openModel(file);
    },
  };
}
