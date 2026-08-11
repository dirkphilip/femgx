import {
  setPartOverride,
  setProjection,
  fitCamera,
  type Camera,
  type ElementRenderMode,
  type InstanceId,
  type InteractionState,
  type PartId,
  type FemViewport,
  type SceneRuntime,
} from "../src/index";
import { visiblePartIdsForPreset, type ModelPreset } from "./fixture/presets";
import { describePick } from "./inspect";
import { selectedWorldBounds } from "./selection-bounds";
import type { DemoView } from "./view";
import { WorkbenchInteraction } from "./workbench/interaction";
import { installWorkbenchBindings } from "./workbench/listeners";
import { WorkbenchMenu } from "./workbench/menu";
import { submittedTriangleCount, uniqueTriangleCount } from "./workbench/status";
import {
  VisibilityPanelController,
  type VisibilityPanelOptions,
} from "./workbench/visibility-panel";
import { WorkbenchPresentation } from "./workbench/presentation";
import { WorkbenchVisibilityActions } from "./workbench/visibility-actions";
import { createPresetInteraction, partStyleOverride } from "./workbench/preset";
import { indexRuntime } from "./workbench/runtime-index";
import type { DisplayToggles, ResultDisplayMode, WorkbenchOptions } from "./workbench/types";

export type {
  DisplayToggles,
  RendererStats,
  ResultDisplayMode,
  WorkbenchOptions,
} from "./workbench/types";

/** Presentation policy for the demo workbench; rendering/picking stays in FemViewport. */
export class WorkbenchController {
  readonly canvas: HTMLCanvasElement;
  readonly view: DemoView;
  readonly rendererName: string;
  preset: ModelPreset;
  mode: ElementRenderMode;
  toggles: DisplayToggles;
  resultMode: ResultDisplayMode;
  interaction: InteractionState;
  /** Renderer-state note shown in the status line (e.g. "recovered"). */
  rendererState = "";
  private viewport: FemViewport;
  private readonly presets: readonly ModelPreset[];
  private readonly slotByInstanceId = new Map<InstanceId, number>();
  private readonly partIdByInstanceId = new Map<InstanceId, PartId>();
  private readonly partFirstSlot = new Map<PartId, number>();
  private readonly listenerController = new AbortController();
  private readonly menu: WorkbenchMenu;
  private readonly visibilityPanel: VisibilityPanelController;
  private readonly visibilityActions: WorkbenchVisibilityActions;
  private readonly interactionController: WorkbenchInteraction;
  private readonly presentation: WorkbenchPresentation;
  private depthTestEnabled = true;
  private dragging = false;
  private disposed = false;

