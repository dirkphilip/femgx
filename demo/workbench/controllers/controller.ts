import { type Viewport, type ViewportBackground } from "../../../src/entries/root";
import { type InteractionState } from "../../../src/entries/interaction";
import { importGlb } from "../../../src/entries/io/glb";
import type { SceneOccurrences } from "../../../src/entries/root";
import type { DemoView } from "../viewport/view";
import type { WorkbenchModel } from "../models/model";
import type { WorkbenchModelCatalog, WorkbenchCatalogMode } from "../models/model-catalog";
import {
  createWorkbenchModelCatalog,
  rememberCatalogModel,
  setCatalogModeForOwner,
  setModelForOwner,
} from "./controller-catalog";
import type { WorkbenchFeatures } from "../state/features";
import type { SelectionGranularity } from "../selection/pick";
import type { BoxSelectionStrategy } from "../selection/box-selection-resolver";
import {
  applyBoxSelectionResolvers,
  normalizeBoxSelectionStrategyForGranularity,
  setBoxSelectionStrategy as changeBoxSelectionStrategy,
  setTouchInteractionMode as changeTouchInteractionMode,
} from "./controller-box-selection";
import type {
  DisplayToggles,
  ResultDisplayMode,
  TouchInteractionMode,
  WorkbenchOptions,
} from "../types";
import type { ViewportSlotId } from "../viewport/view";
import type { WorkbenchViewportSlots, WorkbenchViewportSlot } from "../viewport/viewport-slots";
import { WorkbenchModelSession } from "../models/model-session";
import { activateModelForOwner } from "../models/model-activation";
import {
  createWorkbenchShowState,
  installWorkbenchShowStateAccessors,
  cloneShowStateForSlot,
  clearResultPlaybackTimers,
  removeShowStateForSlot,
  resetShowStatesForModel,
  setInspectionForSlot,
  showStateForSlot,
  type WorkbenchShowState,
} from "../state/show-state";
import {
  applyControllerDisplayState as applyDisplayStateForOwner,
  applyControllerResultMode as applyResultModeForOwner,
  applyControllerResultModeForSlot,
  applyActiveStateForOwner,
  applyStateForOwner,
  setBackgroundForOwner,
  setContinuousForOwner,
  setDiagnosticsForOwner,
} from "./controller-display";
import type { ObservedPaneSize } from "../viewport/viewport-presentation";
import type { VectorDisplayState } from "../results/result-controls";
import {
  setVectorField as applyVectorField,
  setVectorGlyph as applyVectorGlyph,
  setVectorLengthScale as applyVectorLength,
  setVectorTransform as applyVectorTransform,
} from "../results/vector-actions";
import {
  setDeformationField as applyDeformationField,
  setDeformationScale as applyDeformationScale,
  setResultField as applyResultField,
} from "../results/result-actions";
import { createControllerInfrastructure, installControllerLifecycle } from "./controller-wiring";
import {
  createElementDetailActions,
  type WorkbenchElementDetailActions,
} from "./controller-element-detail";
import {
  createResultPlaybackActions,
  installResultPlaybackVisibility,
  type WorkbenchResultPlaybackActions,
} from "../results/result-playback";
import { parseSelectionGranularity } from "../state/workbench-values";
import {
  applySectionPlane,
  setSectionAxis as applySectionAxis,
  setSectionOffset as applySectionOffset,
} from "../section-plane-actions";
import type { SectionAxis } from "../section-controls";
import { selectAll as applySelectAll } from "../selection/select-all";
import {
  WorkbenchSnapshotBridge,
  type WorkbenchCommands,
  type WorkbenchSnapshot,
  type WorkbenchSnapshotListener,
  type WorkbenchElementDetailSnapshot,
  snapshotInputFromOwner,
} from "../results/snapshot";
import { createWorkbenchCommands } from "../interaction/commands";
import {
  activeSlotChangedForController,
  activeViewportForOwner,
  boxSelectionStatsForOwner,
  detachViewportForOwner,
  invalidateInteractionForOwner,
  isPointerGestureActiveForOwner,
  publishSnapshotForOwner,
  renderForOwner,
  resetViewportRenderLoop,
  setControllerViewport,
  setActiveSlotForOwner,
  setCameraGestureActiveForOwner,
  setProjectionForOwner,
  fitSelectionForOwner,
  hideSelectedForOwner,
  showAllForOwner,
  syncControllerViewportPresentation,
  toggleSecondaryViewportForOwner,
} from "./controller-viewport";
import {
  applyDisplayedInteraction as applyDisplayedInteractionForOwner,
  canClearCanvasHover as canClearCanvasHoverForOwner,
  clearCanvasHover as clearCanvasHoverForOwner,
  clearHierarchyHover as clearHierarchyHoverForOwner,
  clearTransientHover,
  markCanvasHover as markCanvasHoverForOwner,
  resetHoverOwner as resetHoverOwnerForOwner,
  setHierarchyHover as setHierarchyHoverForOwner,
  type WorkbenchHoverOwner,
} from "./controller-hover";

