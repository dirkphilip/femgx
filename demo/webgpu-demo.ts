import type { ModelPreset } from "../src/fixture/presets";
import {
  type DeviceLostInfo,
  type InteractionState,
  type SceneRuntime,
  type WebGpuRenderer,
} from "../src/index";
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
  gpuRenderer: WebGpuRenderer,
  canvas: HTMLCanvasElement,
  controller: WorkbenchController,
  state: InteractionState,
): void {
  if (gpuRenderer.lost) return;
  const runtime = controller.runtime;
  gpuRenderer.updateInstances(runtime, state, allSlots(runtime));
  gpuRenderer.updateElements(runtime, state);
  gpuRenderer.render(runtime, controller.cameraRef.camera, controller.preset.scene.parts);
  canvas.dataset["frames"] = String(Number(canvas.dataset["frames"] ?? "0") + 1);
}

/**
 * Replaces a canvas already committed to a WebGPU context with a fresh element.
 * A canvas cannot switch context types (`getContext("2d")` returns `null` after
 * a `"webgpu"` context), so the CPU fallback after device loss needs a new one.
 */
function freshCpuCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const replacement = canvas.cloneNode(false) as HTMLCanvasElement;
  canvas.replaceWith(replacement);
  return replacement;
}

/**
 * Starts the WebGPU renderer, falling back to the CPU renderer when probing
 * fails. Both paths drive the same workbench controller, so camera and
 * interaction behavior is identical. A device loss after startup is handled
 * here: the renderer is recovered once (the demo owns its device) and, when
 * recovery is impossible, the demo destroys the renderer and starts the CPU
 * fallback on a fresh canvas.
 */
export async function startWebGpuDemo(options: WebGpuDemoOptions): Promise<WorkbenchController> {
  const { view, canvas, preset } = options;
  let gpuRenderer: WebGpuRenderer | undefined;
  let controller: WorkbenchController | undefined;

  /** Recovers the renderer once, or falls back to the CPU renderer. */
  const recoverFromDeviceLoss = async (_info: DeviceLostInfo): Promise<void> => {
    const renderer = gpuRenderer;
    const active = controller;
    if (renderer === undefined || active === undefined) return;
    try {
      await renderer.recover();
      active.rendererState = "recovered";
      canvas.dataset["recovery"] = "recovered";
      active.render();
    } catch {
      renderer.destroy();
      gpuRenderer = undefined;
      active.destroy();
      const cpuCanvas = freshCpuCanvas(canvas);
      controller = startCpuDemo({
        view: { ...view, canvas: cpuCanvas },
        canvas: cpuCanvas,
        preset,
      });
      controller.rendererState = "fallback";
      cpuCanvas.dataset["recovery"] = "cpu-fallback";
      controller.render();
    }
  };

  const renderer = await options.createRenderer({
    onDeviceLost: (info) => {
      void recoverFromDeviceLoss(info);
    },
  });
  if (renderer === undefined) {
    return startCpuDemo({ view, canvas, preset });
  }
  gpuRenderer = renderer;
  canvas.dataset["renderer"] = "webgpu";

  const hooks: RendererHooks = {
    render: (active, state) => {
      if (gpuRenderer === undefined) return;
      renderFrame(gpuRenderer, canvas, active, state);
    },
    applyVisibility: (active, state, changed) => {
      if (gpuRenderer === undefined || gpuRenderer.lost) return;
      gpuRenderer.updateVisibility(active.runtime, changed);
      renderFrame(gpuRenderer, canvas, active, state);
    },
    stats: (active): RendererStats => {
      const stats = gpuRenderer?.stats();
      return {
        visibleInstances: active.runtime.visibleCount,
        batches: stats?.drawBatches ?? 0,
      };
    },
  };

  controller = new WorkbenchController({
    view,
    canvas,
    rendererName: "webgpu",
    hooks,
    setEdgeDepthTest: (enabled) => {
      if (gpuRenderer !== undefined && !gpuRenderer.lost) gpuRenderer.setEdgeDepthTest(enabled);
    },
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
   * clean teardown, re-initialization, and device-loss recovery through the
   * demo.
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
      const recreated = await options.createRenderer({
        onDeviceLost: (info) => {
          void recoverFromDeviceLoss(info);
        },
      });
      if (recreated === undefined) return;
      gpuRenderer = recreated;
      canvas.dataset["renderer"] = "webgpu";
      if (controller !== undefined) {
        renderFrame(gpuRenderer, canvas, controller, controller.interaction);
      }
    },
    forceDeviceLoss: () => {
      gpuRenderer?.device.destroy();
    },
  };

  return controller;
}
