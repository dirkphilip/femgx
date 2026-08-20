import { expect, it, describe } from "vitest";
import {
  createWebGpuRenderer,
  createPackedSceneRuntime,
  createInteractionState,
  setPartOverride,
  fakeCanvas,
  fakeGpuDevice,
  buildScene,
  camera,
  installGpuTestEnvironment,
} from "./support";

describe("WebGPU renderer", () => {
  it("cannot recover an externally provided device", async () => {
    const external = fakeGpuDevice();
    installGpuTestEnvironment(external.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas(), device: external.device });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);
    external.lose();
    await external.lost;
    expect(renderer.lost).toBe(true);
    await expect(renderer.recover()).rejects.toThrow(/externally/i);
  });

  it("draws the edge overlay only for edge-styled instances and honors the depth-test flag", async () => {
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws).toEqual([
      { pipeline: "pipeline-10", indexCount: 3, instanceCount: 3 },
    ]);

    const edge = setPartOverride(createInteractionState(), 1, { edge: true });
    renderer.updateInstances(runtime, edge, [0, 1, 2]);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws.slice(-2)).toEqual([
      { pipeline: "pipeline-10", indexCount: 3, instanceCount: 3 },
      { pipeline: "pipeline-20", indexCount: 6, instanceCount: 3 },
    ]);

    renderer.setEdgeDepthTest(false);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws.at(-1)).toEqual({
      pipeline: "pipeline-21",
      indexCount: 6,
      instanceCount: 3,
    });

    renderer.setEdgeDepthTest(true);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws.at(-1)).toEqual({
      pipeline: "pipeline-20",
      indexCount: 6,
      instanceCount: 3,
    });

    renderer.destroy();
  });

  it("keeps transparent fragments in the OIT pass without removing opaque batches", async () => {
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);

    const transparent = setPartOverride(createInteractionState(), 1, { opacity: 0.5 });
    renderer.updateInstances(runtime, transparent, [0, 1, 2]);
    renderer.render(runtime, camera, scene.parts);

    expect(gpu.pipelineDraws.slice(-2)).toEqual([
      { pipeline: "pipeline-10", indexCount: 3, instanceCount: 3 },
      { pipeline: "pipeline-11", indexCount: 3, instanceCount: 3 },
    ]);
    renderer.destroy();
  });

  it("keeps zero-opacity geometry in the pick pass", async () => {
    const gpu = fakeGpuDevice({ pickValue: 1, ndcDepth: 0.5 });
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);
    renderer.updateInstances(
      runtime,
      setPartOverride(createInteractionState(), 1, { opacity: 0 }),
      [0, 1, 2],
    );
    renderer.render(runtime, camera, scene.parts);

    await expect(renderer.pick(400, 300)).resolves.toMatchObject({
      kind: "partOccurrence",
      partId: 1,
    });
    renderer.destroy();
  });
});