export type { DisplayToggles, RendererStats, ResultDisplayMode, WorkbenchOptions } from "../types";

/** Owns demo presentation state around the canonical FEM viewport. */
export class WorkbenchController {
  readonly canvas: HTMLCanvasElement;
  readonly view: DemoView;
  readonly rendererName: string;
  model: WorkbenchModel;
  rendererState = "";
  viewport: Viewport;
  viewportSlots!: WorkbenchViewportSlots;
  readonly modelSession: WorkbenchModelSession;
  readonly examples: readonly WorkbenchModel[];
  readonly catalog: WorkbenchModelCatalog;
  models: readonly WorkbenchModel[];
  readonly listenerController = new AbortController();
  menu!: WorkbenchFeatures["menu"];
  visibilityPanel!: WorkbenchFeatures["visibilityPanel"];
  visibilityActions!: WorkbenchFeatures["visibilityActions"];
  interactionController!: WorkbenchFeatures["interactionController"];
  presentation!: WorkbenchFeatures["presentation"];
  boxPreview!: WorkbenchFeatures["boxPreview"];
  private boxSelectionDisposer: (() => void) | undefined;
  disposed = false;
  readonly observedPaneSizes = new Map<ViewportSlotId, ObservedPaneSize>();
  readonly snapshotBridge: WorkbenchSnapshotBridge;
  private readonly commandSurface: WorkbenchCommands;
  readonly elementDetailActions: WorkbenchElementDetailActions;
  readonly resultPlaybackActions: WorkbenchResultPlaybackActions;
  private readonly showStates = new Map<ViewportSlotId, WorkbenchShowState>();
  private readonly hoverOwners = new Map<ViewportSlotId, WorkbenchHoverOwner | undefined>();
  private activeSlotId: ViewportSlotId = "primary";
  declare toggles: DisplayToggles;
  declare resultMode: ResultDisplayMode;
  declare interaction: InteractionState;
  declare hoverOwner: WorkbenchHoverOwner | undefined;
  declare continuousEnabled: boolean;
  declare deformationScale: number;
  declare vectorDisplay: VectorDisplayState;
  declare sectionAxis: SectionAxis;
  declare sectionOffset: number;
  declare selectionGranularity: SelectionGranularity;
  declare boxSelectionStrategy: BoxSelectionStrategy;
  declare touchInteractionMode: TouchInteractionMode;
  declare elementDetail: WorkbenchElementDetailSnapshot | undefined;
  declare scalarFieldId: string;
  declare background: ViewportBackground;
  declare inspection: { visible: boolean; text: string };

  constructor(options: WorkbenchOptions) {
    this.view = options.view;
    this.canvas = options.canvas;
    this.rendererName = options.rendererName;
    this.viewport = options.viewport;
    this.examples = options.presets;
    const initialModel = this.examples[0];
    if (initialModel === undefined) throw new Error("Workbench requires at least one preset");
    this.catalog = createWorkbenchModelCatalog(this.examples);
    this.models = this.catalog.models;
    this.model = initialModel;
    this.showStates.set("primary", createWorkbenchShowState(this.model));
    installWorkbenchShowStateAccessors(
      this,
      this.showStates,
      this.hoverOwners,
      () => this.activeSlotId,
    );
    this.snapshotBridge = new WorkbenchSnapshotBridge(() => snapshotInputFromOwner(this));
    this.elementDetailActions = createElementDetailActions(this);
    this.initializeInfrastructure(options);
    this.resultPlaybackActions = createResultPlaybackActions(this);
    this.commandSurface = createWorkbenchCommands(this);
    installResultPlaybackVisibility(this.resultPlaybackActions, this.listenerController.signal);
    this.modelSession = new WorkbenchModelSession({
      presentation: this.presentation,
      resolveModel: (id) => this.catalog.resolveModel(id),
      importer: options.importGlb ?? importGlb,
      getModel: () => this.model,
      isDisposed: () => this.disposed,
      activate: (model) => {
        this.activateModel(model);
      },
    });
    this.initializePresentation();
    this.boxSelectionDisposer = installControllerLifecycle(this);
    this.canvas.dataset["model"] = this.model.id;
    this.canvas.dataset["dragging"] = "false";
    this.render();
  }

