import type { FemViewport, InteractionState } from "../../src/entries/root";
import type { GlbSceneImport } from "../../src/entries/io-glb";
import type { SceneRuntime } from "../../src/entries/runtime";
import type { DemoView, WorkbenchPane, ViewportSlotId } from "./viewport/view";
import type { WorkbenchModel } from "./models/model";

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

/** Returns the inspection-first model defaults used by startup, reset, and switches. */
export function createDefaultDisplayToggles(): DisplayToggles {
  return { edges: true, nodes: true, diagnostics: false };
}

/** Static result display states exercised by the results demo preset. */
export type ResultDisplayMode = "base" | "colored" | "deformed";

/** Mobile touch routing between camera navigation, hover inspection, and box selection. */
export type TouchInteractionMode = "navigate" | "hover" | "box-select";

/** Options for the shared inspection workbench controller. */
export interface WorkbenchOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly viewport: FemViewport;
  readonly presets: readonly WorkbenchModel[];
  readonly createViewport: (
    slotId: ViewportSlotId,
    pane: WorkbenchPane,
    model: WorkbenchModel,
  ) => Promise<FemViewport>;
  readonly importGlb?: (
    source: ArrayBuffer | Uint8Array,
    options?: { readonly strict?: boolean },
  ) => Promise<GlbSceneImport>;
}

/** Read-only context needed by visibility and status helpers. */
export interface WorkbenchSceneContext {
  readonly model: WorkbenchModel;
  readonly runtime: SceneRuntime;
  readonly interaction: InteractionState;
}

export type { RenderLoopStats } from "./viewport/render-loop";
