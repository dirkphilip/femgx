import {
  setPartOverride,
  setTargetsHighlighted,
  setProjection,
  importGlb,
  type Camera,
  type InteractionState,
  type FemViewport,
  type InteractionTarget,
  type SceneRuntime,
  type ViewportBackground,
} from "../../src/index";
import type { DemoView } from "./view";
import { installWorkbenchLifecycle, installWorkbenchPaneLifecycle } from "./lifecycle";
import { createModelInteraction } from "./preset";
import {
  createImportedModel,
  clearModelFeedback,
  clearModelInspection,
  displayFileName,
  errorMessage,
  importFeedback,
  partStyleOverride,
  setModelFeedback,
  setModelLoading,
  type WorkbenchModel,
} from "./model";
import { applyMenuAction } from "./menu-actions";
import { interactionTargetsForRow, type VisibilityRowTarget } from "./tree-hover";
import { createWorkbenchFeatures, type WorkbenchFeatures } from "./features";
import { WorkbenchRenderLoop } from "./render-loop";
import { WorkbenchInteraction } from "./interaction";
import { WorkbenchBoxPreview } from "./box-preview";
import { cameraSnapshot } from "./presentation";
import { selectedKeys } from "./selection";
import {
  createDefaultDisplayToggles,
  type DisplayToggles,
  type ResultDisplayMode,
  type WorkbenchOptions,
} from "./types";
import type { WorkbenchPane, ViewportSlotId } from "./view";

export type { DisplayToggles, RendererStats, ResultDisplayMode, WorkbenchOptions } from "./types";