  private initializeInfrastructure(options: WorkbenchOptions): void {
    const infrastructure = createControllerInfrastructure(this, options);
    this.viewportSlots = infrastructure.viewportSlots;
    const features = infrastructure.features;
    this.menu = features.menu;
    this.visibilityPanel = features.visibilityPanel;
    this.visibilityActions = features.visibilityActions;
    this.interactionController = features.interactionController;
    this.presentation = features.presentation;
    this.boxPreview = features.boxPreview;
  }

  private initializePresentation(): void {
    this.applyResultMode(false);
    this.applyCurrentDisplayState();
    applySectionPlane(this, false);
    this.visibilityPanel.rebuild();
  }

  get runtime(): SceneOccurrences {
    return this.activeViewport().occurrences;
  }

  showState = showStateForSlot.bind(null, this.showStates);

  interactionForSlot = (slotId: ViewportSlotId): InteractionState =>
    this.showState(slotId).interaction;

  setInteractionForSlot = (slotId: ViewportSlotId, value: InteractionState): void => {
    this.showState(slotId).interaction = value;
  };

  selectionGranularityForSlot = (slotId: ViewportSlotId): SelectionGranularity =>
    this.showState(slotId).selectionGranularity;

  touchInteractionModeForSlot = (slotId: ViewportSlotId): TouchInteractionMode =>
    this.showState(slotId).touchInteractionMode;

  hoverOwnerForSlot = (slotId: ViewportSlotId): WorkbenchHoverOwner | undefined =>
    this.hoverOwners.get(slotId);

  setHoverOwnerForSlot = (slotId: ViewportSlotId, value: WorkbenchHoverOwner | undefined): void => {
    this.hoverOwners.set(slotId, value);
  };

  cloneShowState = (from: ViewportSlotId, to: ViewportSlotId) =>
    cloneShowStateForSlot(this.showStates, this.hoverOwners, from, to);

  removeShowState = (slotId: ViewportSlotId) =>
    removeShowStateForSlot(this.showStates, this.hoverOwners, slotId);

  resetShowStates = (model: WorkbenchModel) =>
    resetShowStatesForModel(this.showStates, this.hoverOwners, model);

  getInspection = (): { readonly visible: boolean; readonly text: string } => this.inspection;

  setInspection = (value: { readonly visible: boolean; readonly text: string }): void => {
    this.inspection = value;
  };

  setInspectionForSlot = (
    slotId: ViewportSlotId,
    value: { readonly visible: boolean; readonly text: string },
  ) =>
    setInspectionForSlot(this.showStates, this.activeSlotId, slotId, value, this.publishSnapshot);

  get snapshot(): WorkbenchSnapshot {
    return this.snapshotBridge.current;
  }

  get commands(): WorkbenchCommands {
    return this.commandSurface;
  }

  get catalogMode(): WorkbenchCatalogMode {
    return this.catalog.mode;
  }

  get catalogSelectionId(): string {
    return this.catalog.selectedId;
  }

  subscribe(listener: WorkbenchSnapshotListener): () => void {
    return this.snapshotBridge.subscribe(listener);
  }

  getBoxSelectionStats = boxSelectionStatsForOwner.bind(null, this);

  setViewport = setControllerViewport.bind(null, this);

  invalidateInteraction = invalidateInteractionForOwner.bind(null, this);

  detachViewport = detachViewportForOwner.bind(null, this);

  setCameraGestureActive = setCameraGestureActiveForOwner.bind(null, this);

  isPointerGestureActive = isPointerGestureActiveForOwner.bind(null, this);

  syncViewportPresentation: () => void = syncControllerViewportPresentation.bind(null, this);

  onViewportRender(slotId: ViewportSlotId, timestamp: number): void {
    const slot = this.viewportSlots.get(slotId);
    if (slot === undefined) return;
    resetViewportRenderLoop(slot, timestamp, this.observedPaneSizes);
    const publish = this.viewportSlots.onRender(slotId, timestamp);
    if (!this.continuousEnabled || publish) {
      this.syncViewportPresentation();
      if (this.continuousEnabled && !this.disposed) this.publishSnapshot();
    }
  }

  setContinuous = setContinuousForOwner.bind(null, this);

  setProjection = setProjectionForOwner.bind(null, this);

  hideSelected = hideSelectedForOwner.bind(null, this);

  selectAll = applySelectAll.bind(null, this);

  showAll = showAllForOwner.bind(null, this);

  setSelectionGranularity(value: string): void {
    const granularity = parseSelectionGranularity(value);
    if (granularity === undefined || this.selectionGranularity === granularity) return;
    this.selectionGranularity = granularity;
    normalizeBoxSelectionStrategyForGranularity(this);
    applyBoxSelectionResolvers(this);
    clearTransientHover(this);
    this.render();
  }

