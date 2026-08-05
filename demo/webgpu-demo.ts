import type { ModelPreset } from "../src/fixture/presets";
import { type InteractionState, type SceneRuntime, type WebGpuRenderer } from "../src/index";
import { startCpuDemo } from "./cpu-demo";
import { WorkbenchController, type RendererHooks, type RendererStats } from "./controller";
import type { RendererFactory } from "./webgpu-probe";
import type { DemoView } from "./view";

/** Inputs for the WebGPU demo path. */
export interface WebGpuDemoOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly preset: ModelPreset;
  readonly createRenderer: RendererFactory;
}

/** All instance slots of a runtime, used for whole-state instance patches. */
function allSlots(runtime: SceneRuntime): number[] {
  return Array.from({ length: runtime.instanceCount }, (_, slot) => slot);
}

function renderFrame(
  gpuRenderer: WebGpuRenderer | undefined,
  canvas: HTMLCanvasElement,
  controller: WorkbenchController,
  state: InteractionState,
): void {
  if (gpuRenderer === undefined) return;
  const runtime = controller.runtime;
  gpuRenderer.updateInstances(runtime, state, allSlots(runtime));
  gpuRenderer.updateElements(runtime, state);
  gpuRenderer.render(runtime, controller.cameraRef.camera, controller.preset.scene.parts);
  canvas.dataset["frames"] = String(Number(canvas.dataset["frames"] ?? "0") + 1);
}

/**
 * Starts the WebGPU renderer, falling back to the CPU renderer when probing
 * fails. Both paths drive the same workbench controller, so camera and
 * interaction behavior is identical.
 */
export async function startWebGpuDemo(options: WebGpuDemoOptions): Promise<WorkbenchController> {
  const { view, canvas, preset } = options;
  const renderer = await options.createRenderer();
  if (renderer === undefined) {
    return startCpuDemo({ view, canvas, preset });
  }
  canvas.dataset["renderer"] = "webgpu";

  let gpuRenderer: WebGpuRenderer | undefined = renderer;
  const hooks: RendererHooks = {
    render: (controller, state) => {
      renderFrame(gpuRenderer, canvas, controller, state);
    },
    applyVisibility: (controller, state, changed) => {
      if (gpuRenderer === undefined) return;
      gpuRenderer.updateVisibility(controller.runtime, changed);
      renderFrame(gpuRenderer, canvas, controller, state);
    },
    stats: (controller): RendererStats => {
      const stats = gpuRenderer?.stats();
      return {
        visibleInstances: controller.runtime.visibleCount,
        batches: stats?.drawBatches ?? 0,
      };
    },
  };

  const controller = new WorkbenchController({
    view,
    canvas,
    rendererName: "webgpu",
    hooks,
    setEdgeDepthTest: (enabled) => gpuRenderer?.setEdgeDepthTest(enabled),
    onDestroy: () => {
      gpuRenderer?.destroy();
      gpuRenderer = undefined;
    },
  });

  window.addEventListener("pagehide", () => {
    gpuRenderer?.destroy();
    gpuRenderer = undefined;
  });

  /**
   * Explicit lifecycle seam used by the opt-in WebGPU e2e lane to exercise
   * clean teardown and re-initialization of the renderer through the demo.
   */
  (window as typeof window & { femgxDemo?: unknown }).femgxDemo = {
    destroyRenderer: () => {
      if (gpuRenderer === undefined) return;
      gpuRenderer.destroy();
      gpuRenderer = undefined;
      canvas.dataset["renderer"] = "destroyed";
    },
    recreateRenderer: async () => {
      if (gpuRenderer !== undefined) return;
      const recreated = await options.createRenderer();
      if (recreated === undefined) return;
      gpuRenderer = recreated;
      canvas.dataset["renderer"] = "webgpu";
      renderFrame(gpuRenderer, canvas, controller, controller.interaction);
    },
  };

  return controller;
}
