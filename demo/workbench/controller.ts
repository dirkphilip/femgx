import {
  setProjection,
  importGlb,
  type InteractionState,
  type FemViewport,
  type SceneRuntime,
  type ViewportBackground,
} from "../../src/index";
import type { DemoView } from "./view";
import { createModelInteraction } from "./preset";
import { errorMessage, type WorkbenchModel } from "./model";
import type { WorkbenchFeatures } from "./features";
import type { WorkbenchInteraction } from "./interaction";
import type { SelectionGranularity } from "./pick";
import type { BoxSelectionStrategy } from "./box-selection-resolver";
import {
  applyBoxSelectionResolvers,
  normalizeBoxSelectionStrategyForGranularity,
  setBoxSelectionStrategy as changeBoxSelectionStrategy,
  setTouchInteractionMode as changeTouchInteractionMode,
} from "./controller-box-selection";
import {
  createDefaultDisplayToggles,
  type DisplayToggles,
  type ResultDisplayMode,
  type TouchInteractionMode,
  type WorkbenchOptions,
} from "./types";
import type { ViewportSlotId } from "./view";
import type { WorkbenchViewportSlots, WorkbenchViewportSlot } from "./viewport-slots";
import { WorkbenchModelSession } from "./model-session";
import { activateModelForOwner } from "./model-activation";
import {
  applyControllerDisplayState as applyDisplayStateForOwner,
  applyControllerResultMode as applyResultModeForOwner,
} from "./controller-display";
import type { ObservedPaneSize } from "./viewport-presentation";
import {
  activeScalarFieldIdForModel,
  resultModeForModel,
  vectorDisplayForModel,
  type VectorDisplayState,
} from "./result-controls";
import {
  setVectorField as applyVectorField,
  setVectorGlyph as applyVectorGlyph,
  setVectorLengthScale as applyVectorLength,
  setVectorTransform as applyVectorTransform,
} from "./vector-actions";
import {
  setDeformationField as applyDeformationField,
  setDeformationScale as applyDeformationScale,
  setResultField as applyResultField,
} from "./result-actions";
import { createControllerInfrastructure, installControllerLifecycle } from "./controller-wiring";
import {
  createElementDetailActions,
  type WorkbenchElementDetailActions,
} from "./controller-element-detail";
import {
  createResultPlaybackActions,
  installResultPlaybackVisibility,
  type WorkbenchResultPlaybackActions,
} from "./result-playback";
import { parseSelectionGranularity, parseViewportBackground } from "./workbench-values";
import {
  applySectionPlane,
  setSectionAxis as applySectionAxis,
  setSectionOffset as applySectionOffset,
} from "./section-plane-actions";
import type { SectionAxis } from "./section-controls";
import { selectAll as applySelectAll } from "./select-all";
import {
  WorkbenchSnapshotBridge,
  type WorkbenchCommands,
  type WorkbenchSnapshot,
  type WorkbenchSnapshotListener,
  type WorkbenchElementDetailSnapshot,
  snapshotInputFromOwner,
} from "./snapshot";
import { createWorkbenchCommands } from "./commands";
import {
  resetViewportRenderLoop,
  setControllerViewport,
  syncControllerViewportPresentation,
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

export type { DisplayToggles, RendererStats, ResultDisplayMode, WorkbenchOptions } from "./types";

/** Owns demo presentation state around the canonical FEM viewport. */
export class WorkbenchController {
  readonly canvas: HTMLCanvasElement;
  readonly view: DemoView;
  readonly rendererName: string;
  model: WorkbenchModel;
  toggles: DisplayToggles;
  resultMode: ResultDisplayMode;
  interaction: InteractionState;
  rendererState = "";
  viewport: FemViewport;
  viewportSlots!: WorkbenchViewportSlots;
  private readonly modelSession: WorkbenchModelSession;
  readonly examples: readonly WorkbenchModel[];
  models: readonly WorkbenchModel[];
  readonly listenerController = new AbortController();
  menu!: WorkbenchFeatures["menu"];
  visibilityPanel!: WorkbenchFeatures["visibilityPanel"];
  visibilityActions!: WorkbenchFeatures["visibilityActions"];
  interactionController!: WorkbenchFeatures["interactionController"];
  presentation!: WorkbenchFeatures["presentation"];
  boxPreview!: WorkbenchFeatures["boxPreview"];
  private boxSelectionDisposer: (() => void) | undefined;
  hoverOwner: WorkbenchHoverOwner | undefined;
  disposed = false;
  continuousEnabled = false;
  deformationScale: number;
  vectorDisplay: VectorDisplayState;
  sectionAxis: SectionAxis = "off";
  sectionOffset = 0;
  selectionGranularity: SelectionGranularity = "element";
  boxSelectionStrategy: BoxSelectionStrategy = "visible-surface";
  touchInteractionMode: TouchInteractionMode = "navigate";
  elementDetail: WorkbenchElementDetailSnapshot | undefined;
  scalarFieldId: string;
  background: ViewportBackground = "studio";
  readonly observedPaneSizes = new Map<ViewportSlotId, ObservedPaneSize>();
  private readonly snapshotBridge: WorkbenchSnapshotBridge;
  private readonly commandSurface: WorkbenchCommands;
  readonly elementDetailActions: WorkbenchElementDetailActions;
  readonly resultPlaybackActions: WorkbenchResultPlaybackActions;
  resultPlaybackIndex = 0;
  resultPlaybackRate = 1;
  resultPlaybackPlaying = false;
  resultPlaybackActive = false;
  resultPlaybackTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

  constructor(options: WorkbenchOptions) {
    this.view = options.view;
    this.canvas = options.canvas;
    this.rendererName = options.rendererName;
    this.viewport = options.viewport;
    this.examples = options.presets;
    const initialModel = this.examples[0];
    if (initialModel === undefined) throw new Error("Workbench requires at least one preset");
    this.models = this.examples;
    this.model = initialModel;
    this.toggles = createDefaultDisplayToggles();
    this.resultMode = resultModeForModel(this.model);
    this.scalarFieldId = activeScalarFieldIdForModel(this.model);
    this.deformationScale = this.model.results?.deformation?.scale ?? 1;
    this.vectorDisplay = vectorDisplayForModel(this.model);
    this.interaction = createModelInteraction(this.model, true, true);
    this.snapshotBridge = new WorkbenchSnapshotBridge(() => snapshotInputFromOwner(this));
    this.elementDetailActions = createElementDetailActions(this);
    this.resultPlaybackActions = createResultPlaybackActions(this);
    this.commandSurface = createWorkbenchCommands(this);
    installResultPlaybackVisibility(this.resultPlaybackActions, this.listenerController.signal);
    this.initializeInfrastructure(options);
    this.modelSession = new WorkbenchModelSession({
      presentation: this.presentation,
      examples: this.examples,
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

  get runtime(): SceneRuntime {
    return this.activeViewport().runtime;
  }

  get snapshot(): WorkbenchSnapshot {
    return this.snapshotBridge.current;
  }

  get commands(): WorkbenchCommands {
    return this.commandSurface;
  }

  subscribe(listener: WorkbenchSnapshotListener): () => void {
    return this.snapshotBridge.subscribe(listener);
  }

  getBoxSelectionStats(): ReturnType<WorkbenchInteraction["getBoxSelectionStats"]> {
    return this.interactionController.getBoxSelectionStats();
  }

  setViewport(viewport: FemViewport): void {
    setControllerViewport(this, viewport);
  }

  invalidateInteraction(): void {
    this.viewportSlots.invalidateInteraction();
  }

  detachViewport(): void {
    this.viewportSlots.detachPrimary();
  }

  setCameraGestureActive(slotId: ViewportSlotId, active: boolean): void {
    this.viewportSlots.setCameraGestureActive(slotId, active);
  }

  isPointerGestureActive(): boolean {
    return this.viewportSlots.isPointerGestureActive();
  }

  syncViewportPresentation(): void {
    if (this.disposed) return;
    syncControllerViewportPresentation(this);
  }

  onViewportRender(slotId: ViewportSlotId, timestamp: number): void {
    const slot = this.viewportSlots.get(slotId);
    if (slot === undefined) return;
    resetViewportRenderLoop(slot, timestamp, this.observedPaneSizes);
    const publish = this.viewportSlots.onRender(slotId, timestamp);
    if (!this.continuousEnabled || publish) {
      this.syncViewportPresentation();
    }
  }

  setContinuous(enabled = !this.continuousEnabled): void {
    if (this.continuousEnabled === enabled) return;
    this.continuousEnabled = enabled;
    this.viewportSlots.setContinuous(enabled, performance.now());
    this.syncViewportPresentation();
    this.publishSnapshot();
  }

  setProjection(): void {
    const viewport = this.activeViewport();
    viewport.setCamera(
      setProjection(
        viewport.camera,
        viewport.camera.mode === "perspective" ? "orthographic" : "perspective",
      ),
    );
    viewport.fitView();
    this.render();
  }

  hideSelected(): void {
    this.visibilityActions.hideSelected();
  }

  selectAll = applySelectAll.bind(null, this);

  showAll(): void {
    this.visibilityActions.showAll();
  }

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

  setBackground(value: string): void {
    const background = parseViewportBackground(value);
    if (background === undefined) {
      return;
    }
    try {
      for (const viewport of this.viewports()) viewport.setBackground(background);
    } catch (error) {
      this.presentation.setFeedback(
        `Background could not be changed: ${errorMessage(error)}`,
        "error",
      );
      return;
    }
    this.background = background;
    this.render();
  }

  setInteraction(interaction: InteractionState): void {
    this.interaction = interaction;
    this.publishSnapshot();
  }

  setDiagnostics(): void {
    this.toggles.diagnostics = !this.toggles.diagnostics;
    this.syncViewportPresentation();
    this.publishSnapshot();
  }

  applySharedState(): void {
    this.applyResultMode(false);
    this.applyCurrentDisplayState();
    applySectionPlane(this, false);
  }

  rebuildVisibility(): void {
    this.visibilityPanel.rebuild();
  }

  feedback(message: string): void {
    this.presentation.setFeedback(message, "error");
  }

  onActiveSlotChanged(): void {
    this.syncViewportPresentation();
    this.publishSnapshot();
  }

  setModel(id: string): void {
    this.modelSession.setModel(id);
  }

  async openModel(file: File): Promise<void> {
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

  fitSelection(): void {
    this.activeViewport().fitSelection();
    this.render();
  }

  reset(): void {
    this.touchInteractionMode = "navigate";
    this.activateModel(this.model);
  }

  destroy(): void {
    if (this.disposed) return;
    this.resultPlaybackActions.stop();
    this.disposed = true;
    this.boxSelectionDisposer?.();
    this.listenerController.abort();
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
    activateModelForOwner(model, this);
  }

  render(): void {
    if (this.disposed) return;
    this.applyDisplayedInteraction();
    this.syncViewportPresentation();
    this.publishSnapshot();
  }

  publishSnapshot(): void {
    this.snapshotBridge.publish();
  }

  activeSlot = (): WorkbenchViewportSlot => this.viewportSlots.activeSlot();

  activeViewport(): FemViewport {
    return this.viewportSlots.activeViewport();
  }

  viewports = (): readonly FemViewport[] => this.viewportSlots.viewports();

  setActiveSlot = (slotId: ViewportSlotId): void => {
    this.viewportSlots.setActiveSlot(slotId);
  };

  async toggleSecondaryViewport(): Promise<void> {
    await this.viewportSlots.toggleSecondaryViewport();
    applyBoxSelectionResolvers(this);
  }
}
