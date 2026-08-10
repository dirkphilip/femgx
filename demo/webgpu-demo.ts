import { createFemViewport, type FemViewport } from "../src/index";
import { createModelPresets, type ModelPreset } from "./fixture/presets";
import { WorkbenchController } from "./controller";
import { createPerformancePreset } from "./fixture/performance-fixture";
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
  let benchmarkFrame: number | undefined;
  let benchmarkActive = false;
  let benchmarkComplete = false;
  let benchmarkFrames = 0;
  let benchmarkStart = 0;
  let measuredFps: number | undefined;

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
      ...(preset.results === undefined ? {} : { results: preset.results }),
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
        if (viewport !== undefined) {
          controller?.syncViewportPresentation();
          syncPerformanceMeasurement();
        }
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

  window.addEventListener("pagehide", () => {
    stopPerformanceMeasurement();
    viewport?.destroy();
    viewport = undefined;
  });

  /** Runs one bounded frame-rate sample when the performance preset is selected. */
  function startPerformanceMeasurement(): void {
    if (typeof requestAnimationFrame === "undefined" || benchmarkActive) return;
    benchmarkActive = true;
    benchmarkFrames = 0;
    benchmarkStart = 0;
    measuredFps = undefined;
    const frame = (now: number): void => {
      if (viewport === undefined || controller?.preset.id !== "performance") {
        stopPerformanceMeasurement();
        return;
      }
      if (benchmarkStart === 0) benchmarkStart = now;
      viewport.render();
      benchmarkFrames += 1;
      const elapsed = now - benchmarkStart;
      if (elapsed >= 500) {
        benchmarkActive = false;
        benchmarkComplete = true;
        benchmarkFrame = undefined;
        measuredFps = (benchmarkFrames * 1000) / elapsed;
        updatePerformanceOverlay();
        return;
      }
      benchmarkFrame = requestAnimationFrame(frame);
    };
    benchmarkFrame = requestAnimationFrame(frame);
    updatePerformanceOverlay();
  }

  function stopPerformanceMeasurement(): void {
    if (benchmarkFrame !== undefined && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(benchmarkFrame);
    }
    benchmarkFrame = undefined;
    benchmarkActive = false;
  }

  function syncPerformanceMeasurement(): void {
    if (controller === undefined) return;
    if (controller.preset.id !== "performance") {
      stopPerformanceMeasurement();
      benchmarkComplete = false;
      measuredFps = undefined;
      updatePerformanceOverlay();
      return;
    }
    if (!benchmarkComplete) startPerformanceMeasurement();
    updatePerformanceOverlay();
  }

  function updatePerformanceOverlay(): void {
    if (controller === undefined) return;
    const frameCount = Number(canvas.dataset["frames"] ?? "0");
    const state = benchmarkActive
      ? "Benchmark active"
      : measuredFps === undefined
        ? "Idle"
        : `Benchmark ${measuredFps.toFixed(1)} FPS · idle`;
    view.performanceOverlay.textContent =
      `Unique     ${formatCount(controller.uniqueTriangleCount())} triangles\n` +
      `Submitted  ${formatCount(controller.submittedTriangleCount())} triangles\n` +
      `State      ${state}\n` +
      `Frames     ${formatCount(frameCount)}\n` +
      `Batches    ${viewport?.stats().drawBatches ?? 0}`;
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
    runBenchmark: async (includeLarge: boolean) => {
      stopPerformanceMeasurement();
      controller.destroy();
      viewport = undefined;
      const { runWebGpuBenchmark } = await import("./webgpu-benchmark");
      return runWebGpuBenchmark(canvas, { includeLarge });
    },
  };

  return controller;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
