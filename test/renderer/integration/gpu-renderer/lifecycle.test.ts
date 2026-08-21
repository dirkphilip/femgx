import { expect, it, describe } from "vitest";
import {
  createWebGpuRenderer,
  readGpuCostSnapshot,
  createGpuBundle,
  destroyGpuBundle,
  RendererAttachment,
  uploadPart,
  createPart,
  createPackedSceneRuntime,
  unprojectPoint,
  zoomCamera,
  fakeCanvas,
  fakeGpuDevice,
  buildScene,
  buildPointScene,
  buildVariantScene,
  camera,
  installGpuTestGlobals,
  installGpuTestEnvironment,
} from "./support";

describe("WebGPU renderer", () => {
  it("reconciles host variant rebinds without touching unrelated placement storage", async () => {
    installGpuTestGlobals();
    const gpu = fakeGpuDevice();
    const bundle = await createGpuBundle(gpu.device, "bgra8unorm", "depth24plus");
    const attachment = new RendererAttachment();
    const parts = [
      createPart(1, {
        geometries: [
          {
            positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
            indices: new Uint32Array([0, 1, 2]),
            primitive: "triangles" as const,
          },
        ],
      }),
      createPart(2, {
        geometries: [
          {
            positions: new Float32Array([0, 0, 0, 0, 1, 0, -1, 0, 0]),
            indices: new Uint32Array([0, 1, 2]),
            primitive: "triangles" as const,
          },
        ],
      }),
      createPart(3, {
        geometries: [
          {
            positions: new Float32Array([0, 0, 0, 0, -1, 0, 1, 1, 0]),
            indices: new Uint32Array([0, 1, 2]),
            primitive: "triangles" as const,
          },
        ],
      }),
    ] as const;
    try {
      const initial = buildVariantScene(parts, [
        { placementId: "move", partId: 1 },
        { placementId: "keep", partId: 2 },
        { placementId: "other", partId: 3 },
      ]);
      const initialRuntime = createPackedSceneRuntime(initial);
      attachment.prepareParts(initial.parts, bundle);
      attachment.attach(initialRuntime, bundle);
      uploadPart(bundle.draw, parts[1]);
      uploadPart(bundle.draw, parts[2]);
      const stablePartResource = bundle.draw.primitiveParts.get(2)?.get("triangles");
      const stableStorage = bundle.draw.storages.get(3);
      const stableWrites = gpu.writes.filter((write) => write.buffer === stableStorage?.buffer);
      const initialInstanceScan = bundle.draw.cost.snapshot().cpu["instance-scan"];

      const replacement = buildVariantScene(parts, [
        { placementId: "move", partId: 2 },
        { placementId: "keep", partId: 2 },
        { placementId: "other", partId: 3 },
      ]);
      const replacementRuntime = createPackedSceneRuntime(replacement);
      attachment.prepareParts(replacement.parts, bundle);
      attachment.attach(replacementRuntime, bundle);

      expect(bundle.draw.primitiveParts.get(2)?.get("triangles")).toBe(stablePartResource);
      expect(bundle.draw.storages.get(3)).toBe(stableStorage);
      expect(gpu.writes.filter((write) => write.buffer === stableStorage?.buffer)).toHaveLength(
        stableWrites.length,
      );
      expect(bundle.draw.storages.has(1)).toBe(false);
      expect(attachment.slotByInstanceId.get("1/keep")).toBe(1);
      expect(attachment.slotByInstanceId.get("1/other")).toBe(2);
      expect(attachment.calls).toEqual([
        { partId: 2, instanceCount: 2 },
        { partId: 3, instanceCount: 1 },
      ]);
      expect(bundle.draw.cost.snapshot().cpu["instance-scan"] - initialInstanceScan).toBe(1);
    } finally {
      destroyGpuBundle(bundle);
    }
  });

  it("reports unavailable WebGPU clearly", async () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    await expect(createWebGpuRenderer({ canvas: fakeCanvas() })).rejects.toThrow(
      "WebGPU is unavailable",
    );
  });

  it("renders, uploads, picks, resizes, and destroys with a mocked device", async () => {
    const gpu = fakeGpuDevice({ pickValue: 1, ndcDepth: 0.5 });
    installGpuTestEnvironment(gpu.device);

    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    await expect(renderer.pick(1, 1)).resolves.toBeUndefined();
    renderer.render(runtime, camera, scene.parts);
    renderer.render(runtime, camera, scene.parts);
    const cost = readGpuCostSnapshot(renderer);
    expect(cost.passes).toEqual({
      opaque: 1,
      transparency: 1,
      composite: 1,
      "overlay-depth": 0,
      overlay: 0,
      pick: 0,
    });
    expect(cost.draws.background).toEqual({ calls: 1, indices: 3, instances: 1 });
    expect(cost.draws.opaque).toEqual({ calls: 1, indices: 3, instances: 3 });
    expect(cost.writes.instance).toEqual({ calls: 0, bytes: 0 });
    expect(cost.writes.order).toEqual({ calls: 0, bytes: 0 });
    expect(cost.cpu["instance-scan"]).toBe(0);
    expect(cost.cpu["order-rebuild"]).toBe(0);
    expect(cost.targets).toEqual({
      width: 800,
      height: 600,
      devicePixelRatio: 1,
      sampleCount: 4,
      weightedTransparency: true,
      presentationOverlay: false,
      estimatedBytes: 800 * 600 * 81,
    });
    expect(gpu.drawCalls).toEqual([
      { indexCount: 3, instanceCount: 3 },
      { indexCount: 3, instanceCount: 3 },
    ]);
    expect(gpu.textureCreations).toBe(7);
    expect(gpu.bindGroupCreations).toBe(8);
    expect(gpu.submissionCount).toBe(2);
    await expect(renderer.pick(400, 300)).resolves.toEqual({
      kind: "partOccurrence",
      partId: 1,
      partOccurrenceId: "1/0",
      worldPosition: unprojectPoint(camera, [400.5, 300.5, 0.5]),
    });
    expect(gpu.drawCalls).toHaveLength(3);
    expect(gpu.textureCreations).toBe(12);
    expect(gpu.submissionCount).toBe(4);
    await renderer.pick(300, 200);
    expect(gpu.drawCalls).toHaveLength(3);
    expect(gpu.submissionCount).toBe(5);
    renderer.resize(400, 300);
    renderer.destroy();
    renderer.destroy();
    expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    expect(gpu.textures.every((texture) => texture.destroyCount === 1)).toBe(true);
    expect(() => {
      renderer.render(runtime, camera, scene.parts);
    }).toThrow("destroyed");
  });

  it("keeps the bounds-derived triad scale stable while the camera moves", async () => {
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);

    renderer.render(runtime, camera, scene.parts, 0.1);
    renderer.render(runtime, zoomCamera(camera, Math.LN2), scene.parts, 0.1);

    const triadBuffer = gpu.buffers.find((record) => record.size === 48)?.resource;
    expect(triadBuffer).toBeDefined();
    const scales = gpu.writes
      .filter((write) => write.buffer === triadBuffer)
      .map((write) => new Float32Array(write.bytes.buffer, write.bytes.byteOffset, 1)[0]);
    expect(scales).toHaveLength(2);
    expect(scales[0]).toBeCloseTo(0.1, 5);
    expect(scales[1]).toBeCloseTo(0.1, 5);
    renderer.destroy();
  });

  it("does not write a disabled origin triad", async () => {
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas(), originTriad: false });
    const scene = buildScene();
    renderer.render(createPackedSceneRuntime(scene), camera, scene.parts, 10);

    expect(
      gpu.renderPipelineDescriptors.some(
        (descriptor) => descriptor.label === "world-origin triad visible",
      ),
    ).toBe(false);
    renderer.destroy();
  });

  it("replays authored points only when the origin triad is present", async () => {
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas(), originTriad: false });
    const scene = buildPointScene();

    renderer.render(createPackedSceneRuntime(scene), camera, scene.parts);

    expect(readGpuCostSnapshot(renderer).draws["point-replay"]).toEqual({
      calls: 1,
      indices: 6,
      instances: 1,
    });
    renderer.destroy();
  });

  it("rebuilds caller parts after reset when the same source map is rendered", async () => {
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);

    renderer.render(runtime, camera, scene.parts);
    const drawCallsBeforeReset = gpu.drawCalls.length;
    renderer.resetScene(scene.parts);
    renderer.render(runtime, camera, scene.parts);

    expect(gpu.drawCalls.length).toBeGreaterThan(drawCallsBeforeReset);
    renderer.destroy();
  });
});
