import type { Viewport } from "../../../src/entries/root";
import type { InteractionState } from "../../../src/entries/interaction";
import type { DemoView, WorkbenchPane, ViewportSlotId } from "./view";
import { errorMessage, type WorkbenchModel } from "../models/model";
import type { TouchInteractionMode, WorkbenchOptions } from "../types";
import type { SelectionGranularity } from "../selection/pick";
import type { WorkbenchMenu } from "../interaction/menu";
import { WorkbenchBoxPreview } from "../selection/box-preview";
import { WorkbenchInteraction } from "../interaction/interaction";
import { WorkbenchRenderLoop } from "./render-loop";
import { installWorkbenchPaneLifecycle } from "../lifecycle";

export interface WorkbenchViewportSlot {
  readonly id: ViewportSlotId;
  readonly pane: WorkbenchPane;
  readonly interaction: WorkbenchInteraction;
  readonly boxPreview: WorkbenchBoxPreview;
  readonly renderLoop: WorkbenchRenderLoop;
  viewport: Viewport;
  dragging: boolean;
  removePaneBindings?: () => void;
}

interface WorkbenchViewportSlotsOptions {
  readonly view: DemoView;
  readonly primaryViewport: Viewport;
  readonly primaryInteraction: WorkbenchInteraction;
  readonly primaryBoxPreview: WorkbenchBoxPreview;
  readonly createViewport: WorkbenchOptions["createViewport"];
  readonly getModel: () => WorkbenchModel;
  readonly getInteraction: (slotId: ViewportSlotId) => InteractionState;
  readonly setInteraction: (slotId: ViewportSlotId, value: InteractionState) => void;
  readonly canClearCanvasHover: (slotId: ViewportSlotId) => boolean;
  readonly markCanvasHover: (slotId: ViewportSlotId) => void;
  readonly clearCanvasHover: (slotId: ViewportSlotId) => void;
  readonly selectionGranularity: (slotId: ViewportSlotId) => SelectionGranularity;
  readonly touchInteractionMode: (slotId: ViewportSlotId) => TouchInteractionMode;
  readonly menu: WorkbenchMenu;
  readonly render: () => void;
  readonly applyActiveState: () => void;
  readonly applyState: (slotId: ViewportSlotId) => void;
  readonly cloneShowState: (from: ViewportSlotId, to: ViewportSlotId) => void;
  readonly removeShowState: (slotId: ViewportSlotId) => void;
  readonly rebuildVisibility: () => void;
  readonly feedback: (message: string) => void;
  readonly setInspection: (slotId: ViewportSlotId, text: string, visible: boolean) => void;
  readonly selectionFeedback: (message: string) => void;
  readonly onActiveSlotChanged: (slotId: ViewportSlotId) => void;
}

/** Owns the primary and optional secondary viewport lifecycles. */
export class WorkbenchViewportSlots {
  private readonly options: WorkbenchViewportSlotsOptions;
  private readonly slots = new Map<ViewportSlotId, WorkbenchViewportSlot>();
  private activeSlotId: ViewportSlotId = "primary";
  private secondaryGeneration = 0;
  private secondaryOpening = false;

  constructor(options: WorkbenchViewportSlotsOptions) {
    this.options = options;
    this.slots.set("primary", {
      id: "primary",
      pane: options.view.primaryPane,
      interaction: options.primaryInteraction,
      boxPreview: options.primaryBoxPreview,
      renderLoop: new WorkbenchRenderLoop(() => this.slots.get("primary")?.viewport),
      viewport: options.primaryViewport,
      dragging: false,
    });
  }

  activeSlot(): WorkbenchViewportSlot {
    const slot = this.slots.get(this.activeSlotId) ?? this.slots.get("primary");
    if (slot === undefined) throw new Error("Workbench has no primary viewport");
    return slot;
  }

  activeViewport(): Viewport {
    return this.activeSlot().viewport;
  }

  viewports(): readonly Viewport[] {
    return [...this.slots.values()].map((slot) => slot.viewport);
  }

  all(): readonly WorkbenchViewportSlot[] {
    return [...this.slots.values()];
  }

  get(slotId: ViewportSlotId): WorkbenchViewportSlot | undefined {
    return this.slots.get(slotId);
  }

  isSecondaryVisible(): boolean {
    return this.secondaryOpening || this.slots.has("secondary");
  }

  isSecondaryOpening(): boolean {
    return this.secondaryOpening;
  }

  setPrimaryViewport(viewport: Viewport): void {
    const primary = this.slots.get("primary");
    if (primary === undefined) throw new Error("Workbench has no primary viewport");
    primary.viewport = viewport;
    this.activeSlotId = "primary";
    primary.renderLoop.attach(performance.now());
    this.options.onActiveSlotChanged("primary");
  }

  invalidateInteraction(): void {
    for (const slot of this.slots.values()) slot.interaction.clearContext();
  }

  clearHover(slotId = this.activeSlotId): void {
    this.slots.get(slotId)?.interaction.clearHover();
  }

