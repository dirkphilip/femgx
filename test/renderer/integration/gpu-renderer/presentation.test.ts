import { expect, it, describe } from "vitest";
import {
  createWebGpuRenderer,
  readGpuCostSnapshot,
  createPackedSceneRuntime,
  createInteractionState,
  setPartOverride,
  fakeCanvas,
  fakeGpuDevice,
  buildScene,
  buildPointScene,
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

  it("draws the presentation-owned edge overlay and honors the depth-test flag", async () => {
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    const inactiveShaderCount = gpu.shaderModuleDescriptors.length;
    const inactivePipelineCount = gpu.renderPipelineDescriptors.length;
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws).toEqual([
      { pipeline: "pipeline-10", indexCount: 3, instanceCount: 3 },
    ]);

    const edge = createInteractionState();
    renderer.setEdgesVisible(true);
    renderer.updateInstances(runtime, edge, [0, 1, 2]);
    renderer.render(runtime, camera, scene.parts);
    expect(readGpuCostSnapshot(renderer).passes).toMatchObject({ "overlay-depth": 1, overlay: 1 });
    expect(readGpuCostSnapshot(renderer).targets).toMatchObject({ presentationOverlay: true });
    expect(gpu.shaderModuleDescriptors).toHaveLength(inactiveShaderCount + 1);
    expect(gpu.renderPipelineDescriptors).toHaveLength(inactivePipelineCount + 1);
    expect(
      gpu.renderPipelineDescriptors.some(
        (descriptor) => descriptor.label === "presentation depth resolve",
      ),
    ).toBe(true);
    expect(gpu.pipelineDraws.slice(-2)).toEqual([
      { pipeline: "pipeline-10", indexCount: 3, instanceCount: 3 },
      { pipeline: "pipeline-22", indexCount: 6, instanceCount: 3 },
    ]);

    renderer.setEdgeDepthTest(false);
    renderer.render(runtime, camera, scene.parts);
    expect(readGpuCostSnapshot(renderer).passes).toMatchObject({ "overlay-depth": 0, overlay: 0 });
    expect(readGpuCostSnapshot(renderer).targets).toMatchObject({ presentationOverlay: false });
    expect(gpu.textures.at(-1)?.destroyed).toBe(true);
    expect(gpu.pipelineDraws.at(-1)).toEqual({
      pipeline: "pipeline-23",
      indexCount: 6,
      instanceCount: 3,
    });

    renderer.setEdgeDepthTest(true);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws.at(-1)).toEqual({
      pipeline: "pipeline-22",
      indexCount: 6,
      instanceCount: 3,
    });

    renderer.destroy();
  });

  it("does not admit resolved presentation work for point-only parts", async () => {
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildPointScene();
    const runtime = createPackedSceneRuntime(scene);
    const shaderCount = gpu.shaderModuleDescriptors.length;
    const pipelineCount = gpu.renderPipelineDescriptors.length;

    renderer.updateInstances(runtime, createInteractionState(), [0]);
    renderer.render(runtime, camera, scene.parts);

    expect(readGpuCostSnapshot(renderer).passes).toMatchObject({ "overlay-depth": 0, overlay: 0 });
    expect(readGpuCostSnapshot(renderer).targets).toMatchObject({ presentationOverlay: false });
    expect(gpu.shaderModuleDescriptors).toHaveLength(shaderCount);
    expect(gpu.renderPipelineDescriptors).toHaveLength(pipelineCount);
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
