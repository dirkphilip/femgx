import {
  createCamera,
  createInteractionState,
  createPickScene,
  createSceneRuntime,
  pick,
  resizeCamera,
  setElementSelected,
  setFaceHighlighted,
  setFaceSelected,
  setHoveredElement,
  setHoveredFace,
  setHoveredInstance,
  setHoveredNode,
  setInstanceHighlighted,
  setInstanceSelected,
  setNodeHighlighted,
  setNodeSelected,
  setPartHighlighted,
  setPartOverride,
  setPartSelected,
  setProjection,
  type AssemblyId,
  type Camera,
  type ElementId,
  type ElementRef,
  type ElementRenderMode,
  type InstanceId,
  type InteractionState,
  type PartId,
  type PickRequest,
  type PickScene,
  type ResolvedPick,
  type SceneRuntime,
  type StyleOverride,
} from "../src/index";
import {
  createModelPresets,
  visiblePartIdsForPreset,
  type ModelPreset,
} from "../src/fixture/presets";
import { installCameraControls } from "./camera-controls";
import { rebuildElementOverrides, type EmphasisContext } from "./emphasis";
import { fitCamera } from "./fit";
import { describePick } from "./inspect";
import { selectTarget, targetKey, type SelectTarget } from "./pick";
import { updateStatus, type CameraRef, type DemoView, type StatusInfo } from "./view";

/** Current draw statistics reported by the active renderer. */
export interface RendererStats {
  readonly visibleInstances: number;
  readonly batches: number;
}

/** Renderer callbacks the workbench drives. */
export interface RendererHooks {
  /** Draws one frame with the current interaction state. */
  readonly render: (controller: WorkbenchController, state: InteractionState) => void;
  /** Applies visibility changes and re-renders. */
  readonly applyVisibility: (
    controller: WorkbenchController,
    state: InteractionState,
    changedSlots: readonly number[],
  ) => void;
  /** Current draw statistics for the status bar. */
  readonly stats: (controller: WorkbenchController) => RendererStats;
}

/** Display overlay toggles shared by the control bar and context menu. */
export interface DisplayToggles {
  edges: boolean;
  nodeMarkers: boolean;
  normals: boolean;
  faceBoundaries: boolean;
  ids: boolean;
  diagnostics: boolean;
}

/** Options for the shared inspection workbench controller. */
export interface WorkbenchOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly hooks: RendererHooks;
  /** Optional edge depth-test hook backed by the active renderer. */
  readonly setEdgeDepthTest?: (enabled: boolean) => void;
  /**
   * Whether the active renderer implements depth-tested edge rendering. The
   * WebGPU renderer supports it; the CPU renderer does not, so its Depth test
   * control is disabled and annotated instead of advertising a no-op.
   * Defaults to true.
   */
  readonly supportsEdgeDepthTest?: boolean;
  /** Optional teardown hook invoked on destroy. */
  readonly onDestroy?: () => void;
  /**
   * Whether the active renderer draws the display overlays (node markers,
   * normals, face boundaries, and ID labels). The CPU renderer supports them;
   * the WebGPU renderer does not yet, so its context menu disables and
   * annotates the toggles instead of advertising a no-op. Defaults to true.
   */
  readonly displayOverlays?: boolean;
}

/**
 * The renderer-independent interaction brain of the demo: owns the active
 * model, the packed runtime, interaction state, visibility, and all display
 * toggles, and drives whichever renderer is attached through {@link
 * RendererHooks}. Picking is unified CPU raycasting for both renderers.
 */
