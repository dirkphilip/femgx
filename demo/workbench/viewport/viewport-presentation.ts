import { cameraSnapshot } from "./presentation";
import { selectedKeys } from "../selection/selection";
import type { InteractionState } from "../../../src/entries/root";
import type { WorkbenchModel } from "../models/model";
import type { WorkbenchViewportSlot } from "./viewport-slots";
import type { WorkbenchPresentation } from "./presentation";
import type { ViewportSlotId } from "./view";
import type { ResultDisplayMode, DisplayToggles } from "../types";
import type { SectionAxis } from "../section-controls";
import type { BoxSelectionStrategy } from "../selection/box-selection-resolver";
import type { WorkbenchShowState } from "../state/show-state";

export interface ObservedPaneSize {
  readonly size: { readonly width: number; readonly height: number };
  readonly devicePixelRatio: number;
}

/** Reports whether a pane size or device-pixel-ratio changed since its last frame. */
export function viewportPresentationChanged(
  slot: WorkbenchViewportSlot,
  observed: Map<ViewportSlotId, ObservedPaneSize>,
): boolean {
  const size = canvasSize(slot.pane.canvas);
  const devicePixelRatio = devicePixelRatioValue();
  const previous = observed.get(slot.id);
  observed.set(slot.id, { size, devicePixelRatio });
  if (previous === undefined) return true;
  return (
    size.width !== previous.size.width ||
    size.height !== previous.size.height ||
    devicePixelRatio !== previous.devicePixelRatio
  );
}

interface SyncViewportPresentationOptions {
  readonly activeSlot: WorkbenchViewportSlot;
  readonly slots: readonly WorkbenchViewportSlot[];
  readonly presentation: WorkbenchPresentation;
  readonly rendererState: string;
  readonly model: WorkbenchModel;
  readonly interaction: InteractionState;
  readonly toggles: DisplayToggles;
  readonly continuous: boolean;
  readonly selectionGranularity: string;
  readonly boxSelectionStrategy: BoxSelectionStrategy;
  readonly resultMode: ResultDisplayMode;
  readonly sectionAxis: SectionAxis;
  readonly sectionOffset: number;
  readonly background: string;
  readonly showState: (slotId: ViewportSlotId) => WorkbenchShowState;
}

/** Publishes renderer stats and stable pane data attributes for the demo shell. */
export function syncViewportPresentation(options: SyncViewportPresentationOptions): void {
  const { activeSlot } = options;
  const viewportStats = activeSlot.viewport.stats();
  options.presentation.refresh(
    activeSlot.viewport.camera,
    options.rendererState,
    {
      visibleInstances: viewportStats.visibleInstances,
      batches: viewportStats.drawBatches,
    },
    activeSlot.renderLoop.stats,
  );
  for (const slot of options.slots) syncPaneDataset(slot, options);
}

function syncPaneDataset(
  slot: WorkbenchViewportSlot,
  options: SyncViewportPresentationOptions,
): void {
  const canvas = slot.pane.canvas;
  const state = options.showState(slot.id);
  canvas.dataset["model"] = options.model.id;
  canvas.dataset["dragging"] = String(slot.dragging);
  canvas.dataset["selected"] = selectedKeys(state.interaction).join(",");
  canvas.dataset["camera"] = JSON.stringify(cameraSnapshot(slot.viewport.camera));
  canvas.dataset["cameraBounds"] = JSON.stringify(options.model.bounds);
  canvas.dataset["edges"] = String(state.toggles.edges);
  canvas.dataset["nodes"] = String(state.toggles.nodes);
  canvas.dataset["continuous"] = String(state.continuousEnabled);
  canvas.dataset["selectionGranularity"] = state.selectionGranularity;
  canvas.dataset["boxSelectionStrategy"] = state.boxSelectionStrategy;
  canvas.dataset["results"] = state.resultMode;
  canvas.dataset["sectionAxis"] = state.sectionAxis;
  canvas.dataset["sectionOffset"] = String(state.sectionOffset);
  canvas.dataset["background"] = state.background;
  canvas.dataset["visibleInstances"] = String(slot.viewport.runtime.visibleCount);
}

function canvasSize(canvas: HTMLCanvasElement): {
  readonly width: number;
  readonly height: number;
} {
  const bounds = canvas.getBoundingClientRect();
  return { width: bounds.width, height: bounds.height };
}

function devicePixelRatioValue(): number {
  return typeof window === "undefined" ? 1 : window.devicePixelRatio;
}
