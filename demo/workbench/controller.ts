import {
  setTargetsHighlighted,
  importGlb,
  type InteractionState,
  type FemViewport,
  type InteractionTarget,
  type SceneRuntime,
  type ViewportBackground,
} from "../../src/index";
import type { DemoView } from "./view";
import { createModelInteraction } from "./preset";
import { errorMessage, setModelFeedback, type WorkbenchModel } from "./model";
import type { VisibilityRowTarget } from "./tree-hover";
import type { WorkbenchFeatures } from "./features";
import type { WorkbenchInteraction } from "./interaction";
import type { SelectionGranularity } from "./pick";
import {
  createDefaultDisplayToggles,
  type DisplayToggles,
  type ResultDisplayMode,
  type WorkbenchOptions,
} from "./types";
import type { ViewportSlotId } from "./view";
import { type WorkbenchViewportSlots, type WorkbenchViewportSlot } from "./viewport-slots";
import { WorkbenchModelSession } from "./model-session";
import { activateModelForOwner } from "./model-activation";
import { applyDisplayState, applyResultState } from "./display-state";
import {
  syncViewportPresentation,
  viewportPresentationChanged,
  type ObservedPaneSize,
} from "./viewport-presentation";
import {
  parseDeformationScale,
  resultModeForDeformationSelection,
  resultModeForModel,
  resultModeForScalarSelection,
} from "./result-controls";
import { createControllerInfrastructure, installControllerLifecycle } from "./controller-wiring";
import { parseSelectionGranularity, parseViewportBackground } from "./workbench-values";
import { setTreeHover } from "./tree-hover-actions";
import { applySectionPlane, setSectionAxis, setSectionOffset } from "./section-plane-actions";
import type { SectionAxis } from "./section-controls";

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
  treeHoverTargets: readonly InteractionTarget[] = [];
  private disposed = false;
  continuousEnabled = false;
  deformationScale: number;
  sectionAxis: SectionAxis = "off";
  sectionOffset = 0;
  selectionGranularity: SelectionGranularity = "element";
  background: ViewportBackground = "studio";
  private readonly observedPaneSizes = new Map<ViewportSlotId, ObservedPaneSize>();

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
    this.deformationScale = this.model.results?.deformation?.scale ?? 1;
    this.interaction = createModelInteraction(this.model, true, true);
    this.initializeInfrastructure(options);
    this.modelSession = new WorkbenchModelSession({
      view: this.view,
      examples: this.examples,
      importer: options.importGlb ?? importGlb,
      getModel: () => this.model,
      isDisposed: () => this.disposed,
      activate: (model) => {
        this.activateModel(model);
      },
    });
    this.initializePresentation();
    this.installLifecycle();
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
    this.presentation.reflectBackground(this.background);
    this.presentation.reflectSelectionGranularity();
    this.presentation.populateModelSelect(this.models);
    this.visibilityPanel.rebuild();
  }

  private installLifecycle(): void {
    this.boxSelectionDisposer = installControllerLifecycle(this);
  }

  get runtime(): SceneRuntime {
    return this.activeViewport().runtime;
  }

  getBoxSelectionStats(): ReturnType<WorkbenchInteraction["getBoxSelectionStats"]> {
    return this.interactionController.getBoxSelectionStats();
  }

  setViewport(viewport: FemViewport): void {
    this.viewportSlots.invalidateInteraction();
    this.viewport = viewport;
    this.viewportSlots.setPrimaryViewport(viewport);
    try {
      viewport.setBackground(this.background);
    } catch (error) {
      setModelFeedback(
        this.view,
        `Background could not be restored: ${errorMessage(error)}`,
        "error",
      );
    }
    this.treeHoverTargets = [];
    this.canvas.dataset["treeHover"] = "";
    this.applyResultMode(false);
    this.applyCurrentDisplayState();
    applySectionPlane(this, false);
    this.visibilityPanel.rebuild();
    this.render();
  }

  /** Invalidates picks before a temporary renderer teardown. */
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
    syncViewportPresentation({
      activeSlot: this.viewportSlots.activeSlot(),
      slots: this.viewportSlots.all(),
      presentation: this.presentation,
      rendererState: this.rendererState,
      model: this.model,
      interaction: this.interaction,
      toggles: this.toggles,
      continuous: this.continuousEnabled,
      selectionGranularity: this.selectionGranularity,
      resultMode: this.resultMode,
      sectionAxis: this.sectionAxis,
      sectionOffset: this.sectionOffset,
      background: this.background,
    });
  }

  onViewportRender(slotId: ViewportSlotId, timestamp: number): void {
    const slot = this.viewportSlots.get(slotId);
    if (slot === undefined) return;
    if (viewportPresentationChanged(slot, this.observedPaneSizes)) slot.renderLoop.reset(timestamp);
    const publish = this.viewportSlots.onRender(slotId, timestamp);
    if (!this.continuousEnabled || publish) {
      this.syncViewportPresentation();
    }
  }

  setContinuous(enabled = !this.continuousEnabled): void {
    if (this.continuousEnabled === enabled) return;
    this.continuousEnabled = enabled;
    this.viewportSlots.setContinuous(enabled, performance.now());
    this.presentation.reflectContinuous();
    this.syncViewportPresentation();
  }

  setSelectionGranularity(value: string): void {
    const granularity = parseSelectionGranularity(value);
    if (granularity === undefined) {
      this.presentation.reflectSelectionGranularity();
      return;
    }
    if (this.selectionGranularity === granularity) return;
    this.selectionGranularity = granularity;
    for (const slot of this.viewportSlots.all()) slot.interaction.clearHover();
    this.presentation.reflectSelectionGranularity();
    this.render();
  }

  setBackground(value: string): void {
    const background = parseViewportBackground(value);
    if (background === undefined) {
      this.presentation.reflectBackground(this.background);
      return;
    }
    try {
      for (const viewport of this.viewports()) viewport.setBackground(background);
    } catch (error) {
      this.presentation.reflectBackground(this.background);
      setModelFeedback(
        this.view,
        `Background could not be changed: ${errorMessage(error)}`,
        "error",
      );
      return;
    }
    this.background = background;
    this.presentation.reflectBackground(background);
    this.render();
  }

  setInteraction(interaction: InteractionState): void {
    this.interaction = interaction;
  }

  setDiagnostics(): void {
    this.toggles.diagnostics = !this.toggles.diagnostics;
    this.syncViewportPresentation();
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
    setModelFeedback(this.view, message, "error");
  }

  onActiveSlotChanged(): void {
    this.syncViewportPresentation();
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

  fitView(): void {
    this.activeViewport().fitView();
    this.render();
  }

  reset(): void {
    this.activateModel(this.model);
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.boxSelectionDisposer?.();
    this.listenerController.abort();
    this.viewportSlots.destroy();
  }

  setResultField(value: string): void {
    const mode = resultModeForScalarSelection(
      value,
      this.model.results,
      this.view.deformationField.value,
    );
    if (mode === undefined) {
      this.presentation.reflectResults();
      return;
    }
    this.resultMode = mode;
    this.applyResultMode(true);
  }

  setDeformationField(value: string): void {
    const mode = resultModeForDeformationSelection(value, this.model.results, this.resultMode);
    if (mode === undefined) {
      this.presentation.reflectResults();
      return;
    }
    this.resultMode = mode;
    this.applyResultMode(true);
  }

  setDeformationScale(value: string): void {
    const scale = parseDeformationScale(value);
    if (scale === undefined) {
      this.presentation.reflectResults();
      return;
    }
    if (this.deformationScale === scale) return;
    this.deformationScale = scale;
    this.applyResultMode(this.resultMode === "deformed");
  }

  setSectionAxis(value: string): void {
    setSectionAxis(this, value);
  }

  setSectionOffset(value: string): void {
    setSectionOffset(this, value);
  }

  applyResultMode(render: boolean): void {
    applyResultState({
      viewports: this.viewports(),
      model: this.model,
      mode: this.resultMode,
      deformationScale: this.deformationScale,
      reflect: () => {
        this.presentation.reflectResults();
      },
    });
    if (render) this.render();
  }

  applyCurrentDisplayState(): void {
    applyDisplayState({
      viewports: this.viewports(),
      model: this.model,
      toggles: this.toggles,
      interaction: this.interaction,
      setInteraction: (interaction) => {
        this.interaction = interaction;
      },
      applyDisplayedInteraction: () => {
        this.applyDisplayedInteraction();
      },
      reflect: () => {
        this.reflectDisplayControls();
      },
    });
  }

  private reflectDisplayControls(): void {
    this.presentation.reflectEdges();
    this.presentation.reflectNodes();
    this.presentation.reflectResults();
    this.presentation.reflectContinuous();
    this.presentation.reflectBackground(this.background);
  }

  setTreeHover(target: VisibilityRowTarget | undefined): void {
    setTreeHover(this, target, () => this.disposed);
  }

  applyDisplayedInteraction(): void {
    const effective = setTargetsHighlighted(this.interaction, this.treeHoverTargets, true);
    for (const viewport of this.viewports()) viewport.setInteraction(effective);
  }

  private activateModel(model: WorkbenchModel): void {
    activateModelForOwner(model, this);
    this.canvas.dataset["treeHover"] = "";
  }

  render(): void {
    if (this.disposed) return;
    this.applyDisplayedInteraction();
    this.syncViewportPresentation();
  }

  activeSlot(): WorkbenchViewportSlot {
    return this.viewportSlots.activeSlot();
  }

  activeViewport(): FemViewport {
    return this.viewportSlots.activeViewport();
  }

  viewports(): readonly FemViewport[] {
    return this.viewportSlots.viewports();
  }

  setActiveSlot(slotId: ViewportSlotId): void {
    this.viewportSlots.setActiveSlot(slotId);
  }

  async toggleSecondaryViewport(): Promise<void> {
    await this.viewportSlots.toggleSecondaryViewport();
  }

  handleSecondaryViewportError(error: unknown): void {
    this.viewportSlots.handleSecondaryViewportError(error);
  }
}