export class WorkbenchController {
  readonly canvas: HTMLCanvasElement;
  readonly view: DemoView;
  readonly hooks: RendererHooks;
  readonly rendererName: string;
  /** Whether the active renderer implements depth-tested edge rendering. */
  readonly supportsEdgeDepthTest: boolean;
  /** Whether the active renderer draws the node/normal/face-boundary/ID overlays. */
  readonly displayOverlays: boolean;
  readonly nodeRadius = 10;
  preset: ModelPreset;
  mode: ElementRenderMode;
  toggles: DisplayToggles;
  interaction: InteractionState;
  /** Renderer-state note shown in the status line (e.g. "recovered", "fallback"). */
  rendererState = "";
  runtime!: SceneRuntime;
  pickScene!: PickScene;
  cameraRef: CameraRef;
  private readonly setEdgeDepthTest: ((enabled: boolean) => void) | undefined;
  private readonly onDestroy: (() => void) | undefined;
  private readonly presets: readonly ModelPreset[];
  private readonly slotByInstanceId = new Map<InstanceId, number>();
  private readonly partFirstSlot = new Map<PartId, number>();
  private readonly assemblyVisible = new Set<AssemblyId>();
  private readonly explicitElementOverrides = new Map<InstanceId, Map<ElementId, StyleOverride>>();
  private depthTestEnabled = true;
  private emphasisContext: EmphasisContext;
  private contextTarget: SelectTarget | undefined;
  private dragging = false;
  private downPosition: { readonly x: number; readonly y: number } | undefined;
  private disposed = false;

  constructor(options: WorkbenchOptions) {
    this.view = options.view;
    this.canvas = options.canvas;
    this.hooks = options.hooks;
    this.rendererName = options.rendererName;
    this.supportsEdgeDepthTest = options.supportsEdgeDepthTest ?? true;
    this.displayOverlays = options.displayOverlays ?? true;
    this.setEdgeDepthTest = options.setEdgeDepthTest;
    this.onDestroy = options.onDestroy;
    this.presets = createModelPresets();
    this.preset = this.presets[0] ?? createEmptyPreset();
    this.cameraRef = {
      camera: fitCamera(createCamera(), this.preset.bounds, this.canvas.width, this.canvas.height),
    };
    this.mode = this.preset.defaultMode;
    this.toggles = {
      edges: false,
      nodeMarkers: true,
      normals: false,
      faceBoundaries: false,
      ids: false,
      diagnostics: false,
    };
    this.interaction = createInteractionState();
    this.emphasisContext = this.buildContext(this.preset);
    this.seedAssemblyVisibility();
    this.applyModeVisibility();
    this.populateModelSelect();
    this.populateVisibilityPanel();
    this.installControls();
    this.installCanvasInteraction();
    this.canvas.dataset["model"] = this.preset.id;
    this.canvas.dataset["mode"] = this.mode;
    this.canvas.dataset["dragging"] = "false";
    this.render();
  }

  /** Switches to another deterministic model preset and rebuilds state. */
  setPreset(id: string): void {
    if (id === this.preset.id) return;
    const preset = this.presets.find((candidate) => candidate.id === id);
    if (preset === undefined) return;
    this.preset = preset;
    this.mode = preset.defaultMode;
    this.interaction = createInteractionState();
    this.explicitElementOverrides.clear();
    this.contextTarget = undefined;
    this.cameraRef.camera = fitCamera(
      this.cameraRef.camera,
      preset.bounds,
      this.canvas.width,
      this.canvas.height,
    );
    this.emphasisContext = this.buildContext(preset);
    this.seedAssemblyVisibility();
    this.applyModeVisibility();
    this.populateVisibilityPanel();
    this.canvas.dataset["model"] = preset.id;
    this.canvas.dataset["mode"] = this.mode;
    this.render();
  }

  /** Tracks the assemblies the scene starts visible as the panel's baseline. */
  private seedAssemblyVisibility(): void {
    this.assemblyVisible.clear();
    for (const assemblyId of this.preset.scene.visibleAssemblyIds) {
      this.assemblyVisible.add(assemblyId);
    }
  }

  /** Switches the visible element family through the runtime. */
  setMode(mode: ElementRenderMode): void {
    if (mode === this.mode) return;
    this.applyModeVisibility(mode);
    this.mode = mode;
    this.canvas.dataset["mode"] = mode;
    this.render();
  }

  /** Applies the preset's per-mode part visibility to the runtime. */
  private applyModeVisibility(mode: ElementRenderMode = this.mode): void {
    const visible = visiblePartIdsForPreset(this.preset, mode);
    for (const partId of this.preset.scene.parts.keys()) {
      const delta = this.runtime.setPartVisible(partId, visible.has(partId));
      if (delta.changedInstanceIds.length > 0) {
        this.hooks.applyVisibility(this, this.interaction, delta.changedInstanceIds);
      }
    }
    this.syncVisibilityPanel();
  }