  constructor(options: WorkbenchOptions) {
    this.view = options.view;
    this.canvas = options.canvas;
    this.rendererName = options.rendererName;
    this.viewport = options.viewport;
    this.presets = options.presets;
    this.menu = new WorkbenchMenu(
      this.view.contextMenu,
      () => this.toggles.edges,
      () => this.toggles.diagnostics,
      (action) => {
        this.applyMenuAction(action);
      },
    );
    this.visibilityActions = new WorkbenchVisibilityActions({
      viewport: () => this.viewport,
      runtime: () => this.runtime,
      slotByInstanceId: this.slotByInstanceId,
      firstSlotByPart: this.partFirstSlot,
      interaction: () => this.interaction,
      setInteraction: (interaction) => {
        this.interaction = interaction;
      },
      applyInteraction: (interaction) => {
        this.interaction = interaction;
        this.viewport.setInteraction(interaction);
      },
      syncPanel: () => {
        this.visibilityPanel.sync();
      },
      render: () => {
        this.render();
      },
    });
    const visibilityOptions: VisibilityPanelOptions = {
      panel: this.view.visibilityPanel,
      getPreset: () => this.preset,
      getRuntime: () => this.runtime,
      getMode: () => this.mode,
      partName: (partId) => this.preset.partNames.get(partId),
      partVisible: (partId) => this.visibilityActions.partVisible(partId),
      bodyVisible: (instanceId, bodyId) => this.visibilityActions.bodyVisible(instanceId, bodyId),
      bodyGroupVisible: (instanceId, bodyIds) =>
        this.visibilityActions.bodyGroupVisible(instanceId, bodyIds),
      bodyHighlighted: (instanceId, bodyId) =>
        this.visibilityActions.bodyHighlighted(instanceId, bodyId),
      bodyColorActive: (instanceId, bodyId) =>
        this.visibilityActions.bodyColorActive(instanceId, bodyId),
      onPartVisibility: (partId, visible) => {
        this.visibilityActions.setPart(partId, visible);
      },
      onBodyVisibility: (instanceId, bodyId, visible) => {
        this.visibilityActions.setBody(instanceId, bodyId, visible);
      },
      onBodyGroupVisibility: (instanceId, bodyIds, visible) => {
        this.visibilityActions.setBodyGroup(instanceId, bodyIds, visible);
      },
      onBodyAction: (instanceId, bodyId, action) => {
        this.visibilityActions.bodyAction(instanceId, bodyId, action);
      },
      onInstanceVisibility: (slot, visible) => {
        this.visibilityActions.setInstance(slot, visible);
      },
      onAssemblyVisibility: (nodeId, visible) => {
        this.visibilityActions.setAssemblyNode(nodeId, visible);
      },
    };
    this.visibilityPanel = new VisibilityPanelController(visibilityOptions);
    this.interactionController = new WorkbenchInteraction({
      canvas: this.canvas,
      view: this.view,
      viewport: () => this.viewport,
      getInteraction: () => this.interaction,
      setInteraction: (interaction) => {
        this.interaction = interaction;
      },
      partIdForInstance: (instanceId) => this.partIdByInstanceId.get(instanceId),
      partName: (partId) => this.preset.partNames.get(partId),
      menu: this.menu,
      render: () => {
        this.render();
      },
    });
    this.presentation = new WorkbenchPresentation({
      view: this.view,
      canvas: this.canvas,
      rendererName: this.rendererName,
      getPreset: () => this.preset,
      getMode: () => this.mode,
      getToggles: () => this.toggles,
      getResultMode: () => this.resultMode,
      getInteraction: () => this.interaction,
      getRuntime: () => this.runtime,
      partFirstSlot: this.partFirstSlot,
    });
    const initialPreset = this.presets[0];
    if (initialPreset === undefined) throw new Error("Workbench requires at least one preset");
    this.preset = initialPreset;
    this.mode = "solid";
    this.toggles = {
      edges: false,
      nodes: false,
      diagnostics: false,
    };
    this.resultMode = this.preset.results === undefined ? "base" : "deformed";
    this.interaction = createPresetInteraction(this.preset);
    this.applyResultMode(false);
    this.viewport.setInteraction(this.interaction);
    indexRuntime(this.runtime, this.slotByInstanceId, this.partIdByInstanceId, this.partFirstSlot);
    this.applyModeVisibility();
    this.presentation.populateModelSelect(this.presets);
    this.visibilityPanel.rebuild();
    this.installListeners();
    this.canvas.dataset["model"] = this.preset.id;
    this.canvas.dataset["mode"] = this.mode;
    this.canvas.dataset["dragging"] = "false";
    this.render();
  }

  get runtime(): SceneRuntime {
    return this.viewport.runtime;
  }

  get camera(): Camera {
    return this.viewport.camera;
  }

  /** Reattaches the presentation shell after the e2e lifecycle seam recreates the viewport. */
  setViewport(viewport: FemViewport): void {
    this.viewport = viewport;
    this.applyResultMode(false);
    this.viewport.setInteraction(this.interaction);
    this.viewport.setEdgeDepthTest(this.depthTestEnabled);
    this.viewport.setNodeOverlay(this.toggles.nodes);
    indexRuntime(this.runtime, this.slotByInstanceId, this.partIdByInstanceId, this.partFirstSlot);
    this.applyModeVisibility();
    this.visibilityPanel.rebuild();
    this.render();
  }

  /** Mirrors the core camera gesture state into demo-only hover policy and diagnostics. */
  setCameraGestureActive(active: boolean): void {
    this.dragging = active;
    this.canvas.dataset["dragging"] = active ? "true" : "false";
  }

