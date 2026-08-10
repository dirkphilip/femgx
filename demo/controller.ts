import {
  clientToCanvasCss,
  createInteractionState,
  setElementOverride,
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
  fitCamera,
  type Camera,
  type Color,
  type ElementId,
  type ElementRef,
  type ElementRenderMode,
  type InstanceId,
  type InteractionState,
  type PartId,
  type PickTarget,
  type FemViewport,
  type SceneRuntime,
} from "../src/index";
import { updateAxisGizmo } from "./axis-gizmo";
import { visiblePartIdsForPreset, type ModelPreset } from "./fixture/presets";
import { describePick } from "./inspect";
import { selectTarget, targetKey, type SelectTarget } from "./pick";
import { selectedWorldBounds } from "./selection-bounds";
import { updateStatus, type DemoView, type StatusInfo } from "./view";
import { assemblyName } from "./visibility-tree";

/** Current draw statistics reported by the active renderer. */
export interface RendererStats {
  readonly visibleInstances: number;
  readonly batches: number;
}

/** Display toggles shared by the control bar and context menu. */
export interface DisplayToggles {
  edges: boolean;
  nodes: boolean;
  diagnostics: boolean;
}

/** Options for the shared inspection workbench controller. */
export interface WorkbenchOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly viewport: FemViewport;
  readonly presets: readonly ModelPreset[];
}

/**
 * Presentation policy for the demo workbench. Reusable scene, camera,
 * interaction, rendering, picking, and lifecycle behavior belongs to the
 * library-owned {@link FemViewport}.
 */
export class WorkbenchController {
  readonly canvas: HTMLCanvasElement;
  readonly view: DemoView;
  readonly rendererName: string;
  preset: ModelPreset;
  mode: ElementRenderMode;
  toggles: DisplayToggles;
  interaction: InteractionState;
  /** Renderer-state note shown in the status line (e.g. "recovered"). */
  rendererState = "";
  private viewport: FemViewport;
  private readonly presets: readonly ModelPreset[];
  private readonly slotByInstanceId = new Map<InstanceId, number>();
  private readonly partIdByInstanceId = new Map<InstanceId, PartId>();
  private readonly partFirstSlot = new Map<PartId, number>();
  private depthTestEnabled = true;
  private contextTarget: SelectTarget | undefined;
  private dragging = false;
  private downPosition: { readonly x: number; readonly y: number } | undefined;
  private disposed = false;
  /** Ignores stale async GPU pick results when a newer pointer event arrived. */
  private pickGeneration = 0;

