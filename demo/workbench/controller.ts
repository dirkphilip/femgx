import {
  setPartOverride,
  setTargetsHighlighted,
  setProjection,
  fitCamera,
  type Camera,
  type InteractionState,
  type FemViewport,
  type InteractionTarget,
  type SceneRuntime,
} from "../../src/index";
import type { ModelPreset } from "../fixture/presets";
import { describePick } from "./inspect";
import { selectedWorldBounds } from "./selection-bounds";
import type { DemoView } from "./view";
import { installWorkbenchLifecycle } from "./lifecycle";
import { createPresetInteraction, partStyleOverride } from "./preset";
import { interactionTargetsForRow, type VisibilityRowTarget } from "./tree-hover";
import { createWorkbenchFeatures, type WorkbenchFeatures } from "./features";
import {
  createDefaultDisplayToggles,
  type DisplayToggles,
  type ResultDisplayMode,
  type WorkbenchOptions,
} from "./types";

export type { DisplayToggles, RendererStats, ResultDisplayMode, WorkbenchOptions } from "./types";

/** Presentation policy for the demo workbench; rendering/picking stays in FemViewport. */
export class WorkbenchController {
  readonly canvas: HTMLCanvasElement;
  readonly view: DemoView;
  readonly rendererName: string;
  preset: ModelPreset;
  toggles: DisplayToggles;
  resultMode: ResultDisplayMode;
  interaction: InteractionState;
  rendererState = "";
  private viewport: FemViewport;
  private readonly presets: readonly ModelPreset[];
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

  constructor(options: WorkbenchOptions) {
    this.view = options.view;
    this.canvas = options.canvas;
    this.rendererName = options.rendererName;
    this.viewport = options.viewport;
    this.presets = options.presets;
    const initialPreset = this.presets[0];
    if (initialPreset === undefined) throw new Error("Workbench requires at least one preset");
    this.preset = initialPreset;
    this.toggles = createDefaultDisplayToggles();
    this.resultMode = this.preset.results === undefined ? "base" : "deformed";
    this.interaction = createPresetInteraction(this.preset, true, true);
    const features = createWorkbenchFeatures({
      view: this.view,
      canvas: this.canvas,
      rendererName: this.rendererName,
      viewport: () => this.viewport,
      runtime: () => this.runtime,
      preset: () => this.preset,
      presets: this.presets,
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
        this.applyMenuAction(action);
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
    this.presentation.populateModelSelect(this.presets);
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
      setPreset: (id) => {
        this.setPreset(id);
      },
    });
    this.canvas.dataset["model"] = this.preset.id;
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

  /** Switches to another deterministic model preset and rebuilds state. */
  setPreset(id: string): void {
    if (id === this.preset.id) return;
    const preset = this.presets.find((candidate) => candidate.id === id);
    if (preset === undefined) return;
    this.preset = preset;
    this.treeHoverTargets = [];
    this.canvas.dataset["treeHover"] = "";
    this.toggles = createDefaultDisplayToggles();
    this.resultMode = preset.results === undefined ? "base" : "deformed";
    this.interaction = createPresetInteraction(preset, true, true);
    this.interactionController.clearContext();
    this.viewport.setScene(preset.scene);
    this.applyResultMode(false);
    this.applyCurrentDisplayState();
    this.visibilityPanel.rebuild();
    this.presentation.populateModelSelect(this.presets);
    this.canvas.dataset["model"] = preset.id;
    this.render();
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

  /** Reframes the camera onto the whole model. */
  fitView(): void {
    this.viewport.fitView();
    this.render();
  }

  /** Fits selected occurrences, or the complete scene when nothing is selected. */
  fitSelection(): void {
    const bounds = selectedWorldBounds(this.preset.scene, this.runtime, this.interaction);
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

  /** Restores the complete initial workbench state for the active preset. */
  reset(): void {
    this.treeHoverTargets = [];
    this.canvas.dataset["treeHover"] = "";
    this.toggles = createDefaultDisplayToggles();
    this.resultMode = this.preset.results === undefined ? "base" : "deformed";
    this.interaction = createPresetInteraction(this.preset, true, true);
    this.interactionController.clearContext();
    this.applyResultMode(false);
    for (const nodeId of this.runtime.getNodeIds()) {
      this.viewport.setAssemblyNodeVisible(nodeId, true);
    }
    for (const partId of this.preset.scene.parts.keys()) this.viewport.setPartVisible(partId, true);
    for (const instanceId of this.runtime.getInstanceIds()) {
      this.viewport.setInstanceVisible(instanceId, true);
    }
    this.applyCurrentDisplayState();
    this.viewport.setCamera(setProjection(this.viewport.camera, "orthographic"));
    this.viewport.fitView();
    this.visibilityPanel.rebuild();
    this.canvas.dataset["hovered"] = "";
    this.canvas.dataset["selected"] = "";
    this.canvas.dataset["pick"] = "";
    this.view.inspectionPanel.textContent = describePick(undefined, (partId) =>
      this.preset.partNames.get(partId),
    );
    this.view.inspectionPanel.closest<HTMLElement>(".inspection")?.setAttribute("hidden", "");
    this.render();
  }

  /** Releases listeners owned by the controller and the renderer teardown hook. */
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

  /** Cycles the results preset through base, colored, and deformed states. */
  setResultMode(mode: ResultDisplayMode): void {
    if (this.preset.results === undefined && mode !== "base") return;
    this.resultMode = mode;
    this.applyResultMode(true);
  }

  private cycleResultMode(): void {
    const next: ResultDisplayMode =
      this.resultMode === "base" ? "colored" : this.resultMode === "colored" ? "deformed" : "base";
    this.setResultMode(next);
  }

  private applyResultMode(render: boolean): void {
    const config = this.preset.results;
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

  /** Applies all model/display state to the active viewport before rendering. */
  private applyCurrentDisplayState(): void {
    let state = this.interaction;
    for (const partId of this.preset.scene.parts.keys()) {
      state = setPartOverride(
        state,
        partId,
        partStyleOverride(this.preset, partId, this.toggles.edges, this.toggles.nodes),
      );
    }
    this.interaction = state;
    this.applyDisplayedInteraction();
    this.viewport.setEdgeDepthTest(true);
    this.reflectDisplayControls();
  }

  /** Reflects every display control from authoritative controller/viewport state. */
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

  private applyMenuAction(action: string): void {
    const target = this.interactionController.contextTarget;
    switch (action) {
      case "highlight":
        if (target !== undefined) this.interactionController.highlight(target);
        break;
      case "select":
        if (target !== undefined) this.interactionController.select(target);
        break;
      case "hide-instance":
        if (target !== undefined) this.visibilityActions.toggleInstance(target);
        break;
      case "hide-part":
        if (target !== undefined) this.visibilityActions.togglePart(target);
        break;
      case "clear-selection":
        this.interactionController.clearSelection();
        break;
      case "show-all":
        this.visibilityActions.showAll();
        break;
      case "edges":
        this.setEdges(!this.toggles.edges);
        break;
      case "diagnostics":
        this.toggles.diagnostics = !this.toggles.diagnostics;
        this.syncViewportPresentation();
        break;
      case "fit-view":
        this.fitView();
        break;
      case "reset":
        this.reset();
        break;
    }
  }

  /** Re-draws the current state and refreshes the status line and datasets. */
  render(): void {
    if (this.disposed) return;
    this.applyDisplayedInteraction();
    this.syncViewportPresentation();
  }
}

function isDestroyedViewportError(error: unknown): boolean {
  return error instanceof Error && error.message === "FemViewport has been destroyed";
}
