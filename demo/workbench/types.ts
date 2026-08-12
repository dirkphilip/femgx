import type { FemViewport, GlbSceneImport, InteractionState, SceneRuntime } from "../../src/index";
import type { DemoView } from "./view";
import type { WorkbenchModel } from "./model";

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

/** Options for the shared inspection workbench controller. */
export interface WorkbenchOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly viewport: FemViewport;
  readonly presets: readonly WorkbenchModel[];
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