  constructor(options: WorkbenchOptions) {
    this.view = options.view;
    this.canvas = options.canvas;
    this.rendererName = options.rendererName;
    this.viewport = options.viewport;
    this.presets = options.presets;
    const initialPreset = this.presets[0];
    if (initialPreset === undefined) throw new Error("Workbench requires at least one preset");
    this.preset = initialPreset;
    this.mode = "solid";
    this.toggles = {
      edges: false,
      nodes: false,
      diagnostics: false,
    };
    this.interaction = this.createPresetInteraction(this.preset);
    this.viewport.setInteraction(this.interaction);
    this.indexRuntime();
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

  get runtime(): SceneRuntime {
    return this.viewport.runtime;
  }

  get camera(): Camera {
    return this.viewport.camera;
  }

  /** Reattaches the presentation shell after the e2e lifecycle seam recreates the viewport. */
  setViewport(viewport: FemViewport): void {
    this.viewport = viewport;
    this.viewport.setInteraction(this.interaction);
    this.viewport.setEdgeDepthTest(this.depthTestEnabled);
    this.viewport.setNodeOverlay(this.toggles.nodes);
    this.indexRuntime();
    this.applyModeVisibility();
    this.populateVisibilityPanel();
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
    this.refreshStatus();
    this.refreshSelectedDataset();
    this.canvas.dataset["camera"] = cameraKey(this.viewport.camera);
    updateAxisGizmo(this.view.axisGizmo, this.viewport.camera);
  }

  /** Switches to another deterministic model preset and rebuilds state. */
  setPreset(id: string): void {
    if (id === this.preset.id) return;
    const preset = this.presets.find((candidate) => candidate.id === id);
    if (preset === undefined) return;
    this.preset = preset;
    this.mode = "solid";
    this.interaction = this.createPresetInteraction(preset);
    this.contextTarget = undefined;
    this.viewport.setScene(preset.scene);
    this.viewport.setInteraction(this.interaction);
    this.indexRuntime();
    this.applyModeVisibility();
    this.populateVisibilityPanel();
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
    this.populateVisibilityPanel();
    this.canvas.dataset["mode"] = mode;
    this.render();
  }

  /** Applies the preset's per-mode part visibility to the runtime. */
  private applyModeVisibility(mode: ElementRenderMode = this.mode): void {
    const visible = visiblePartIdsForPreset(this.preset, mode);
    for (const partId of this.preset.scene.parts.keys()) {
      this.viewport.setPartVisible(partId, visible.has(partId));
    }
    this.syncVisibilityPanel();
  }

  /** Applies or clears the wireframe edge overlay across every part. */
  setEdges(enabled: boolean): void {
    if (this.toggles.edges === enabled) return;
    this.toggles.edges = enabled;
    let state = this.interaction;
    for (const partId of this.preset.scene.parts.keys()) {
      state = setPartOverride(state, partId, this.partStyleOverride(partId, enabled));
    }
    this.interaction = state;
    this.reflectEdges();
    this.render();
  }

  /** Shows one small glyph at every visible finite-element node. */
  setNodes(enabled: boolean): void {
    if (this.toggles.nodes === enabled) return;
    this.toggles.nodes = enabled;
    this.viewport.setNodeOverlay(enabled);
    this.reflectNodes();
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

  /** Clears interaction state and restores the initial camera pose. */
  reset(): void {
    this.interaction = this.createPresetInteraction(this.preset);
    this.contextTarget = undefined;
    this.viewport.fitView();
    this.viewport.setCamera(setProjection(this.viewport.camera, "perspective"));
    this.canvas.dataset["hovered"] = "";
    this.canvas.dataset["selected"] = "";
    this.canvas.dataset["pick"] = "";
    this.view.inspectionPanel.textContent = describePick(undefined, (partId) =>
      this.partName(partId),
    );
    this.render();
  }

  /** Applies the preset palette through the existing per-part style path. */
  private createPresetInteraction(preset: ModelPreset): InteractionState {
    let state = createInteractionState();
    for (const partId of preset.scene.parts.keys()) {
      state = setPartOverride(state, partId, {
        color: preset.partColors.get(partId) ?? preset.fallbackColor,
      });
    }
    return state;
  }

  /** Keeps the palette intact while toggling the wireframe edge overlay. */
  private partStyleOverride(partId: PartId, edges: boolean): { color: Color; edge?: true } {
    return {
      color: this.preset.partColors.get(partId) ?? this.preset.fallbackColor,
      ...(edges ? { edge: true } : {}),
    };
  }

  /** Releases listeners owned by the controller and the renderer teardown hook. */
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pickGeneration += 1;
    this.viewport.destroy();
  }

  private indexRuntime(): void {
    this.slotByInstanceId.clear();
    this.partIdByInstanceId.clear();
    this.partFirstSlot.clear();
    for (let slot = 0; slot < this.runtime.instanceCount; slot++) {
      const instanceId = this.runtime.getInstanceId(slot);
      const partId = this.runtime.instancePartIds[slot];
      if (instanceId !== undefined) {
        this.slotByInstanceId.set(instanceId, slot);
        if (partId !== undefined) this.partIdByInstanceId.set(instanceId, partId);
      }
      if (partId !== undefined && !this.partFirstSlot.has(partId)) {
        this.partFirstSlot.set(partId, slot);
      }
    }
  }

  private installControls(): void {
    const view = this.view;
    view.projectionToggle.addEventListener("click", () => {
      this.viewport.setCamera(
        setProjection(
          this.viewport.camera,
          this.viewport.camera.mode === "perspective" ? "orthographic" : "perspective",
        ),
      );
      this.render();
    });
    view.edgeOverlayToggle.addEventListener("click", () => {
      this.setEdges(!this.toggles.edges);
    });
    view.depthTestToggle.addEventListener("click", () => {
      this.viewport.setEdgeDepthTest(!this.depthTestEnabled);
      this.depthTestEnabled = !this.depthTestEnabled;
      this.reflectDepthTest();
    });
    view.nodeOverlayToggle.addEventListener("click", () => {
      this.setNodes(!this.toggles.nodes);
    });
    view.resetButton.addEventListener("click", () => {
      this.reset();
    });
    view.fitView.addEventListener("click", () => {
      this.fitView();
    });
    view.modelSelect.addEventListener("change", () => {
      this.setPreset(view.modelSelect.value);
    });
    view.visibilityPanel.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const partId = target.dataset["partId"];
      const assemblyNodeId = target.dataset["assemblyNodeId"];
      if (partId !== undefined) this.setPartVisibility(Number(partId), target.checked);
      else if (assemblyNodeId !== undefined) {
        this.setAssemblyNodeVisibility(Number(assemblyNodeId), target.checked);
      } else {
        const instanceSlot = target.dataset["instanceSlot"];
        if (instanceSlot !== undefined)
          this.setInstanceVisibility(Number(instanceSlot), target.checked);
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
    this.reflectNodes();
  }

  private installCanvasInteraction(): void {
    const canvas = this.canvas;
    canvas.addEventListener("pointerdown", (event) => {
      this.downPosition = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener("pointercancel", () => {
      this.downPosition = undefined;
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) void this.hoverAt(event);
    });
    canvas.addEventListener("click", (event) => {
      void this.clickAt(event);
    });
    canvas.addEventListener("contextmenu", (event) => {
      void this.contextmenuAt(event);
    });
    window.addEventListener("click", () => {
      this.hideContextMenu();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.hideContextMenu();
      else if (event.key.toLowerCase() === "z" && !isEditableTarget(event.target)) {
        event.preventDefault();
        this.fitSelection();
      }
    });
  }

  private async hoverAt(event: PointerEvent): Promise<void> {
    const generation = ++this.pickGeneration;
    const hit = await this.resolve(event);
    if (generation !== this.pickGeneration || this.disposed) return;
    const target =
      hit === undefined
        ? undefined
        : selectTarget(hit, event, (id) => this.partIdByInstanceId.get(id));
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
    this.interaction = state;
    this.canvas.dataset["hovered"] = targetKey(target);
    this.canvas.dataset["pick"] = targetKey(hit);
    this.view.inspectionPanel.textContent = describePick(
      hit,
      (partId) => this.partName(partId),
      (id) => this.partIdByInstanceId.get(id),
    );
    this.render();
  }

  private async clickAt(event: MouseEvent): Promise<void> {
    const down = this.downPosition;
    this.downPosition = undefined;
    // Ignore camera-drag releases; allow small pointer jitter between down/up.
    if (down !== undefined && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 10) {
      return;
    }
    const generation = ++this.pickGeneration;
    const hit = await this.resolve(event);
    if (generation !== this.pickGeneration || this.disposed || hit === undefined) return;
    const target = selectTarget(hit, event, (id) => this.partIdByInstanceId.get(id));
    if (target === undefined) return;
    this.toggleSelection(target);
  }

  private async contextmenuAt(event: MouseEvent): Promise<void> {
    event.preventDefault();
    const generation = ++this.pickGeneration;
    const hit = await this.resolve(event);
    if (generation !== this.pickGeneration || this.disposed) return;
    const target =
      hit === undefined
        ? undefined
        : selectTarget(hit, event, (id) => this.partIdByInstanceId.get(id));
    this.contextTarget = target;
    if (target === undefined) {
      this.hideContextMenu();
      return;
    }
    this.view.inspectionPanel.textContent = describePick(
      hit,
      (partId) => this.partName(partId),
      (id) => this.partIdByInstanceId.get(id),
    );
    this.showContextMenu(target, event.clientX, event.clientY);
  }

  private async resolve(event: {
    readonly clientX: number;
    readonly clientY: number;
  }): Promise<PickTarget | undefined> {
    const rect = this.canvas.getBoundingClientRect();
    const point = clientToCanvasCss(event.clientX, event.clientY, rect);
    return this.viewport.pick(point.x, point.y);
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
    this.interaction = state;
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
        const has = state.elementOverrides.get(ref.instanceId)?.has(ref.elementId) ?? false;
        state = setElementOverride(state, ref, has ? undefined : { emissive: 0.35 });
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
    this.interaction = state;
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
    this.viewport.setInstanceVisible(slot, !visible);
    this.syncVisibilityPanel();
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
    this.viewport.setPartVisible(partId, visible);
    this.syncVisibilityPanel();
    this.render();
  }

  /** Applies a visibility override to one placement from the expanded component tree. */
  private setInstanceVisibility(slot: number, visible: boolean): void {
    this.viewport.setInstanceVisible(slot, visible);
    this.syncVisibilityPanel();
    this.render();
  }

  private setAssemblyNodeVisibility(nodeId: number, visible: boolean): void {
    this.viewport.setAssemblyNodeVisible(nodeId, visible);
    this.syncVisibilityPanel();
    this.render();
  }

  /** Keeps the visibility-panel checkboxes in step with the runtime state. */
  private syncVisibilityPanel(): void {
    for (const input of this.view.visibilityPanel.querySelectorAll<HTMLInputElement>("input")) {
      const partId = input.dataset["partId"];
      if (partId !== undefined) {
        input.checked = this.partVisible(Number(partId));
        input.indeterminate = false;
        continue;
      }
      const assemblyNodeId = input.dataset["assemblyNodeId"];
      if (assemblyNodeId !== undefined) {
        const nodeId = Number(assemblyNodeId);
        input.checked = this.runtime.nodeEffectiveVisible[nodeId] === 1;
        input.indeterminate = false;
        const parent = this.runtime.nodeParents[nodeId] ?? -1;
        input.disabled = parent !== -1 && this.runtime.nodeEffectiveVisible[parent] !== 1;
        continue;
      }
      const instanceSlot = input.dataset["instanceSlot"];
      if (instanceSlot !== undefined) {
        const slot = Number(instanceSlot);
        input.checked = this.runtime.isInstanceVisible(slot);
        input.indeterminate = false;
        const owningNode = this.runtime.instanceOwningNode[slot];
        input.disabled =
          owningNode === undefined ||
          this.runtime.nodeEffectiveVisible[owningNode] !== 1 ||
          this.runtime.instancePartVisible[slot] !== 1;
      }
    }
  }

  /** Re-draws the current state and refreshes the status line and datasets. */
  render(): void {
    if (this.disposed) return;
    this.viewport.setInteraction(this.interaction);
    this.syncViewportPresentation();
  }

  private refreshStatus(): void {
    const viewportStats = this.viewport.stats();
    const stats: RendererStats = {
      visibleInstances: viewportStats.visibleInstances,
      batches: viewportStats.drawBatches,
    };
    const info: StatusInfo = {
      model: this.preset.name,
      renderer: this.rendererName,
      rendererState: this.rendererState,
      visibleInstances: stats.visibleInstances,
      parts: this.preset.scene.parts.size,
      batches: stats.batches,
      mode: this.mode,
    };
    updateStatus(this.view, this.viewport.camera, info);
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
      `Visible triangles ${formatCount(this.visibleTriangleCount())}\n` +
      `Reusable parts ${this.preset.scene.parts.size}\n` +
      `Draw batches ${stats.batches}\n` +
      `Mode ${this.mode}\n` +
      `Selections ${this.selectedKeys().length}` +
      diagnostics
    );
  }

  /** Triangle count after runtime visibility, including every instance draw. */
  private visibleTriangleCount(): number {
    let triangles = 0;
    for (let slot = 0; slot < this.runtime.instanceCount; slot++) {
      if (!this.runtime.isInstanceVisible(slot)) continue;
      const partId = this.runtime.instancePartIds[slot];
      const part = partId === undefined ? undefined : this.preset.scene.parts.get(partId);
      triangles += part === undefined ? 0 : Math.floor(part.geometry.indices.length / 3);
    }
    return triangles;
  }

  /** Unique triangles stored across the preset's reusable part definitions. */
  uniqueTriangleCount(): number {
    let triangles = 0;
    for (const part of this.preset.scene.parts.values()) {
      triangles += Math.floor(part.geometry.indices.length / 3);
    }
    return triangles;
  }

  /** Submitted triangles authored by this preset, before temporary visibility changes. */
  submittedTriangleCount(): number {
    let triangles = 0;
    for (let slot = 0; slot < this.runtime.instanceCount; slot++) {
      const partId = this.runtime.instancePartIds[slot];
      const part = partId === undefined ? undefined : this.preset.scene.parts.get(partId);
      triangles += part === undefined ? 0 : Math.floor(part.geometry.indices.length / 3);
    }
    return triangles;
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

  /**
   * Builds the hierarchy from expanded runtime assembly occurrences, so repeated
   * assembly definitions remain distinct controls in the demo.
   */
  private populateVisibilityPanel(): void {
    const panel = this.view.visibilityPanel;
    panel.textContent = "";
    const rootAssemblyId = this.preset.scene.rootAssemblyId;
    const context = document.createElement("div");
    context.className = "visibility-context";
    context.dataset["testid"] = "visibility-context";
    context.textContent = `Assembly · ${assemblyName(this.preset.scene.assemblies.get(rootAssemblyId)) ?? `Assembly ${rootAssemblyId}`}`;
    panel.appendChild(context);
    panel.appendChild(this.assemblyNode(0, visiblePartIdsForPreset(this.preset, this.mode)));
    this.syncVisibilityPanel();
  }

  /**
   * Builds one expanded assembly occurrence. Its direct part placements stay
   * under that occurrence rather than being regrouped by reusable part id.
   */
  private assemblyNode(nodeId: number, visibleParts: ReadonlySet<PartId>): HTMLElement {
    const assemblyId = this.runtime.nodeAssemblyIds[nodeId];
    if (assemblyId === undefined) {
      throw new Error(`Missing assembly id for runtime node ${nodeId}`);
    }
    const assembly = this.preset.scene.assemblies.get(assemblyId);
    const name = assemblyName(assembly) ?? `Assembly ${assemblyId}`;
    const displayName = this.assemblyOccurrenceName(nodeId, name);
    const branch = document.createElement("div");
    branch.className = "visibility-branch";

    const row = document.createElement("div");
    row.className = "visibility-row visibility-assembly";

    const expander = document.createElement("button");
    expander.type = "button";
    expander.className = "visibility-expander";
    expander.dataset["testid"] = `assembly-expand-${nodeId}`;
    expander.setAttribute("aria-expanded", "true");
    expander.setAttribute("aria-label", `Collapse ${displayName}`);
    expander.textContent = "▾";

    const children = document.createElement("div");
    children.className = "visibility-children";
    const directSlots = this.directPartSlots(nodeId, visibleParts);
    for (let index = 0; index < directSlots.length; index++) {
      const slot = directSlots[index];
      if (slot !== undefined) children.appendChild(this.partNode(slot, index + 1, directSlots));
    }
    let child = this.runtime.nodeFirstChild[nodeId] ?? -1;
    while (child !== -1) {
      children.appendChild(this.assemblyNode(child, visibleParts));
      child = this.runtime.nodeNextSibling[child] ?? -1;
    }
    expander.addEventListener("click", () => {
      this.toggleAssemblyExpanded(expander, children, displayName);
    });

    const label = this.rowLabel("assembly-node", nodeId, displayName);
    row.append(expander, label);
    branch.append(row, children);
    return branch;
  }

  /** Builds one directly placed part row nested beneath its assembly occurrence. */
  private partNode(slot: number, index: number, siblings: readonly number[]): HTMLElement {
    const partId = this.runtime.instancePartIds[slot];
    const name = this.partName(partId ?? -1) ?? `Part ${partId}`;
    const repeated =
      siblings.filter((item) => this.runtime.instancePartIds[item] === partId).length > 1;
    const row = document.createElement("div");
    row.className = "visibility-row visibility-part";
    const spacer = document.createElement("span");
    spacer.className = "visibility-spacer";
    spacer.setAttribute("aria-hidden", "true");
    row.append(
      spacer,
      this.rowLabel("instance", slot, repeated ? `${name} ${index}` : name, "Part"),
    );
    return row;
  }

  private directPartSlots(nodeId: number, visibleParts: ReadonlySet<PartId>): number[] {
    const slots: number[] = [];
    for (let slot = 0; slot < this.runtime.instanceCount; slot++) {
      const partId = this.runtime.instancePartIds[slot];
      if (
        this.runtime.instanceOwningNode[slot] === nodeId &&
        partId !== undefined &&
        visibleParts.has(partId)
      ) {
        slots.push(slot);
      }
    }
    return slots;
  }

  private assemblyOccurrenceName(nodeId: number, name: string): string {
    const parent = this.runtime.nodeParents[nodeId] ?? -1;
    if (parent === -1) return name;
    const assemblyId = this.runtime.nodeAssemblyIds[nodeId];
    let occurrence = 0;
    let total = 0;
    let sibling = this.runtime.nodeFirstChild[parent] ?? -1;
    while (sibling !== -1) {
      if (this.runtime.nodeAssemblyIds[sibling] === assemblyId) {
        total++;
        if (sibling === nodeId) occurrence = total;
      }
      sibling = this.runtime.nodeNextSibling[sibling] ?? -1;
    }
    return total > 1 ? `${name} ${occurrence}` : name;
  }

  /** Builds a checkbox label row with an explicit identity-kind badge. */
  private rowLabel(
    kind: "part" | "assembly-node" | "instance",
    id: number,
    name: string,
    badgeText?: "Part",
  ): HTMLLabelElement {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    if (kind === "part") {
      input.dataset["partId"] = String(id);
      input.dataset["testid"] = `part-vis-${id}`;
    } else if (kind === "assembly-node") {
      input.dataset["assemblyNodeId"] = String(id);
      input.dataset["testid"] = `assembly-node-vis-${id}`;
    } else {
      input.dataset["instanceSlot"] = String(id);
      const instanceId = this.runtime.getInstanceId(id);
      if (instanceId !== undefined) input.dataset["instanceId"] = instanceId;
      input.dataset["testid"] = `instance-vis-${id}`;
    }
    label.append(input);
    const badge = document.createElement("span");
    badge.className = "visibility-kind";
    badge.textContent =
      badgeText ?? (kind === "part" ? "Part" : kind === "assembly-node" ? "Assembly" : "Instance");
    label.append(badge);
    const text = document.createElement("span");
    text.className = "visibility-label";
    text.textContent = name;
    label.append(text);
    return label;
  }

  /** Collapses or expands one assembly branch of the visibility tree. */
  private toggleAssemblyExpanded(
    expander: HTMLButtonElement,
    children: HTMLElement,
    name: string,
  ): void {
    const expanded = children.hidden;
    children.hidden = !expanded;
    expander.setAttribute("aria-expanded", String(expanded));
    expander.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${name}`);
    expander.textContent = expanded ? "▾" : "▸";
  }

  private partVisible(partId: PartId): boolean {
    const slot = this.partFirstSlot.get(partId);
    if (slot === undefined) return false;
    return this.runtime.instancePartVisible[slot] === 1;
  }

  /** Human-readable part name for the inspection panel, when known. */
  private partName(partId: PartId): string | undefined {
    return this.preset.partNames.get(partId);
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

  /**
   * Adds a display toggle to the context menu.
   */
  private menuButton(menu: HTMLElement, label: string, action: string, disabled = false): void {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset["action"] = action;
    button.disabled = disabled;
    menu.appendChild(button);
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
    this.view.edgeOverlayLabel.dataset["state"] = this.toggles.edges ? "on" : "off";
    this.view.edgeOverlayToggle.dataset["active"] = String(this.toggles.edges);
    this.view.edgeOverlayToggle.setAttribute("aria-pressed", String(this.toggles.edges));
    this.view.edgeOverlayToggle.textContent = this.toggles.edges ? "Hide edges" : "Overlay edges";
  }

  private reflectNodes(): void {
    this.view.nodeOverlayLabel.textContent = this.toggles.nodes ? "On" : "Off";
    this.view.nodeOverlayLabel.dataset["state"] = this.toggles.nodes ? "on" : "off";
    this.view.nodeOverlayToggle.dataset["active"] = String(this.toggles.nodes);
    this.view.nodeOverlayToggle.ariaPressed = String(this.toggles.nodes);
    this.view.nodeOverlayToggle.textContent = this.toggles.nodes
      ? "Hide element nodes"
      : "Show element nodes";
  }

  private reflectDepthTest(): void {
    this.view.depthTestLabel.textContent = this.depthTestEnabled ? "On" : "Off";
    this.view.depthTestLabel.dataset["state"] = this.depthTestEnabled ? "on" : "off";
    this.view.depthTestToggle.dataset["active"] = String(this.depthTestEnabled);
    this.view.depthTestToggle.setAttribute("aria-pressed", String(this.depthTestEnabled));
    this.view.depthTestToggle.textContent = this.depthTestEnabled
      ? "Depth test off"
      : "Depth test on";
  }
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

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
