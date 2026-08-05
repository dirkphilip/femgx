import type { ModelPreset } from "../src/fixture/presets";
import { WorkbenchController, type RendererHooks, type RendererStats } from "./controller";
import { drawCpuFrame } from "./cpu-render";
import type { DemoView } from "./view";

/** Inputs for the deterministic CPU (2D canvas) renderer. */
export interface CpuDemoOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly preset: ModelPreset;
}

/** Starts the deterministic 2D canvas renderer, used when WebGPU is unusable. */
export function startCpuDemo(options: CpuDemoOptions): WorkbenchController {
  const { view, canvas } = options;
  const contextElement = canvas.getContext("2d");
  if (contextElement === null) {
    throw new Error("2d context unavailable");
  }
  const context: CanvasRenderingContext2D = contextElement;
  canvas.dataset["renderer"] = "cpu";

  const hooks: RendererHooks = {
    render: (controller, state) => {
      drawCpuFrame({
        canvas,
        context,
        preset: controller.preset,
        runtime: controller.runtime,
        camera: controller.cameraRef.camera,
        interaction: state,
        toggles: controller.toggles,
      });
      canvas.dataset["frames"] = String(Number(canvas.dataset["frames"] ?? "0") + 1);
    },
    applyVisibility: (controller, state, _changed) => {
      drawCpuFrame({
        canvas,
        context,
        preset: controller.preset,
        runtime: controller.runtime,
        camera: controller.cameraRef.camera,
        interaction: state,
        toggles: controller.toggles,
      });
      canvas.dataset["frames"] = String(Number(canvas.dataset["frames"] ?? "0") + 1);
    },
    stats: (controller): RendererStats => ({
      visibleInstances: controller.runtime.visibleCount,
      batches: visiblePartBatches(controller),
    }),
  };

  const controller = new WorkbenchController({
    view,
    canvas,
    rendererName: "cpu",
    supportsEdgeDepthTest: false,
    hooks,
  });
  return controller;
}

/** Draw batches for the CPU renderer: one per part with a visible instance. */
function visiblePartBatches(controller: WorkbenchController): number {
  const drawn = new Set<number>();
  for (const slot of controller.runtime.getDrawList()) {
    const partId = controller.runtime.instancePartIds[slot];
    if (partId !== undefined) drawn.add(partId);
  }
  return drawn.size;
}