  detachPrimary(): void {
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

  setContinuous(slotId: ViewportSlotId, enabled: boolean, timestamp: number): void {
    this.slots.get(slotId)?.renderLoop.setEnabled(enabled, timestamp);
  }

  onRender(slotId: ViewportSlotId, timestamp: number): boolean {
    const slot = this.slots.get(slotId);
    if (slot === undefined) return false;
    const publish = slot.renderLoop.frameCompleted(timestamp);
    return slot.id === this.activeSlotId && publish;
  }

  setActiveSlot(slotId: ViewportSlotId): void {
    if (this.slots.get(slotId) === undefined) return;
    this.activeSlotId = slotId;
    for (const slot of this.slots.values()) {
      if (this.slots.size === 1) delete slot.pane.scene.dataset["active"];
      else slot.pane.scene.dataset["active"] = String(slot.id === slotId);
    }
    this.options.onActiveSlotChanged(slotId);
  }

  async toggleSecondaryViewport(): Promise<void> {
    if (this.slots.has("secondary")) {
      this.closeSecondaryViewport();
      return;
    }
    if (this.secondaryOpening) return;
    const generation = ++this.secondaryGeneration;
    this.prepareSecondaryViewport();
    this.options.cloneShowState("primary", "secondary");
    await Promise.resolve();
    try {
      const slot = await this.createSecondarySlot();
      if (this.isStaleSecondary(generation, slot.viewport)) return;
      this.slots.set("secondary", slot);
      this.bindSecondarySlot(slot);
      this.setActiveSlot("secondary");
      slot.viewport.render();
    } catch (error) {
      if (generation === this.secondaryGeneration) this.cleanupFailedSecondary(error);
    } finally {
      if (generation === this.secondaryGeneration) {
        this.secondaryOpening = false;
        this.options.render();
      }
    }
  }

  handleSecondaryViewportError(error: unknown): void {
    const detail = errorMessage(error);
    this.closeSecondaryViewport();
    this.options.feedback(`Secondary viewport failed: ${detail}`);
  }

  destroy(): void {
    this.secondaryGeneration += 1;
    this.secondaryOpening = false;
    for (const slot of this.slots.values()) this.destroySlot(slot);
    this.slots.clear();
  }

  private prepareSecondaryViewport(): void {
    this.secondaryOpening = true;
    this.options.render();
  }

  private async createSecondarySlot(): Promise<WorkbenchViewportSlot> {
    const { view } = this.options;
    const viewport = await this.options.createViewport(
      "secondary",
      view.secondaryPane,
      this.options.getModel(),
    );
    const interaction = new WorkbenchInteraction({
      canvas: view.secondaryPane.canvas,
      viewport: () => viewport,
      selectionGranularity: () => this.options.selectionGranularity("secondary"),
      touchMode: () => this.options.touchInteractionMode("secondary"),
      getInteraction: () => this.options.getInteraction("secondary"),
      setInteraction: (value) => {
        this.options.setInteraction("secondary", value);
      },
      hoverOwnership: {
        canClear: () => {
          return this.options.canClearCanvasHover("secondary");
        },
        mark: () => {
          this.options.markCanvasHover("secondary");
        },
        clear: () => {
          this.options.clearCanvasHover("secondary");
        },
      },
      partName: (partId) => this.options.getModel().partNames.get(partId),
      menu: this.options.menu,
      render: this.options.render,
      setInspection: (text, visible) => {
        this.options.setInspection("secondary", text, visible);
      },
      selectionFeedback: this.options.selectionFeedback,
    });
    return {
      id: "secondary",
      pane: view.secondaryPane,
      interaction,
      boxPreview: new WorkbenchBoxPreview(view.secondaryPane.boxSelectionOverlay),
      renderLoop: new WorkbenchRenderLoop(() => viewport),
      viewport,
      dragging: false,
    };
  }

  private bindSecondarySlot(slot: WorkbenchViewportSlot): void {
    slot.pane.canvas.dataset["renderer"] = "webgpu";
    const paneController = new AbortController();
    const removePaneBindings = installWorkbenchPaneLifecycle({
      pane: slot.pane,
      signal: paneController.signal,
      interaction: slot.interaction,
      viewport: () => slot.viewport,
      boxPreview: slot.boxPreview,
      selectionGranularity: () => this.options.selectionGranularity("secondary"),
      touchInteractionMode: () => this.options.touchInteractionMode("secondary"),
      setActive: this.setActiveSlot.bind(this, "secondary"),
    });
    slot.removePaneBindings = () => {
      paneController.abort();
      removePaneBindings();
    };
  }

  private isStaleSecondary(generation: number, viewport: Viewport): boolean {
    if (generation === this.secondaryGeneration) return false;
    viewport.destroy();
    return true;
  }

  private cleanupFailedSecondary(error: unknown): void {
    const slot = this.slots.get("secondary");
    if (slot !== undefined) this.closeSecondaryViewport();
    else this.options.removeShowState("secondary");
    this.options.feedback(`Secondary viewport could not be opened: ${errorMessage(error)}`);
  }

  private closeSecondaryViewport(): void {
    this.secondaryGeneration += 1;
    this.secondaryOpening = false;
    const slot = this.slots.get("secondary");
    if (slot === undefined) {
      this.options.removeShowState("secondary");
      this.options.render();
      return;
    }
    this.destroySlot(slot);
    this.slots.delete("secondary");
    this.setActiveSlot("primary");
    this.options.removeShowState("secondary");
    this.options.render();
  }

  private destroySlot(slot: WorkbenchViewportSlot): void {
    slot.removePaneBindings?.();
    slot.renderLoop.stop();
    slot.interaction.destroy();
    slot.boxPreview.dispose();
    slot.viewport.destroy();
  }
}
