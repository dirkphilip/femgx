import {
  setPartOverride,
  setTargetsHighlighted,
  setProjection,
  fitCamera,
  importGlb,
  type Camera,
  type InteractionState,
  type FemViewport,
  type InteractionTarget,
  type SceneRuntime,
} from "../../src/index";
import { selectedWorldBounds } from "./selection-bounds";
import type { DemoView } from "./view";
import { installWorkbenchLifecycle } from "./lifecycle";
import { createModelInteraction } from "./preset";
import {
  createImportedModel,
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
import {
  createDefaultDisplayToggles,
  type DisplayToggles,
  type ResultDisplayMode,
  type WorkbenchOptions,
} from "./types";

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
  private viewport: FemViewport;
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
  private boxSelectionDisposer: (() => void) | undefined;
  private dragging = false;
  private treeHoverTargets: readonly InteractionTarget[] = [];
  private disposed = false;
  private loadGeneration = 0;

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
    this.importer = options.importGlb ?? importGlb;
    this.toggles = createDefaultDisplayToggles();
    this.resultMode = this.model.results === undefined ? "base" : "deformed";
    this.interaction = createModelInteraction(this.model, true, true);
    const features = createWorkbenchFeatures({
      view: this.view,
      canvas: this.canvas,
      rendererName: this.rendererName,
      viewport: () => this.viewport,
      runtime: () => this.runtime,
      model: () => this.model,
      presets: this.models,
      toggles: () => this.toggles,
      resultMode: () => this.resultMode,
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
          target: this.interactionController.contextTarget,
          interaction: this.interactionController,
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
      },
    });
    this.menu = features.menu;
    this.visibilityPanel = features.visibilityPanel;
    this.visibilityActions = features.visibilityActions;
    this.interactionController = features.interactionController;
    this.presentation = features.presentation;
    this.boxPreview = features.boxPreview;
    this.applyResultMode(false);
    this.applyCurrentDisplayState();
    this.presentation.populateModelSelect(this.models);
    this.visibilityPanel.rebuild();
    this.boxSelectionDisposer = installWorkbenchLifecycle({
      view: this.view,
      canvas: this.canvas,
      signal: this.listenerController.signal,
      viewport: () => this.viewport,
      interaction: this.interactionController,
      menu: this.menu,
      visibilityPanel: this.visibilityPanel,
      boxPreview: this.boxPreview,
      dragging: () => this.isPointerGestureActive(),
      setEdges: () => {
        this.setEdges(!this.toggles.edges);
      },
      setNodes: () => {
        this.setNodes(!this.toggles.nodes);
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
      fitSelection: () => {
        this.fitSelection();
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
    return this.viewport.runtime;
  }

  get camera(): Camera {
    return this.viewport.camera;
  }

  setViewport(viewport: FemViewport): void {
    this.viewport = viewport;
    this.treeHoverTargets = [];
    this.canvas.dataset["treeHover"] = "";
    this.applyResultMode(false);
    this.applyCurrentDisplayState();
    this.visibilityPanel.rebuild();
    this.render();
  }

  setCameraGestureActive(active: boolean): void {
    this.dragging = active;
    this.canvas.dataset["dragging"] = active ? "true" : "false";
  }

  isPointerGestureActive(): boolean {
    return this.dragging || this.boxPreview.isActive();
  }

  syncViewportPresentation(): void {
    if (this.disposed) return;
    const viewportStats = this.viewport.stats();
    this.presentation.refresh(this.viewport.camera, this.rendererState, {
      visibleInstances: viewportStats.visibleInstances,
      batches: viewportStats.drawBatches,
    });
  }

  setModel(id: string): void {
    const model = this.examples.find((candidate) => candidate.id === id);
    if (model === undefined || model.id === this.model.id) return;
    this.activateModel(model);
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
    this.viewport.fitView();
    this.render();
  }

  fitSelection(): void {
    const bounds = selectedWorldBounds(this.model.scene, this.runtime, this.interaction);
    if (bounds === undefined) {
      this.fitView();
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    this.viewport.setCamera(
      fitCamera(this.viewport.camera, bounds, Math.max(1, rect.width), Math.max(1, rect.height)),
    );
    this.render();
  }

  reset(): void {
    this.activateModel(this.model);
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.boxSelectionDisposer?.();
    this.boxSelectionDisposer = undefined;
    this.treeHoverTargets = [];
    this.canvas.dataset["treeHover"] = "";
    this.listenerController.abort();
    this.interactionController.destroy();
    this.boxPreview.dispose();
    this.viewport.destroy();
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
    if (config === undefined || this.resultMode === "base") {
      this.resultMode = "base";
      this.viewport.clearResults();
    } else if (this.resultMode === "colored") {
      const { deformation: _, ...coloredConfig } = config;
      this.viewport.setResults(coloredConfig);
    } else {
      this.viewport.setResults(config);
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
    this.viewport.setEdgeDepthTest(true);
    this.reflectDisplayControls();
  }

  private reflectDisplayControls(): void {
    this.presentation.reflectEdges();
    this.presentation.reflectNodes();
    this.presentation.reflectResults();
  }

  private setTreeHover(target: VisibilityRowTarget | undefined): void {
    if (this.disposed) return;
    this.treeHoverTargets =
      target === undefined ? [] : interactionTargetsForRow(this.runtime, target);
    this.canvas.dataset["treeHover"] = this.treeHoverTargets
      .map((value) => JSON.stringify(value))
      .join("|");
    try {
      this.render();
    } catch (error) {
      if (!isDestroyedViewportError(error)) throw error;
    }
  }

  private applyDisplayedInteraction(): void {
    this.viewport.setInteraction(
      setTargetsHighlighted(this.interaction, this.treeHoverTargets, true),
    );
  }

  private activateModel(model: WorkbenchModel): void {
    this.model = model;
    this.models = model.source === "file" ? [...this.examples, model] : this.examples;
    this.treeHoverTargets = [];
    this.canvas.dataset["treeHover"] = "";
    this.toggles = createDefaultDisplayToggles();
    this.resultMode = model.results === undefined ? "base" : "deformed";
    this.interaction = createModelInteraction(model, true, true);
    this.interactionController.clearContext();
    this.viewport.batch(() => {
      this.viewport.setScene(model.scene);
      this.applyResultMode(false);
      this.applyCurrentDisplayState();
      for (const nodeId of this.runtime.getNodeIds()) {
        this.viewport.setAssemblyNodeVisible(nodeId, true);
      }
      for (const partId of model.scene.parts.keys()) this.viewport.setPartVisible(partId, true);
      for (const instanceId of this.runtime.getInstanceIds()) {
        this.viewport.setInstanceVisible(instanceId, true);
      }
      this.viewport.setCamera(setProjection(this.viewport.camera, "orthographic"));
      this.viewport.fitView();
    });
    this.visibilityPanel.rebuild();
    this.presentation.populateModelSelect(this.models);
    this.canvas.dataset["model"] = model.id;
    clearModelInspection(this.view, model);
    this.render();
  }

  render(): void {
    if (this.disposed) return;
    this.applyDisplayedInteraction();
    this.syncViewportPresentation();
  }
}

function isDestroyedViewportError(error: unknown): boolean {
  return error instanceof Error && error.message === "FemViewport has been destroyed";
}