  /** Applies or clears the wireframe edge overlay across every part. */
  setEdges(enabled: boolean): void {
    if (this.toggles.edges === enabled) return;
    this.toggles.edges = enabled;
    let state = this.interaction;
    for (const partId of this.preset.scene.parts.keys()) {
      state = setPartOverride(state, partId, enabled ? { edge: true } : undefined);
    }
    this.interaction = state;
    this.reflectEdges();
    this.render();
  }

  /** Reframes the camera onto the whole model. */
  fitView(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.cameraRef.camera = fitCamera(
      this.cameraRef.camera,
      this.preset.bounds,
      Math.max(1, rect.width),
      Math.max(1, rect.height),
    );
    this.render();
  }

  /** Clears interaction state and restores the initial camera pose. */
  reset(): void {
    this.interaction = createInteractionState();
    this.explicitElementOverrides.clear();
    this.contextTarget = undefined;
    const rect = this.canvas.getBoundingClientRect();
    const fitted = fitCamera(
      this.cameraRef.camera,
      this.preset.bounds,
      Math.max(1, rect.width),
      Math.max(1, rect.height),
    );
    this.cameraRef.camera = setProjection(fitted, "perspective");
    this.canvas.dataset["hovered"] = "";
    this.canvas.dataset["selected"] = "";
    this.canvas.dataset["pick"] = "";
    this.view.inspectionPanel.textContent = describePick(undefined);
    this.render();
  }