interface ViewportSlot {
  readonly id: ViewportSlotId;
  readonly pane: WorkbenchPane;
  readonly interaction: WorkbenchInteraction;
  readonly boxPreview: WorkbenchBoxPreview;
  readonly renderLoop: WorkbenchRenderLoop;
  viewport: FemViewport;
  dragging: boolean;
  removePaneBindings?: () => void;
}

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
  private viewport: FemViewport;
  private readonly createViewport: WorkbenchOptions["createViewport"];
  private readonly slots = new Map<ViewportSlotId, ViewportSlot>();
  private activeSlotId: ViewportSlotId = "primary";
  private readonly examples: readonly WorkbenchModel[];
  private models: readonly WorkbenchModel[];
  private readonly importer: typeof importGlb;
  private readonly listenerController = new AbortController();
  private readonly menu: WorkbenchFeatures["menu"];
  private readonly visibilityPanel: WorkbenchFeatures["visibilityPanel"];
  private readonly visibilityActions: WorkbenchFeatures["visibilityActions"];
  private readonly interactionController: WorkbenchFeatures["interactionController"];
  private readonly presentation: WorkbenchFeatures["presentation"];
  private readonly boxPreview: WorkbenchFeatures["boxPreview"];
  private readonly renderLoop: WorkbenchRenderLoop;
  private boxSelectionDisposer: (() => void) | undefined;
  private treeHoverTargets: readonly InteractionTarget[] = [];
  private disposed = false;
  private continuousEnabled = false;
  private elementSelectionEnabled = true;
  private background: ViewportBackground = "studio";
  private readonly observedPaneSizes = new Map<
    ViewportSlotId,
    {
      readonly size: { readonly width: number; readonly height: number };
      readonly devicePixelRatio: number;
    }
  >();
  private loadGeneration = 0;
  private secondaryGeneration = 0;

  constructor(options: WorkbenchOptions) {
    this.view = options.view;
    this.canvas = options.canvas;
    this.rendererName = options.rendererName;
    this.viewport = options.viewport;
    this.createViewport = options.createViewport;
    this.renderLoop = new WorkbenchRenderLoop(() => this.activeViewport());
    this.examples = options.presets;
    const initialModel = this.examples[0];
    if (initialModel === undefined) throw new Error("Workbench requires at least one preset");
    this.models = this.examples;
    this.model = initialModel;
    this.importer = options.importGlb ?? importGlb;
    this.toggles = createDefaultDisplayToggles();
    this.resultMode = this.model.results === undefined ? "base" : "deformed";
    this.interaction = createModelInteraction(this.model, true, true);
    const features = createWorkbenchFeatures({
      view: this.view,
      canvas: this.canvas,
      rendererName: this.rendererName,
      viewport: () => this.activeViewport(),
      interactionViewport: () => this.slots.get("primary")?.viewport ?? this.viewport,
      viewports: () => this.viewports(),
      runtime: () => this.runtime,
      model: () => this.model,
      presets: this.models,
      toggles: () => this.toggles,
      resultMode: () => this.resultMode,
      continuous: () => this.continuousEnabled,
      elementSelectionEnabled: () => this.elementSelectionEnabled,
      interaction: () => this.interaction,
      setInteraction: (interaction) => {
        this.interaction = interaction;
      },
      applyDisplayedInteraction: () => {
        this.applyDisplayedInteraction();
      },
      render: () => {
        this.render();
      },
      setTreeHover: (target) => {
        this.setTreeHover(target);
      },
      applyMenuAction: (action) => {
        applyMenuAction(action, {
          target: this.activeSlot().interaction.contextTarget,
          interaction: this.activeSlot().interaction,
          visibilityActions: this.visibilityActions,
          toggles: this.toggles,
          setEdges: () => {
            this.setEdges(!this.toggles.edges);
          },
          setDiagnostics: () => {
            this.toggles.diagnostics = !this.toggles.diagnostics;
            this.syncViewportPresentation();
          },
          fitView: () => {
            this.fitView();
          },
          reset: () => {
            this.reset();
          },
        });
        this.activeSlot().interaction.clearContext();
      },
    });
    this.menu = features.menu;
    this.visibilityPanel = features.visibilityPanel;
    this.visibilityActions = features.visibilityActions;
    this.interactionController = features.interactionController;
    this.presentation = features.presentation;
    this.boxPreview = features.boxPreview;
    this.slots.set("primary", {
      id: "primary",
      pane: this.view.primaryPane,
      interaction: this.interactionController,
      boxPreview: this.boxPreview,
      renderLoop: this.renderLoop,
      viewport: this.viewport,
      dragging: false,
    });
    this.applyResultMode(false);
    this.applyCurrentDisplayState();
    this.presentation.reflectBackground(this.background);
    this.presentation.reflectElementSelection();
    this.presentation.populateModelSelect(this.models);
    this.visibilityPanel.rebuild();
    this.boxSelectionDisposer = installWorkbenchLifecycle({
      view: this.view,
      canvas: this.canvas,
      signal: this.listenerController.signal,
      viewport: () => this.activeViewport(),
      interaction: this.interactionController,
      menu: this.menu,
      visibilityPanel: this.visibilityPanel,
      boxPreview: this.boxPreview,
      dragging: () => this.isPointerGestureActive(),
      setActive: () => {
        this.setActiveSlot("primary");
      },
      toggleViewport: () => {
        void this.toggleSecondaryViewport();
      },
      setBackground: (background) => {
        this.setBackground(background);
      },
      setEdges: () => {
        this.setEdges(!this.toggles.edges);
      },
      setNodes: () => {
        this.setNodes(!this.toggles.nodes);
      },
      setContinuous: () => {
        this.setContinuous(!this.continuousEnabled);
      },
      setElementSelection: () => {
        this.setElementSelection(!this.elementSelectionEnabled);
      },
      hideSelected: () => {
        this.visibilityActions.hideSelected();
      },
      showAll: () => {
        this.visibilityActions.showAll();
      },
      setResults: () => {
        this.cycleResultMode();
      },
      reset: () => {
        this.reset();
      },
      fitView: () => {
        this.fitView();
      },
      setModel: (id) => {
        this.setModel(id);
      },
      openGlb: (file) => {
        void this.openGlb(file);
      },
    });
    this.canvas.dataset["model"] = this.model.id;
    this.canvas.dataset["dragging"] = "false";
    this.render();
  }

  get runtime(): SceneRuntime {
    return this.activeViewport().runtime;
  }

  get camera(): Camera {
    return this.activeViewport().camera;
  }

  getBoxSelectionStats(): ReturnType<WorkbenchInteraction["getBoxSelectionStats"]> {
    return this.interactionController.getBoxSelectionStats();
  }

  setViewport(viewport: FemViewport): void {
    for (const slot of this.slots.values()) slot.interaction.clearContext();
    this.viewport = viewport;
    const primary = this.slots.get("primary");
    if (primary !== undefined) primary.viewport = viewport;
    try {
      viewport.setBackground(this.background);
    } catch (error) {
      setModelFeedback(
        this.view,
        `Background could not be restored: ${errorMessage(error)}`,
        "error",
      );
    }
    this.activeSlotId = "primary";
    this.renderLoop.attach(performance.now());
    this.treeHoverTargets = [];
    this.canvas.dataset["treeHover"] = "";
    this.applyResultMode(false);
    this.applyCurrentDisplayState();
    this.visibilityPanel.rebuild();
    this.render();
  }

  /** Invalidates picks before a temporary renderer teardown. */
  invalidateInteraction(): void {
    for (const slot of this.slots.values()) slot.interaction.clearContext();
  }

  detachViewport(): void {
    this.slots.get("primary")?.renderLoop.detach(performance.now());
  }

  setCameraGestureActive(slotId: ViewportSlotId, active: boolean): void {
    const slot = this.slots.get(slotId);
    if (slot === undefined) return;
    slot.dragging = active;
    slot.pane.canvas.dataset["dragging"] = active ? "true" : "false";
  }

  isPointerGestureActive(): boolean {
    const slot = this.activeSlot();
    return slot.dragging || slot.boxPreview.isActive();
  }

  syncViewportPresentation(): void {
    if (this.disposed) return;
    const slot = this.activeSlot();
    const viewportStats = slot.viewport.stats();
    this.presentation.refresh(
      slot.viewport.camera,
      this.rendererState,
      {
        visibleInstances: viewportStats.visibleInstances,
        batches: viewportStats.drawBatches,
      },
      slot.renderLoop.stats,
    );
    for (const candidate of this.slots.values()) this.syncPaneDataset(candidate);
  }

  onViewportRender(slotId: ViewportSlotId, timestamp: number): void {
    const slot = this.slots.get(slotId);
    if (slot === undefined) return;
    if (this.viewportPresentationChanged(slot)) slot.renderLoop.reset(timestamp);
    const publish = slot.renderLoop.frameCompleted(timestamp);
    if (slot.id === this.activeSlotId && (!this.continuousEnabled || publish)) {
      this.syncViewportPresentation();
    }
  }

  setContinuous(enabled: boolean): void {
    if (this.continuousEnabled === enabled) return;
    this.continuousEnabled = enabled;
    for (const slot of this.slots.values()) {
      slot.renderLoop.setEnabled(enabled, performance.now());
    }
    this.presentation.reflectContinuous();
    this.syncViewportPresentation();
  }

  setElementSelection(enabled: boolean): void {
    if (this.elementSelectionEnabled === enabled) return;
    this.elementSelectionEnabled = enabled;
    this.presentation.reflectElementSelection();
    this.syncViewportPresentation();
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

  setModel(id: string): void {
    const model = this.examples.find((candidate) => candidate.id === id);
    if (model === undefined) return;
    const generation = ++this.loadGeneration;
    if (model.id === this.model.id) {
      setModelLoading(this.view, false, { allowModelSelection: true });
      clearModelFeedback(this.view);
      return;
    }
    if (model.deferredLoad !== undefined) {
      void this.loadDeferredModel(model, generation);
      return;
    }
    this.activateModel(model);
  }

  private async loadDeferredModel(model: WorkbenchModel, generation: number): Promise<void> {
    const deferredLoad = model.deferredLoad;
    if (deferredLoad === undefined) return;
    setModelLoading(this.view, true, { allowModelSelection: true });
    setModelFeedback(this.view, `Building ${model.name}…`);
    try {
      await yieldToBrowser();
      if (!this.isCurrentLoad(generation)) return;
      const loaded = await deferredLoad();
      if (!this.isCurrentLoad(generation)) return;
      this.activateModel(loaded);
    } catch (error) {
      if (!this.isCurrentLoad(generation)) return;
      setModelFeedback(
        this.view,
        `${model.name} could not be built: ${errorMessage(error)}`,
        "error",
      );
    } finally {
      if (generation === this.loadGeneration)
        setModelLoading(this.view, false, { allowModelSelection: true });
    }
  }

  async openGlb(file: File): Promise<void> {
    const generation = ++this.loadGeneration;
    setModelLoading(this.view, true);
    setModelFeedback(this.view, `Opening ${displayFileName(file.name)}…`);
    try {
      const imported = await this.importer(await file.arrayBuffer());
      if (this.disposed || generation !== this.loadGeneration) return;
      const model = createImportedModel(displayFileName(file.name), imported);
      this.activateModel(model);
      setModelFeedback(this.view, importFeedback(model.name, imported));
    } catch (error) {
      if (this.disposed || generation !== this.loadGeneration) return;
      setModelFeedback(
        this.view,
        `${displayFileName(file.name)} could not be opened: ${errorMessage(error)}`,
        "error",
      );
    } finally {
      if (generation === this.loadGeneration) {
        this.view.glbFileInput.value = "";
        setModelLoading(this.view, false);
      }
    }
  }

  setEdges(enabled: boolean): void {
    if (this.toggles.edges === enabled) return;
    this.toggles.edges = enabled;
    this.applyCurrentDisplayState();
    this.render();
  }

  setNodes(enabled: boolean): void {
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
    for (const slot of this.slots.values()) this.destroySlot(slot);
  }

  setResultMode(mode: ResultDisplayMode): void {
    if (this.model.results === undefined && mode !== "base") return;
    this.resultMode = mode;
    this.applyResultMode(true);
  }

  private cycleResultMode(): void {
    const next: ResultDisplayMode =
      this.resultMode === "base" ? "colored" : this.resultMode === "colored" ? "deformed" : "base";
    this.setResultMode(next);
  }

  private applyResultMode(render: boolean): void {
    const config = this.model.results;
    for (const viewport of this.viewports()) {
      if (config === undefined || this.resultMode === "base") {
        this.resultMode = "base";
        viewport.clearResults();
      } else if (this.resultMode === "colored") {
        const { deformation: _, ...coloredConfig } = config;
        viewport.setResults(coloredConfig);
      } else {
        viewport.setResults(config);
      }
    }
    this.presentation.reflectResults();
    if (render) this.render();
  }

  private applyCurrentDisplayState(): void {
    let state = this.interaction;
    for (const partId of this.model.scene.parts.keys()) {
      state = setPartOverride(
        state,
        partId,
        partStyleOverride(this.model, partId, this.toggles.edges, this.toggles.nodes),
      );
    }
    this.interaction = state;
    this.applyDisplayedInteraction();
    for (const viewport of this.viewports()) viewport.setEdgeDepthTest(true);
    this.reflectDisplayControls();
  }

  private reflectDisplayControls(): void {
    this.presentation.reflectEdges();
    this.presentation.reflectNodes();
    this.presentation.reflectResults();
    this.presentation.reflectContinuous();
    this.presentation.reflectBackground(this.background);
  }

  private setTreeHover(target: VisibilityRowTarget | undefined): void {
    if (this.disposed) return;
    this.treeHoverTargets =
      target === undefined ? [] : interactionTargetsForRow(this.runtime, target);
    const encoded = this.treeHoverTargets.map((value) => JSON.stringify(value)).join("|");
    for (const slot of this.slots.values()) slot.pane.canvas.dataset["treeHover"] = encoded;
    try {
      this.render();
    } catch (error) {
      if (!isDestroyedViewportError(error)) throw error;
    }
  }

  private applyDisplayedInteraction(): void {
    const effective = setTargetsHighlighted(this.interaction, this.treeHoverTargets, true);
    for (const viewport of this.viewports()) viewport.setInteraction(effective);
  }

  private viewportPresentationChanged(slot: ViewportSlot): boolean {
    const size = this.canvasSize(slot.pane.canvas);
    const devicePixelRatio = this.devicePixelRatio();
    const previous = this.observedPaneSizes.get(slot.id);
    this.observedPaneSizes.set(slot.id, { size, devicePixelRatio });
    if (previous === undefined) return true;
    const changed =
      size.width !== previous.size.width ||
      size.height !== previous.size.height ||
      devicePixelRatio !== previous.devicePixelRatio;
    return changed;
  }

  private canvasSize(canvas: HTMLCanvasElement): {
    readonly width: number;
    readonly height: number;
  } {
    const bounds = canvas.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  }

  private devicePixelRatio(): number {
    return typeof window === "undefined" ? 1 : window.devicePixelRatio;
  }

  private activateModel(model: WorkbenchModel): void {
    setModelLoading(this.view, false);
    const now = performance.now();
    for (const slot of this.slots.values()) slot.renderLoop.reset(now);
    this.model = model;
    this.models = model.source === "file" ? [...this.examples, model] : this.examples;
    this.treeHoverTargets = [];
    this.canvas.dataset["treeHover"] = "";
    this.toggles = createDefaultDisplayToggles();
    this.resultMode = model.results === undefined ? "base" : "deformed";
    this.interaction = createModelInteraction(model, true, true);
    for (const slot of this.slots.values()) {
      slot.interaction.clearContext();
      slot.viewport.batch(() => {
        slot.viewport.setScene(model.scene);
      });
    }
    this.applyResultMode(false);
    this.applyCurrentDisplayState();
    for (const slot of this.slots.values()) {
      const runtime = slot.viewport.runtime;
      slot.viewport.batch(() => {
        for (const nodeId of runtime.getNodeIds())
          slot.viewport.setAssemblyNodeVisible(nodeId, true);
        for (const partId of model.scene.parts.keys()) slot.viewport.setPartVisible(partId, true);
        for (const instanceId of runtime.getInstanceIds()) {
          slot.viewport.setInstanceVisible(instanceId, true);
        }
        slot.viewport.setCamera(setProjection(slot.viewport.camera, "orthographic"));
        slot.viewport.fitView();
      });
    }
    this.visibilityPanel.rebuild();
    this.presentation.populateModelSelect(this.models);
    for (const slot of this.slots.values()) slot.pane.canvas.dataset["model"] = model.id;
    clearModelFeedback(this.view);
    clearModelInspection(this.view, model);
    this.render();
  }

  private isCurrentLoad(generation: number): boolean {
    return !this.disposed && generation === this.loadGeneration;
  }

  render(): void {
    if (this.disposed) return;
    this.applyDisplayedInteraction();
    this.syncViewportPresentation();
  }

  private activeSlot(): ViewportSlot {
    const slot = this.slots.get(this.activeSlotId) ?? this.slots.get("primary");
    if (slot === undefined) throw new Error("Workbench has no primary viewport");
    return slot;
  }

  private activeViewport(): FemViewport {
    return this.activeSlot().viewport;
  }

  private viewports(): readonly FemViewport[] {
    return [...this.slots.values()].map((slot) => slot.viewport);
  }

  private setActiveSlot(slotId: ViewportSlotId): void {
    if (this.slots.get(slotId) === undefined) return;
    this.activeSlotId = slotId;
    for (const slot of this.slots.values()) {
      slot.pane.scene.dataset["active"] = String(slot.id === slotId);
    }
    this.syncViewportPresentation();
  }

  private syncPaneDataset(slot: ViewportSlot): void {
    const canvas = slot.pane.canvas;
    canvas.dataset["model"] = this.model.id;
    canvas.dataset["dragging"] = String(slot.dragging);
    canvas.dataset["selected"] = selectedKeys(this.interaction).join(",");
    canvas.dataset["camera"] = JSON.stringify(cameraSnapshot(slot.viewport.camera));
    canvas.dataset["cameraBounds"] = JSON.stringify(this.model.bounds);
    canvas.dataset["edges"] = String(this.toggles.edges);
    canvas.dataset["nodes"] = String(this.toggles.nodes);
    canvas.dataset["continuous"] = String(this.continuousEnabled);
    canvas.dataset["selectionMode"] = this.elementSelectionEnabled ? "element" : "exact";
    canvas.dataset["results"] = this.resultMode;
    canvas.dataset["background"] = this.background;
  }

  async toggleSecondaryViewport(): Promise<void> {
    if (this.slots.has("secondary")) {
      this.closeSecondaryViewport();
      return;
    }
    const generation = ++this.secondaryGeneration;
    this.view.viewportToggle.disabled = true;
    this.view.viewportToggle.textContent = "Opening…";
    this.view.secondaryPane.scene.hidden = false;
    this.view.viewportWorkspace.dataset["secondaryOpen"] = "true";
    let createdViewport: FemViewport | undefined;
    try {
      const viewport = await this.createViewport("secondary", this.view.secondaryPane, this.model);
      createdViewport = viewport;
      if (this.disposed || generation !== this.secondaryGeneration) {
        viewport.destroy();
        return;
      }
      const interaction = new WorkbenchInteraction({
        canvas: this.view.secondaryPane.canvas,
        view: this.view,
        viewport: () => viewport,
        elementSelectionEnabled: () => this.elementSelectionEnabled,
        getInteraction: () => this.interaction,
        setInteraction: (value) => {
          this.interaction = value;
        },
        partName: (partId) => this.model.partNames.get(partId),
        menu: this.menu,
        render: () => {
          this.render();
        },
      });
      const boxPreview = new WorkbenchBoxPreview(this.view.secondaryPane.boxSelectionOverlay);
      const slot: ViewportSlot = {
        id: "secondary",
        pane: this.view.secondaryPane,
        interaction,
        boxPreview,
        renderLoop: new WorkbenchRenderLoop(() => viewport),
        viewport,
        dragging: false,
      };
      this.slots.set("secondary", slot);
      slot.pane.canvas.dataset["renderer"] = "webgpu";
      const paneController = new AbortController();
      const removePaneBindings = installWorkbenchPaneLifecycle({
        pane: slot.pane,
        signal: paneController.signal,
        interaction,
        boxPreview,
        dragging: () => slot.dragging || boxPreview.isActive(),
        setActive: () => {
          this.setActiveSlot("secondary");
        },
      });
      slot.removePaneBindings = () => {
        paneController.abort();
        removePaneBindings();
      };
      this.setActiveSlot("secondary");
      this.applyResultMode(false);
      this.applyCurrentDisplayState();
      this.visibilityPanel.rebuild();
      viewport.render();
      this.updateViewportToggle();
      this.render();
    } catch (error) {
      if (this.slots.has("secondary")) {
        this.closeSecondaryViewport();
      } else if (createdViewport !== undefined) {
        createdViewport.destroy();
      }
      this.view.secondaryPane.scene.hidden = true;
      this.view.viewportWorkspace.dataset["secondaryOpen"] = "false";
      setModelFeedback(
        this.view,
        `Secondary viewport could not be opened: ${errorMessage(error)}`,
        "error",
      );
    } finally {
      if (generation === this.secondaryGeneration) {
        this.view.viewportToggle.disabled = false;
        this.updateViewportToggle();
      }
    }
  }

  handleSecondaryViewportError(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.closeSecondaryViewport();
    setModelFeedback(this.view, `Secondary viewport failed: ${detail}`, "error");
  }

  private closeSecondaryViewport(): void {
    const slot = this.slots.get("secondary");
    if (slot === undefined) return;
    this.secondaryGeneration += 1;
    this.setActiveSlot("primary");
    this.destroySlot(slot);
    this.slots.delete("secondary");
    this.view.secondaryPane.scene.hidden = true;
    this.view.viewportWorkspace.dataset["secondaryOpen"] = "false";
    this.updateViewportToggle();
    this.render();
  }

  private updateViewportToggle(): void {
    const open = this.slots.has("secondary");
    this.view.viewportToggle.textContent = open ? "Close viewport" : "Add viewport";
    this.view.viewportToggle.setAttribute(
      "aria-label",
      open ? "Close secondary viewport" : "Add secondary viewport",
    );
    this.view.viewportToggle.setAttribute("aria-pressed", String(open));
  }

  private destroySlot(slot: ViewportSlot): void {
    slot.removePaneBindings?.();
    slot.renderLoop.stop();
    slot.interaction.destroy();
    slot.boxPreview.dispose();
    slot.viewport.destroy();
  }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function isDestroyedViewportError(error: unknown): boolean {
  return error instanceof Error && error.message === "FemViewport has been destroyed";
}

function parseViewportBackground(value: string): ViewportBackground | undefined {
  if (value === "studio" || value === "white" || value === "dark") return value;
  return undefined;
}
