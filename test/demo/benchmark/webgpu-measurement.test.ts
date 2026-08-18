import { describe, expect, it } from "vitest";
import { measureIteration } from "../../../demo/benchmark/measurement";
import { createBenchmarkCase } from "../../../demo/benchmark/model";
import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import {
  camera,
  createWebGpuRenderer,
  fakeCanvas,
  fakeGpuDevice,
  installGpuTestGlobals,
  installNavigator,
  readGpuCostSnapshot,
} from "../../renderer/integration/gpu-renderer/support";

describe("WebGPU benchmark measurement boundaries", () => {
  it("captures visible-frame cost before the trailing pick pass", async () => {
    installGpuTestGlobals();
    const gpu = fakeGpuDevice({ pickValue: 1, ndcDepth: 0.5 });
    installNavigator(gpu.device);
    const canvas = fakeCanvas();
    const renderer = await createWebGpuRenderer({ canvas });
    const benchmarkCase = createBenchmarkCase({
      id: "measurement-test",
      name: "Measurement test",
      kind: "unique-geometry",
      gridCells: 2,
      partCount: 1,
      instanceCount: 1,
      bodyCount: 0,
      elementFamily: "triangle",
    });
    const runtime = createPackedSceneRuntime(benchmarkCase.scene);

    try {
      const result = await measureIteration({
        renderer,
        device: gpu.device,
        benchmarkCase,
        runtime,
        camera,
        pickPoint: [400, 300],
        phase: "frame",
      });

      expect(result.gpuCost.passes["pick"]).toBe(0);
      expect(result.gpuCost.passes["opaque"]).toBe(1);
      expect(readGpuCostSnapshot(renderer).passes["pick"]).toBe(1);
    } finally {
      renderer.destroy();
    }
  });
});
