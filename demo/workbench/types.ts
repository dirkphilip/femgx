import type { FemViewport, InteractionState, PartId, SceneRuntime } from "../../src/index";
import type { DemoView } from "../view";
import type { ModelPreset } from "../fixture/presets";

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

/** Read-only context needed by visibility and status helpers. */
export interface WorkbenchSceneContext {
  readonly preset: ModelPreset;
  readonly runtime: SceneRuntime;
  readonly interaction: InteractionState;
  readonly partFirstSlot: ReadonlyMap<PartId, number>;
}