  /** Refreshes demo-only status after a viewport-owned camera/render update. */
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
    this.mode = "solid";
    this.resultMode = preset.results === undefined ? "base" : "deformed";
    this.interaction = createPresetInteraction(preset);
    this.interactionController.clearContext();
    this.viewport.setScene(preset.scene);
    this.applyResultMode(false);
    this.viewport.setInteraction(this.interaction);
    indexRuntime(this.runtime, this.slotByInstanceId, this.partIdByInstanceId, this.partFirstSlot);
    this.applyModeVisibility();
    this.visibilityPanel.rebuild();
    this.presentation.populateModelSelect(this.presets);
    this.canvas.dataset["model"] = preset.id;
    this.canvas.dataset["mode"] = this.mode;
    this.render();
  }

  /** Switches the visible element family through the runtime. */
  setMode(mode: ElementRenderMode): void {
    if (mode === this.mode) return;
    if (mode === "edges") this.setEdges(true);
    else if (this.mode === "edges") this.setEdges(false);
    this.applyModeVisibility(mode);
    this.mode = mode;
    this.visibilityPanel.rebuild();
    this.canvas.dataset["mode"] = mode;
    this.render();
  }

  /** Applies the preset's per-mode part visibility to the runtime. */
  private applyModeVisibility(mode: ElementRenderMode = this.mode): void {
    const visible = visiblePartIdsForPreset(this.preset, mode);
    for (const partId of this.preset.scene.parts.keys()) {
      this.viewport.setPartVisible(partId, visible.has(partId));
    }
    this.visibilityPanel.sync();
  }

  /** Applies or clears the wireframe edge overlay across every part. */
  setEdges(enabled: boolean): void {
    if (this.toggles.edges === enabled) return;
    this.toggles.edges = enabled;
    let state = this.interaction;
    for (const partId of this.preset.scene.parts.keys()) {
      state = setPartOverride(state, partId, partStyleOverride(this.preset, partId, enabled));
    }
    this.interaction = state;
    this.presentation.reflectEdges();
    this.render();
  }

  /** Shows one small glyph at every visible finite-element node. */
  setNodes(enabled: boolean): void {
    if (this.toggles.nodes === enabled) return;
    this.toggles.nodes = enabled;
    this.viewport.setNodeOverlay(enabled);
    this.presentation.reflectNodes();
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
    this.mode = "solid";
    this.toggles = { edges: false, nodes: false, diagnostics: false };
    this.depthTestEnabled = true;
    this.resultMode = this.preset.results === undefined ? "base" : "deformed";
    this.interaction = createPresetInteraction(this.preset);
    this.interactionController.clearContext();
    this.applyResultMode(false);
    for (let nodeId = 0; nodeId < this.runtime.nodeAssemblyIds.length; nodeId += 1) {
      this.viewport.setAssemblyNodeVisible(nodeId, true);
    }
    for (const partId of this.preset.scene.parts.keys()) this.viewport.setPartVisible(partId, true);
    for (let slot = 0; slot < this.runtime.instanceCount; slot += 1) {
      this.viewport.setInstanceVisible(slot, true);
    }
    this.applyModeVisibility();
    this.viewport.setEdgeDepthTest(true);
    this.viewport.setNodeOverlay(false);
    this.viewport.fitView();
    this.viewport.setCamera(setProjection(this.viewport.camera, "perspective"));
    this.visibilityPanel.rebuild();
    this.presentation.reflectEdges();
    this.presentation.reflectResults();
    this.presentation.reflectNodes();
    this.presentation.reflectDepthTest(this.depthTestEnabled);
    this.canvas.dataset["mode"] = this.mode;
    this.canvas.dataset["hovered"] = "";
    this.canvas.dataset["selected"] = "";
    this.canvas.dataset["pick"] = "";
    this.view.inspectionPanel.textContent = describePick(undefined, (partId) =>
      this.preset.partNames.get(partId),
    );
    this.render();
  }

  /** Releases listeners owned by the controller and the renderer teardown hook. */
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listenerController.abort();
    this.interactionController.destroy();
    this.viewport.destroy();
  }

  private installListeners(): void {
    const signal = this.listenerController.signal;
    this.visibilityPanel.install(signal);
    this.menu.install(signal);
    installWorkbenchBindings({
      view: this.view,
      canvas: this.canvas,
      signal,
      viewport: () => this.viewport,
      interaction: this.interactionController,
      menu: this.menu,
      dragging: () => this.dragging,
      setDepthTest: () => {
        this.depthTestEnabled = !this.depthTestEnabled;
        this.viewport.setEdgeDepthTest(this.depthTestEnabled);
        this.presentation.reflectDepthTest(this.depthTestEnabled);
      },
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
    this.presentation.reflectEdges();
    this.presentation.reflectDepthTest(this.depthTestEnabled);
    this.presentation.reflectNodes();
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
    this.viewport.setInteraction(this.interaction);
    this.syncViewportPresentation();
  }

  /** Unique triangles stored across the preset's reusable part definitions. */
  uniqueTriangleCount(): number {
    return uniqueTriangleCount(this.preset);
  }

  /** Submitted triangles authored by this preset, before temporary visibility changes. */
  submittedTriangleCount(): number {
    return submittedTriangleCount(this.preset, this.runtime);
  }
}
