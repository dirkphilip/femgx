import { createFemViewport, type FemViewport } from "../src/index";
import { createModelPresets, type ModelPreset } from "../src/fixture/presets";
import { WorkbenchController } from "./controller";
import { createPerformancePreset } from "./performance-fixture";
import type { DemoView } from "./view";

/** Inputs for the WebGPU demo path. */
export interface WebGpuDemoOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
}

/** Starts the presentation-only demo shell around the canonical FEM viewport. */
export async function startWebGpuDemo(
  options: WebGpuDemoOptions,
): Promise<WorkbenchController | undefined> {
  const { view, canvas } = options;
  const presets = [...createModelPresets(), createPerformancePreset()];
  const initialPreset = presets[0];
  if (initialPreset === undefined) throw new Error("The demo requires at least one model preset");

  let viewport: FemViewport | undefined;
  let controller: WorkbenchController | undefined;
  let animationFrame: number | undefined;

  const reportUnsupported = (error: unknown): void => {
    const detail = error instanceof Error ? error.message : String(error);
    canvas.dataset["renderer"] = "unsupported";
    view.rendererStatus.textContent = "Renderer unsupported";
    view.status.textContent = `femgx requires a usable WebGPU renderer. ${detail}`;
  };

  const createViewport = async (preset: ModelPreset): Promise<FemViewport> =>
    createFemViewport({
      canvas,
      scene: preset.scene,
      ...(controller === undefined ? {} : { camera: controller.camera }),
      ...(controller === undefined ? {} : { interaction: controller.interaction }),
      onDeviceLost: () => {
        canvas.dataset["recovery"] = "recovering";
      },
      onRecovered: () => {
        canvas.dataset["recovery"] = "recovered";
        if (controller !== undefined) {
          controller.rendererState = "recovered";
          controller.render();
        }
      },
      onError: (error) => {
        controller?.destroy();
        viewport = undefined;
        canvas.dataset["recovery"] = "error";
        reportUnsupported(error);
      },
      onGestureChange: (active) => {
        controller?.setCameraGestureActive(active);
      },
      onRender: () => {
        canvas.dataset["frames"] = String(Number(canvas.dataset["frames"] ?? "0") + 1);
        controller?.syncViewportPresentation();
      },
    });

  try {
    viewport = await createViewport(initialPreset);
    controller = new WorkbenchController({
      view,
      canvas,
      rendererName: "webgpu",
      viewport,
      presets,
    });
    viewport.render();
  } catch (error) {
    viewport?.destroy();
    viewport = undefined;
    controller?.destroy();
    reportUnsupported(error);
    return undefined;
  }
  canvas.dataset["renderer"] = "webgpu";
  startPerformanceLoop();

  window.addEventListener("pagehide", () => {
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    viewport?.destroy();
    viewport = undefined;
  });

  /** Continuously measures the normal public viewport path. */
  function startPerformanceLoop(): void {
    if (typeof requestAnimationFrame === "undefined") return;
    let frameCount = 0;
    let sampleStart = performance.now();
    const frame = (now: number): void => {
      viewport?.render();
      if (viewport !== undefined) frameCount += 1;
      const elapsed = now - sampleStart;
      if (elapsed >= 500 && controller !== undefined) {
        const fps = (frameCount * 1000) / elapsed;
        view.performanceOverlay.textContent =
          `Triangles  ${formatCount(controller.totalTriangleCount())}\n` +
          `FPS        ${fps.toFixed(1)}\n` +
          `Batches    ${viewport?.stats().drawBatches ?? 0}`;
        frameCount = 0;
        sampleStart = now;
      }
      animationFrame = requestAnimationFrame(frame);
    };
    animationFrame = requestAnimationFrame(frame);
  }

  /** Explicit lifecycle seam used by the e2e lane. */
  (window as typeof window & { femgxDemo?: unknown }).femgxDemo = {
    destroyRenderer: () => {
      viewport?.destroy();
      viewport = undefined;
      canvas.dataset["renderer"] = "destroyed";
    },
    recreateRenderer: async () => {
      if (viewport !== undefined) return;
      try {
        const recreated = await createViewport(controller.preset);
        viewport = recreated;
        controller.setViewport(recreated);
        canvas.dataset["renderer"] = "webgpu";
        recreated.render();
      } catch (error) {
        viewport?.destroy();
        viewport = undefined;
        reportUnsupported(error);
      }
    },
  };

  return controller;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
