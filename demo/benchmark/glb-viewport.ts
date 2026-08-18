import { createViewport } from "../../src/entries/root";
import { importGlb } from "../../src/entries/io/glb";
import { createImportedModel } from "../workbench/models/model";
import { createModelInteraction } from "../workbench/state/preset";
import { createDefaultDisplayToggles } from "../workbench/types";
import { makeManyPartGlb } from "./glb-fixture";

const WIDTH = 800;
const HEIGHT = 600;

export interface GlbViewportBenchmarkReport {
  readonly sourcePartCount: number;
  readonly byteLength: number;
  readonly partCount: number;
  readonly timings: {
    readonly sourceBuildMs: number;
    readonly fileReadMs: number;
    readonly importMs: number;
    readonly workbenchStateMs: number;
    readonly deviceAcquireMs: number;
    readonly viewportCreateMs: number;
    readonly firstQueueDrainMs: number;
    readonly steadyFrameCpuMs: number;
    readonly steadyFrameQueueMs: number;
    readonly fileToVisibleMs: number;
  };
}

/** Measures the complete local-file-to-visible-Viewport path on real WebGPU. */
export async function runGlbViewportBenchmark(
  host: HTMLElement,
  sourcePartCount = 100_000,
  holdMilliseconds = 0,
): Promise<GlbViewportBenchmarkReport> {
  const sourceStart = performance.now();
  const source = makeManyPartGlb(sourcePartCount);
  const sourceBuildMs = performance.now() - sourceStart;
  const file = new File([source], `many-parts-${sourcePartCount}.glb`, {
    type: "model/gltf-binary",
  });
  const fileStart = performance.now();
  const bytes = await file.arrayBuffer();
  const fileReadMs = performance.now() - fileStart;
  const visibleStart = performance.now();
  const importStart = performance.now();
  const imported = await importGlb(bytes);
  const importMs = performance.now() - importStart;
  const stateStart = performance.now();
  const model = createImportedModel(file.name, {
    scene: imported.scene,
    elementModels: new Map(),
    partNames: imported.partNames,
    partStyles: imported.partStyles,
    results: undefined,
    issues: imported.issues,
  });
  const toggles = createDefaultDisplayToggles(model);
  const interaction = createModelInteraction(model, toggles.edges, toggles.nodes);
  const workbenchStateMs = performance.now() - stateStart;
  const deviceStart = performance.now();
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (adapter === null) throw new Error("No WebGPU adapter is available for the GLB benchmark");
  const device = await adapter.requestDevice();
  const deviceAcquireMs = performance.now() - deviceStart;
  const canvas = benchmarkCanvas(host);
  let viewport: Awaited<ReturnType<typeof createViewport>> | undefined;
  try {
    const viewportStart = performance.now();
    viewport = await createViewport({
      canvas,
      scene: imported.scene,
      interaction,
      device,
      originTriad: false,
    });
    const viewportCreateMs = performance.now() - viewportStart;
    const drainStart = performance.now();
    await device.queue.onSubmittedWorkDone();
    const firstQueueDrainMs = performance.now() - drainStart;
    const fileToVisibleMs = performance.now() - visibleStart;
    const steadyStart = performance.now();
    viewport.render();
    const steadyFrameCpuMs = performance.now() - steadyStart;
    await device.queue.onSubmittedWorkDone();
    const steadyFrameQueueMs = performance.now() - steadyStart;
    if (holdMilliseconds > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, holdMilliseconds));
    }
    return {
      sourcePartCount,
      byteLength: source.byteLength,
      partCount: imported.scene.parts.size,
      timings: {
        sourceBuildMs,
        fileReadMs,
        importMs,
        workbenchStateMs,
        deviceAcquireMs,
        viewportCreateMs,
        firstQueueDrainMs,
        steadyFrameCpuMs,
        steadyFrameQueueMs,
        fileToVisibleMs,
      },
    };
  } finally {
    viewport?.destroy();
    device.destroy();
    canvas.remove();
  }
}

function benchmarkCanvas(host: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.style.width = `${WIDTH}px`;
  canvas.style.height = `${HEIGHT}px`;
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.zIndex = "2";
  canvas.dataset["glbBenchmark"] = "visible";
  host.append(canvas);
  return canvas;
}