  /** Releases listeners owned by the controller and the renderer teardown hook. */
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.onDestroy?.();
  }

  private buildContext(preset: ModelPreset): EmphasisContext {
    this.runtime = createSceneRuntime(preset.scene);
    this.pickScene = createPickScene(preset.scene.parts, preset.elementModels);
    this.slotByInstanceId.clear();
    this.partFirstSlot.clear();
    for (let slot = 0; slot < this.runtime.instanceCount; slot++) {
      const instanceId = this.runtime.getInstanceId(slot);
      const partId = this.runtime.instancePartIds[slot];
      if (instanceId !== undefined) this.slotByInstanceId.set(instanceId, slot);
      if (partId !== undefined && !this.partFirstSlot.has(partId)) {
        this.partFirstSlot.set(partId, slot);
      }
    }
    return {
      runtime: this.runtime,
      slotByInstanceId: this.slotByInstanceId,
      elementModels: preset.elementModels,
    };
  }

  private installControls(): void {
    const view = this.view;
    view.projectionToggle.addEventListener("click", () => {
      this.cameraRef.camera = setProjection(
        this.cameraRef.camera,
        this.cameraRef.camera.mode === "perspective" ? "orthographic" : "perspective",
      );
      this.render();
    });
    view.edgeOverlayToggle.addEventListener("click", () => {
      this.setEdges(!this.toggles.edges);
    });
    view.depthTestToggle.addEventListener("click", () => {
      if (!this.supportsEdgeDepthTest) return;
      this.setEdgeDepthTest?.(!this.depthTestEnabled);
      this.depthTestEnabled = !this.depthTestEnabled;
      this.reflectDepthTest();
    });
    for (const button of view.modeButtons) {
      button.addEventListener("click", () => {
        const mode = button.dataset["mode"] as ElementRenderMode | undefined;
        if (mode !== undefined) this.setMode(mode);
      });
    }
    view.resetButton.addEventListener("click", () => {
      this.reset();
    });
    view.fitView.addEventListener("click", () => {
      this.fitView();
    });
    view.modelSelect.addEventListener("change", () => {
      this.setPreset(view.modelSelect.value);
    });
    window.addEventListener("resize", () => {
      const rect = view.canvas.getBoundingClientRect();
      this.cameraRef.camera = resizeCamera(this.cameraRef.camera, rect.width, rect.height);
      this.render();
    });
    view.visibilityPanel.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const partId = target.dataset["partId"];
      const assemblyId = target.dataset["assemblyId"];
      if (partId !== undefined) this.setPartVisibility(Number(partId), target.checked);
      else if (assemblyId !== undefined) {
        this.setAssemblyVisibility(Number(assemblyId), target.checked);
      }
    });
    view.contextMenu.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>("button[data-action]");
      if (button === null) return;
      const action = button.dataset["action"];
      if (action !== undefined) this.applyMenuAction(action);
      this.hideContextMenu();
    });
    this.reflectEdges();
    this.reflectDepthTest();
  }

  private installCanvasInteraction(): void {
    const canvas = this.canvas;
    installCameraControls({
      canvas,
      cameraRef: this.cameraRef,
      onGestureChange: (active) => {
        this.dragging = active;
        canvas.dataset["dragging"] = active ? "true" : "false";
      },
      onRender: () => {
        this.render();
      },
    });
    canvas.addEventListener("pointerdown", (event) => {
      this.downPosition = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener("pointercancel", () => {
      this.downPosition = undefined;
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) this.hoverAt(event);
    });
    canvas.addEventListener("click", (event) => {
      this.clickAt(event);
    });
    canvas.addEventListener("contextmenu", (event) => {
      this.contextmenuAt(event);
    });
    window.addEventListener("click", () => {
      this.hideContextMenu();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.hideContextMenu();
    });
  }

  private hoverAt(event: PointerEvent): void {
    const hit = this.resolve(event);
    const target = hit === undefined ? undefined : selectTarget(hit, event);
    let state = this.interaction;
    state = setHoveredNode(
      state,
      target?.kind === "node"
        ? { instanceId: target.instanceId, nodeId: target.nodeId }
        : undefined,
    );
    state = setHoveredFace(
      state,
      target?.kind === "face"
        ? { instanceId: target.instanceId, elementId: target.elementId, faceKey: target.faceKey }
        : undefined,
    );
    state = setHoveredElement(
      state,
      target?.kind === "element"
        ? { instanceId: target.instanceId, elementId: target.elementId }
        : undefined,
    );
    state = setHoveredInstance(
      state,
      target !== undefined && target.kind !== "part" ? target.instanceId : undefined,
    );
    this.interaction = this.withOverrides(state);
    this.canvas.dataset["hovered"] = targetKey(target);
    this.canvas.dataset["pick"] = targetKey(hit);
    this.view.inspectionPanel.textContent = describePick(hit);
    this.render();
  }

  private clickAt(event: MouseEvent): void {
    const down = this.downPosition;
    this.downPosition = undefined;
    if (down !== undefined && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) {
      return;
    }
    const hit = this.resolve(event);
    if (hit === undefined) return;
    const target = selectTarget(hit, event);
    if (target === undefined) return;
    this.toggleSelection(target);
  }

  private contextmenuAt(event: MouseEvent): void {
    event.preventDefault();
    const hit = this.resolve(event);
    const target = hit === undefined ? undefined : selectTarget(hit, event);
    this.contextTarget = target;
    if (target === undefined) {
      this.hideContextMenu();
      return;
    }
    this.view.inspectionPanel.textContent = describePick(hit);
    this.showContextMenu(target, event.clientX, event.clientY);
  }

  private resolve(event: {
    readonly clientX: number;
    readonly clientY: number;
  }): ResolvedPick | undefined {
    const rect = this.canvas.getBoundingClientRect();
    // The projection (and therefore the pick) works in camera pixel space,
    // which is the canvas's internal size; scale CSS viewport coordinates so
    // taps align with what is drawn even when the canvas is scaled by CSS.
    const camera = this.cameraRef.camera;
    const scaleX = camera.width / Math.max(1, rect.width);
    const scaleY = camera.height / Math.max(1, rect.height);
    const request: PickRequest = {
      runtime: this.runtime,
      camera,
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
    return pick(this.pickScene, request, this.nodeRadius);
  }

  private toggleSelection(target: SelectTarget): void {
    let state = this.interaction;
    switch (target.kind) {
      case "node": {
        const on = state.selectedNodeIds.get(target.instanceId)?.has(target.nodeId) ?? false;
        state = setNodeSelected(
          state,
          { instanceId: target.instanceId, nodeId: target.nodeId },
          !on,
        );
        break;
      }
      case "face": {
        const on = state.selectedFaces.get(target.instanceId)?.has(target.faceKey) ?? false;
        state = setFaceSelected(
          state,
          { instanceId: target.instanceId, elementId: target.elementId, faceKey: target.faceKey },
          !on,
        );
        break;
      }
      case "element": {
        const on = state.selectedElementIds.get(target.instanceId)?.has(target.elementId) ?? false;
        state = setElementSelected(
          state,
          { instanceId: target.instanceId, elementId: target.elementId },
          !on,
        );
        break;
      }
      case "instance": {
        const on = state.selectedInstanceIds.has(target.instanceId);
        state = setInstanceSelected(state, target.instanceId, !on);
        break;
      }
      case "part": {
        const on = state.selectedPartIds.has(target.partId);
        state = setPartSelected(state, target.partId, !on);
        break;
      }
    }
    this.interaction = this.withOverrides(state);
    this.render();
  }

  private toggleHighlight(target: SelectTarget): void {
    let state = this.interaction;
    switch (target.kind) {
      case "node": {
        const on = state.highlightedNodeIds.get(target.instanceId)?.has(target.nodeId) ?? false;
        state = setNodeHighlighted(
          state,
          { instanceId: target.instanceId, nodeId: target.nodeId },
          !on,
        );
        break;
      }
      case "face": {
        const on = state.highlightedFaces.get(target.instanceId)?.has(target.faceKey) ?? false;
        state = setFaceHighlighted(
          state,
          { instanceId: target.instanceId, elementId: target.elementId, faceKey: target.faceKey },
          !on,
        );
        break;
      }
      case "element": {
        const ref: ElementRef = { instanceId: target.instanceId, elementId: target.elementId };
        const has = this.explicitStyle(ref) !== undefined;
        this.setExplicitElementStyle(ref, has ? undefined : { emissive: 0.35 });
        state = this.interaction;
        break;
      }
      case "instance": {
        const on = state.highlightedInstanceIds.has(target.instanceId);
        state = setInstanceHighlighted(state, target.instanceId, !on);
        break;
      }
      case "part": {
        const on = state.highlightedPartIds.has(target.partId);
        state = setPartHighlighted(state, target.partId, !on);
        break;
      }
    }
    this.interaction = this.withOverrides(state);
    this.render();
  }

  private applyMenuAction(action: string): void {
    const target = this.contextTarget;
    switch (action) {
      case "highlight":
        if (target !== undefined) this.toggleHighlight(target);
        break;
      case "select":
        if (target !== undefined) this.toggleSelection(target);
        break;
      case "hide-instance":
        if (target !== undefined) this.toggleInstanceVisibility(target);
        break;
      case "hide-part":
        if (target !== undefined) this.togglePartVisibility(target);
        break;
      case "edges":
        this.setEdges(!this.toggles.edges);
        break;
      case "node-markers":
        this.toggles.nodeMarkers = !this.toggles.nodeMarkers;
        this.render();
        break;
      case "normals":
        this.toggles.normals = !this.toggles.normals;
        this.render();
        break;
      case "face-boundaries":
        this.toggles.faceBoundaries = !this.toggles.faceBoundaries;
        this.render();
        break;
      case "ids":
        this.toggles.ids = !this.toggles.ids;
        this.render();
        break;
      case "diagnostics":
        this.toggles.diagnostics = !this.toggles.diagnostics;
        this.refreshStatus();
        break;
      case "fit-view":
        this.fitView();
        break;
      case "reset":
        this.reset();
        break;
    }
  }

  private toggleInstanceVisibility(target: SelectTarget): void {
    if (target.kind === "part") return;
    const slot = this.slotByInstanceId.get(target.instanceId);
    if (slot === undefined) return;
    const visible = this.runtime.isInstanceVisible(slot);
    const delta = this.runtime.setInstanceVisible(slot, !visible);
    if (delta.changedInstanceIds.length > 0) {
      this.hooks.applyVisibility(this, this.interaction, delta.changedInstanceIds);
    }
    this.render();
  }

  private togglePartVisibility(target: SelectTarget): void {
    const partId = target.kind === "part" ? target.partId : this.partOfInstance(target);
    if (partId === undefined) return;
    this.setPartVisibility(partId, !this.partVisible(partId));
  }

  /** The part owning a target's instance, when resolvable. */
  private partOfInstance(target: SelectTarget): PartId | undefined {
    if (target.kind === "part") return target.partId;
    const slot = this.slotByInstanceId.get(target.instanceId);
    if (slot === undefined) return undefined;
    return this.runtime.instancePartIds[slot];
  }

  private setPartVisibility(partId: PartId, visible: boolean): void {
    const delta = this.runtime.setPartVisible(partId, visible);
    if (delta.changedInstanceIds.length > 0) {
      this.hooks.applyVisibility(this, this.interaction, delta.changedInstanceIds);
    }
    this.syncVisibilityPanel();
    this.render();
  }

  private setAssemblyVisibility(assemblyId: AssemblyId, visible: boolean): void {
    const delta = this.runtime.setAssemblyVisible(assemblyId, visible);
    if (visible) this.assemblyVisible.add(assemblyId);
    else this.assemblyVisible.delete(assemblyId);
    if (delta.changedInstanceIds.length > 0) {
      this.hooks.applyVisibility(this, this.interaction, delta.changedInstanceIds);
    }
    this.syncVisibilityPanel();
    this.render();
  }

  /** Keeps the visibility-panel checkboxes in step with the runtime state. */
  private syncVisibilityPanel(): void {
    for (const input of this.view.visibilityPanel.querySelectorAll<HTMLInputElement>("input")) {
      const partId = input.dataset["partId"];
      if (partId !== undefined) {
        input.checked = this.partVisible(Number(partId));
        continue;
      }
      const assemblyId = input.dataset["assemblyId"];
      if (assemblyId !== undefined) input.checked = this.assemblyVisible.has(Number(assemblyId));
    }
  }

  /** Re-draws the current state and refreshes the status line and datasets. */
  render(): void {
    if (this.disposed) return;
    this.hooks.render(this, this.interaction);
    this.refreshStatus();
    this.refreshSelectedDataset();
    this.canvas.dataset["camera"] = cameraKey(this.cameraRef.camera);
  }

  private refreshStatus(): void {
    const stats = this.hooks.stats(this);
    const info: StatusInfo = {
      model: this.preset.name,
      renderer: this.rendererName,
      rendererState: this.rendererState,
      visibleInstances: stats.visibleInstances,
      parts: this.preset.scene.parts.size,
      batches: stats.batches,
      mode: this.mode,
    };
    updateStatus(this.view, this.cameraRef.camera, info);
    this.view.statsPanel.textContent = this.statsText(stats);
  }

  private statsText(stats: RendererStats): string {
    const partLines: string[] = [];
    for (const partId of sortedNumbers(this.partFirstSlot.keys())) {
      const slot = this.partFirstSlot.get(partId);
      if (slot === undefined) continue;
      const visible = this.runtime.instancePartVisible[slot] === 1;
      partLines.push(
        `Part ${partId} ${this.preset.partNames.get(partId) ?? ""} · ${visible ? "shown" : "hidden"}`,
      );
    }
    const diagnostics = this.toggles.diagnostics ? `\n\n${partLines.join("\n")}` : "";
    return (
      `Model ${this.preset.name} (${this.preset.id})\n` +
      `Renderer ${this.rendererName}\n` +
      `Visible instances ${stats.visibleInstances}\n` +
      `Reusable parts ${this.preset.scene.parts.size}\n` +
      `Draw batches ${stats.batches}\n` +
      `Mode ${this.mode}\n` +
      `Selections ${this.selectedKeys().length}` +
      diagnostics
    );
  }

  private refreshSelectedDataset(): void {
    this.canvas.dataset["selected"] = this.selectedKeys().join(",");
  }

  private selectedKeys(): string[] {
    const keys: string[] = [];
    const { interaction } = this;
    for (const [instanceId, ids] of sortedMap(interaction.selectedNodeIds)) {
      for (const nodeId of sortedNumbers(ids)) keys.push(`n:${instanceId}:${nodeId}`);
    }
    for (const [instanceId, faces] of sortedMap(interaction.selectedFaces)) {
      for (const [faceKey, elementId] of sortedFaces(faces)) {
        keys.push(`f:${instanceId}:${elementId}:${faceKey}`);
      }
    }
    for (const [instanceId, ids] of sortedMap(interaction.selectedElementIds)) {
      for (const elementId of sortedNumbers(ids)) keys.push(`e:${instanceId}:${elementId}`);
    }
    for (const instanceId of sortedStrings(interaction.selectedInstanceIds)) {
      keys.push(`i:${instanceId}`);
    }
    for (const partId of sortedNumbers(interaction.selectedPartIds)) {
      keys.push(`p:${partId}`);
    }
    return keys;
  }

  private populateModelSelect(): void {
    const select = this.view.modelSelect;
    select.textContent = "";
    for (const preset of this.presets) {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.name;
      select.appendChild(option);
    }
    select.value = this.preset.id;
  }

  private populateVisibilityPanel(): void {
    const panel = this.view.visibilityPanel;
    panel.textContent = "";
    const parts = document.createElement("div");
    parts.className = "visibility-list";
    for (const partId of sortedNumbers(this.preset.scene.parts.keys())) {
      parts.appendChild(
        this.visibilityToggle({
          kind: "part",
          id: partId,
          checked: this.partVisible(partId),
          label: this.preset.partNames.get(partId) ?? `Part ${partId}`,
        }),
      );
    }
    const assemblies = document.createElement("div");
    assemblies.className = "visibility-list";
    for (const assembly of this.preset.scene.assemblies.values()) {
      const name = (assembly as { readonly name?: string }).name ?? `Assembly ${assembly.id}`;
      assemblies.appendChild(
        this.visibilityToggle({
          kind: "assembly",
          id: assembly.id,
          checked: this.assemblyVisible.has(assembly.id),
          label: name,
        }),
      );
    }
    panel.append(parts, assemblies);
  }

  private visibilityToggle(options: {
    readonly kind: "part" | "assembly";
    readonly id: number;
    readonly checked: boolean;
    readonly label: string;
  }): HTMLLabelElement {
    const { kind, id, checked, label } = options;
    const element = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    if (kind === "part") {
      input.dataset["partId"] = String(id);
      input.dataset["testid"] = `part-vis-${id}`;
    } else {
      input.dataset["assemblyId"] = String(id);
      input.dataset["testid"] = `assembly-vis-${id}`;
    }
    element.append(input, document.createTextNode(label));
    return element;
  }

  private partVisible(partId: PartId): boolean {
    const slot = this.partFirstSlot.get(partId);
    if (slot === undefined) return false;
    return this.runtime.instancePartVisible[slot] === 1;
  }

  private explicitStyle(ref: ElementRef): StyleOverride | undefined {
    return this.explicitElementOverrides.get(ref.instanceId)?.get(ref.elementId);
  }

  private setExplicitElementStyle(ref: ElementRef, style: StyleOverride | undefined): void {
    const elements = new Map(this.explicitElementOverrides.get(ref.instanceId) ?? []);
    if (style === undefined) elements.delete(ref.elementId);
    else elements.set(ref.elementId, style);
    if (elements.size === 0) this.explicitElementOverrides.delete(ref.instanceId);
    else this.explicitElementOverrides.set(ref.instanceId, elements);
  }

  private withOverrides(state: InteractionState): InteractionState {
    return rebuildElementOverrides(state, this.emphasisContext, this.explicitElementOverrides);
  }

  private showContextMenu(target: SelectTarget, x: number, y: number): void {
    const menu = this.view.contextMenu;
    menu.textContent = "";
    const title = document.createElement("div");
    title.className = "menu-title";
    title.textContent = targetLabel(target);
    menu.appendChild(title);
    this.menuButton(menu, "Highlight / Clear", "highlight");
    this.menuButton(menu, "Select / Deselect", "select");
    this.menuButton(menu, "Hide / Show instance", "hide-instance");
    this.menuButton(menu, "Hide / Show part", "hide-part");
    this.menuSection(menu, "Display");
    this.menuButton(menu, this.toggles.edges ? "Hide edges" : "Overlay edges", "edges");
    this.menuOverlayToggle(menu, "Node markers", "node-markers", this.toggles.nodeMarkers);
    this.menuOverlayToggle(menu, "Normals", "normals", this.toggles.normals);
    this.menuOverlayToggle(menu, "Face boundaries", "face-boundaries", this.toggles.faceBoundaries);
    this.menuOverlayToggle(menu, "IDs", "ids", this.toggles.ids);
    this.menuButton(
      menu,
      this.toggles.diagnostics ? "Diagnostics off" : "Diagnostics on",
      "diagnostics",
    );
    this.menuSection(menu, "View");
    this.menuButton(menu, "Fit to view", "fit-view");
    this.menuButton(menu, "Reset", "reset");
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.hidden = false;
    this.clampMenuToViewport(x, y);
  }

  /** Keeps a just-opened context menu fully inside the viewport. */
  private clampMenuToViewport(x: number, y: number): void {
    const menu = this.view.contextMenu;
    const rect = menu.getBoundingClientRect();
    const margin = 8;
    const maxX = window.innerWidth - rect.width - margin;
    const maxY = window.innerHeight - rect.height - margin;
    menu.style.left = `${Math.min(x, Math.max(margin, maxX))}px`;
    menu.style.top = `${Math.min(y, Math.max(margin, maxY))}px`;
  }

  private menuButton(menu: HTMLElement, label: string, action: string, disabled = false): void {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset["action"] = action;
    button.disabled = disabled;
    menu.appendChild(button);
  }

  /**
   * Adds a display-overlay toggle (node markers, normals, face boundaries, or
   * IDs). When the active renderer does not draw the overlays, the button is
   * disabled and annotated instead of silently doing nothing on click.
   */
  private menuOverlayToggle(
    menu: HTMLElement,
    label: string,
    action: string,
    enabled: boolean,
  ): void {
    if (!this.displayOverlays) {
      this.menuButton(menu, `${label} · CPU renderer only`, action, true);
      return;
    }
    this.menuButton(menu, `${label} ${enabled ? "off" : "on"}`, action);
  }

  private menuSection(menu: HTMLElement, title: string): void {
    const section = document.createElement("div");
    section.className = "menu-section";
    const label = document.createElement("div");
    label.className = "menu-title";
    label.textContent = title;
    section.appendChild(label);
    menu.appendChild(section);
  }

  private hideContextMenu(): void {
    this.view.contextMenu.hidden = true;
  }

  private reflectEdges(): void {
    this.view.edgeOverlayLabel.textContent = this.toggles.edges ? "On" : "Off";
    this.view.edgeOverlayToggle.textContent = this.toggles.edges ? "Hide edges" : "Overlay edges";
  }

  private reflectDepthTest(): void {
    const state = depthTestUiState(this.supportsEdgeDepthTest, this.depthTestEnabled);
    this.view.depthTestLabel.textContent = state.label;
    this.view.depthTestToggle.textContent = state.buttonText;
    this.view.depthTestToggle.disabled = state.disabled;
  }
}

/** How the Depth test control presents itself for a renderer capability. */
export interface DepthTestUiState {
  readonly disabled: boolean;
  readonly label: string;
  readonly buttonText: string;
}

/**
 * The Depth test control must not silently toggle a no-op: a renderer without
 * depth-tested edge rendering gets a disabled, annotated control, while a
 * capable renderer keeps the working on/off toggle.
 */
export function depthTestUiState(supported: boolean, enabled: boolean): DepthTestUiState {
  if (!supported) {
    return {
      disabled: true,
      label: "WebGPU only",
      buttonText: "Depth test · WebGPU only",
    };
  }
  return {
    disabled: false,
    label: enabled ? "On" : "Off",
    buttonText: enabled ? "Depth test off" : "Depth test on",
  };
}

/** Fallback preset used only if the preset list is somehow empty. */
function createEmptyPreset(): ModelPreset {
  return createModelPresets()[0] as ModelPreset;
}

/** Compact camera pose key for e2e assertions on gesture-driven movement. */
function cameraKey(camera: Camera): string {
  const position = camera.position.map((value) => value.toFixed(3)).join(",");
  const target = camera.target.map((value) => value.toFixed(3)).join(",");
  return `p:${position} t:${target} o:${camera.orthoHeight.toFixed(3)}`;
}

function targetLabel(target: SelectTarget): string {
  switch (target.kind) {
    case "node":
      return `Node ${target.nodeId}`;
    case "face":
      return `Face ${target.faceKey}`;
    case "element":
      return `Element ${target.elementId}`;
    case "instance":
      return `Instance ${target.instanceId}`;
    case "part":
      return `Part ${target.partId}`;
  }
}

function sortedMap<K, V>(map: ReadonlyMap<K, V>): Array<readonly [K, V]> {
  return [...map.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

function sortedNumbers(values: Iterable<number>): number[] {
  return [...values].sort((a, b) => a - b);
}

function sortedStrings(values: Iterable<string>): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function sortedFaces(faces: ReadonlyMap<string, ElementId>): Array<readonly [string, ElementId]> {
  return [...faces.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