  setBoxSelectionStrategy = changeBoxSelectionStrategy.bind(null, this);

  setTouchInteractionMode = changeTouchInteractionMode.bind(null, this);

  setBackground = setBackgroundForOwner.bind(null, this);

  setInteraction = (interaction: InteractionState): void => {
    this.interaction = interaction;
    this.publishSnapshot();
  };

  setDiagnostics = setDiagnosticsForOwner.bind(null, this);

  applyActiveState = applyActiveStateForOwner.bind(null, this);

  applyState = applyStateForOwner.bind(null, this);

  rebuildVisibility = (): void => {
    this.visibilityPanel.rebuild();
  };

  feedback = (message: string): void => {
    this.presentation.setFeedback(message, "error");
  };

  onActiveSlotChanged = (slotId: ViewportSlotId): void => {
    activeSlotChangedForController(this, slotId, (active) => {
      this.activeSlotId = active;
    });
  };

  setModel = setModelForOwner.bind(null, this);

  setCatalogMode = setCatalogModeForOwner.bind(null, this);

  async openModel(file: File): Promise<void> {
    if (this.catalog.mode !== "ordinary") this.setCatalogMode("ordinary");
    await this.modelSession.openModel(file);
  }

  setEdges(enabled = !this.toggles.edges): void {
    if (this.toggles.edges === enabled) return;
    this.toggles.edges = enabled;
    this.applyCurrentDisplayState();
    this.render();
  }

  setNodes(enabled = !this.toggles.nodes): void {
    if (this.toggles.nodes === enabled) return;
    this.toggles.nodes = enabled;
    this.applyCurrentDisplayState();
    this.render();
  }

  fitSelection = fitSelectionForOwner.bind(null, this);

  reset(): void {
    this.touchInteractionMode = "navigate";
    this.modelSession.cancel();
    this.activateModel(this.model);
  }

  destroy(): void {
    if (this.disposed) return;
    this.resultPlaybackActions.stop();
    clearResultPlaybackTimers(this.showStates);
    this.modelSession.cancel();
    this.disposed = true;
    this.boxSelectionDisposer?.();
    this.listenerController.abort();
    this.catalog.clearRetainedModel();
    this.viewportSlots.destroy();
  }

  setResultField = applyResultField.bind(null, this);

  setDeformationField = applyDeformationField.bind(null, this);

  setDeformationScale = applyDeformationScale.bind(null, this);

  setVectorField = applyVectorField.bind(null, this);

  setVectorGlyph = applyVectorGlyph.bind(null, this);

  setVectorTransform = applyVectorTransform.bind(null, this);

  setVectorLengthScale = applyVectorLength.bind(null, this);

  setSectionAxis = applySectionAxis.bind(null, this);

  setSectionOffset = applySectionOffset.bind(null, this);

  applyResultMode: (render: boolean) => void = applyResultModeForOwner.bind(null, this);

  applyResultModeForSlot = applyControllerResultModeForSlot.bind(null, this);

  applyCurrentDisplayState: () => void = applyDisplayStateForOwner.bind(null, this);

  setHierarchyHover = setHierarchyHoverForOwner.bind(null, this);

  clearHierarchyHover = clearHierarchyHoverForOwner.bind(null, this);

  applyDisplayedInteraction = applyDisplayedInteractionForOwner.bind(null, this);

  canClearCanvasHover = canClearCanvasHoverForOwner.bind(null, this);

  markCanvasHover = markCanvasHoverForOwner.bind(null, this);

  clearCanvasHover = clearCanvasHoverForOwner.bind(null, this);

  resetHoverOwner = resetHoverOwnerForOwner.bind(null, this);

  private activateModel(model: WorkbenchModel): void {
    this.resultPlaybackActions.resetForModel(model);
    this.elementDetail = undefined;
    this.resetHoverOwner();
    this.resetShowStates(model);
    activateModelForOwner(model, this);
    this.model = rememberCatalogModel(this, model);
  }

  render: () => void = renderForOwner.bind(null, this);

  publishSnapshot: () => void = publishSnapshotForOwner.bind(null, this);

  activeSlot = (): WorkbenchViewportSlot => this.viewportSlots.activeSlot();

  activeViewport: () => Viewport = activeViewportForOwner.bind(null, this);

  viewports = (): readonly Viewport[] => this.viewportSlots.viewports();

  setActiveSlot: (slotId: ViewportSlotId) => void = setActiveSlotForOwner.bind(null, this);

  toggleSecondaryViewport: () => Promise<void> = toggleSecondaryViewportForOwner.bind(null, this);
}
