import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebGpuRenderer, readGpuCostSnapshot } from "../../src/renderer/gpu-renderer";
import { createPart } from "../../src/geometry/part";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { createInteractionState, setPartOverride } from "../../src/interaction/interaction";
import {
  setBodyHighlighted,
  setBodyOverride,
  setBodySelected,
  setBodyVisible,
} from "../../src/interaction/bodies";
import { setElementOverride } from "../../src/interaction/interaction";
import { createScene, type Scene } from "../../src/scene/scene";
import { identity, translation } from "../../src/math/mat4";
import { projectPoint, unprojectPoint, type Camera, zoomCamera } from "../../src/camera/camera";
import {
  fakeCanvas,
  fakeGpuDevice,
  installFreshDeviceNavigator,
  installGpuGlobals,
} from "./fake-gpu";

const originalNavigator = globalThis.navigator;
const originalDevicePixelRatio = globalThis.devicePixelRatio;

let restoreGpuGlobals: (() => void) | undefined;

afterEach(() => {
  restoreGpuGlobals?.();
  restoreGpuGlobals = undefined;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, "devicePixelRatio", {
    configurable: true,
    value: originalDevicePixelRatio,
  });
});

function installNavigator(device: GPUDevice): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      gpu: {
        getPreferredCanvasFormat: () => "bgra8unorm",
        requestAdapter: () => {
          return Promise.resolve({ requestDevice: () => Promise.resolve(device) });
        },
      },
    },
  });
}

function buildScene(): Scene {
  const geometry = {
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
  };
  return createScene()
    .addPart(createPart(1, geometry))
    .addAssembly({
      id: 1,
      name: "root",
      placements: [
        { kind: "part", partId: 1, transform: translation(0, 0, 0) },
        { kind: "part", partId: 1, transform: translation(2, 0, 0) },
        { kind: "part", partId: 1, transform: translation(4, 0, 0) },
      ],
    })
    .withRoot(1)
    .build();
}

function buildFaceScene(): Scene {
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]);
  const geometry = {
    positions,
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
    nodePositions: positions,
    faces: [
      {
        elementId: 0,
        faceIndex: 0,
        primitiveStart: 0,
        primitiveCount: 1,
        key: "0:1:2",
        nodeIds: [0, 1, 2],
        neighborElementIds: [],
      },
    ],
  };
  return createScene()
    .addPart(createPart(1, geometry))
    .addAssembly({
      id: 1,
      name: "root",
      placements: [{ kind: "part", partId: 1, transform: identity() }],
    })
    .withRoot(1)
    .build();
}

function buildBodyScene(): Scene {
  const geometry = {
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
    elements: [{ id: 0, primitiveStart: 0, primitiveCount: 1, bodyId: 3 }],
    bodies: [{ id: 3, name: "body", elementIds: [0] }],
  };
  return createScene()
    .addPart(createPart(1, geometry))
    .addAssembly({
      id: 1,
      name: "root",
      placements: [{ kind: "part", partId: 1, transform: identity() }],
    })
    .withRoot(1)
    .build();
}

const camera: Camera = {
  mode: "perspective",
  position: [3, 3, 5],
  target: [0, 0, 0],
  up: [0, 1, 0],
  fovY: Math.PI / 3,
  near: 0.01,
  far: 100,
  orthoHeight: 6,
  width: 800,
  height: 600,
};

describe("WebGPU renderer", () => {
  it("reports unavailable WebGPU clearly", async () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    await expect(createWebGpuRenderer({ canvas: fakeCanvas() })).rejects.toThrow(
      "WebGPU is unavailable",
    );
  });

  it("renders, uploads, picks, resizes, and destroys with a mocked device", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice({ pickValue: 1, ndcDepth: 0.5 });
    installNavigator(gpu.device);

    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    await expect(renderer.pick(1, 1)).resolves.toBeUndefined();
    renderer.render(runtime, camera, scene.parts);
    renderer.render(runtime, camera, scene.parts);
    const cost = readGpuCostSnapshot(renderer);
    expect(cost.passes).toEqual({ opaque: 1, transparency: 1, composite: 1, pick: 0 });
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
      estimatedBytes: 800 * 600 * 96,
    });
    expect(gpu.drawCalls).toEqual([
      { indexCount: 3, instanceCount: 3 },
      { indexCount: 3, instanceCount: 3 },
    ]);
    expect(gpu.textureCreations).toBe(7);
    expect(gpu.bindGroupCreations).toBe(7);
    expect(gpu.submissionCount).toBe(2);
    await expect(renderer.pick(400, 300)).resolves.toEqual({
      kind: "instance",
      partId: 1,
      instanceId: "1/0",
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
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
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
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
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

  it("reuses pick snapshots until pick-relevant state changes", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice({ pickValue: 1 });
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    const interaction = createInteractionState();

    renderer.render(runtime, camera, scene.parts);
    await renderer.pick(100, 100);
    expect(gpu.drawCalls).toHaveLength(2);
    await renderer.pick(200, 200);
    expect(gpu.drawCalls).toHaveLength(2);

    const styled = setPartOverride(interaction, 1, {
      color: { r: 1, g: 0, b: 0, a: 1 },
    });
    renderer.updateInstances(runtime, styled, [0]);
    renderer.render(runtime, camera, scene.parts);
    await renderer.pick(300, 300);
    expect(gpu.drawCalls).toHaveLength(3);

    const wider = setPartOverride(interaction, 1, { lineWidthPixels: 12 });
    renderer.updateInstances(runtime, wider, [0]);
    renderer.render(runtime, camera, scene.parts);
    await renderer.pick(300, 300);
    expect(gpu.drawCalls).toHaveLength(5);

    const movedCamera = { ...camera, target: [1, 0, 0] as const };
    renderer.render(runtime, movedCamera, scene.parts);
    await renderer.pick(300, 300);
    expect(gpu.drawCalls).toHaveLength(7);

    const hidden = runtime.setInstanceVisible(1, false);
    renderer.updateVisibility(runtime, hidden.changedInstanceIds);
    renderer.render(runtime, movedCamera, scene.parts);
    await renderer.pick(300, 300);
    expect(gpu.drawCalls).toHaveLength(9);

    renderer.resize(400, 300);
    await renderer.pick(150, 100);
    expect(gpu.drawCalls).toHaveLength(10);

    renderer.setDeformation({
      scale: 1,
      displacements: new Map([[1, new Float32Array(9)]]),
    });
    renderer.render(runtime, movedCamera, scene.parts);
    await renderer.pick(150, 100);
    expect(gpu.drawCalls).toHaveLength(12);
    renderer.destroy();
  });

  it("invalidates pick snapshots when body visibility changes", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice({ pickValue: 1 });
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildBodyScene();
    const runtime = createPackedSceneRuntime(scene);
    const body = { instanceId: "1/0", bodyId: 3 } as const;
    let interaction = createInteractionState();

    renderer.render(runtime, camera, scene.parts);
    renderer.updateElements(runtime, interaction);
    await renderer.pick(100, 100);
    expect(gpu.drawCalls).toHaveLength(2);

    interaction = setBodyVisible(interaction, body, false);
    renderer.updateElements(runtime, interaction);
    renderer.render(runtime, camera, scene.parts);
    await renderer.pick(100, 100);
    expect(gpu.drawCalls).toHaveLength(4);

    renderer.updateElements(runtime, interaction);
    renderer.render(runtime, camera, scene.parts);
    await renderer.pick(100, 100);
    expect(gpu.drawCalls).toHaveLength(5);

    interaction = setBodyVisible(interaction, body, true);
    renderer.updateElements(runtime, interaction);
    renderer.render(runtime, camera, scene.parts);
    await renderer.pick(100, 100);
    expect(gpu.drawCalls).toHaveLength(7);

    interaction = setBodySelected(interaction, body, true);
    renderer.updateElements(runtime, interaction);
    renderer.render(runtime, camera, scene.parts);
    await renderer.pick(100, 100);
    expect(gpu.drawCalls).toHaveLength(10);

    interaction = setBodyHighlighted(interaction, body, true);
    renderer.updateElements(runtime, interaction);
    renderer.render(runtime, camera, scene.parts);
    await renderer.pick(100, 100);
    expect(gpu.drawCalls).toHaveLength(13);

    renderer.destroy();
  });

  it.each(["perspective", "orthographic"] as const)(
    "resolves a visible face pixel to an exact world-space point in %s mode",
    async (mode) => {
      restoreGpuGlobals = installGpuGlobals();
      const faceCamera = {
        ...camera,
        mode,
        position: [0, 0, 5] as const,
        target: [0, 0, 0] as const,
      };
      const depth = projectPoint(faceCamera, [0, 0, 0])?.[2] ?? 1;
      const gpu = fakeGpuDevice({
        pickValue: 1,
        elementPickValue: 1,
        facePickValue: 1,
        ndcDepth: depth,
      });
      installNavigator(gpu.device);
      const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
      const scene = buildFaceScene();
      const runtime = createPackedSceneRuntime(scene);
      renderer.render(runtime, faceCamera, scene.parts);

      await expect(renderer.pick(400, 300)).resolves.toMatchObject({
        kind: "face",
        partId: 1,
        instanceId: "1/0",
        elementId: 0,
        key: "0:1:2",
        worldPosition: unprojectPoint(faceCamera, [400.5, 300.5, depth]),
      });

      await expect(renderer.pickPoint(faceCamera, 400, 300)).resolves.toEqual(
        unprojectPoint(faceCamera, [400.5, 300.5, depth]),
      );
      renderer.destroy();
    },
  );

  it("reconstructs a displayed point in a large-coordinate camera frame", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const faceCamera = {
      ...camera,
      position: [10_000, 20_000, 30_005] as const,
      target: [10_000, 20_000, 30_000] as const,
      far: 100,
    };
    const displayedPoint = [10_000, 20_000, 30_001] as const;
    const depth = projectPoint(faceCamera, displayedPoint)?.[2] ?? 1;
    const gpu = fakeGpuDevice({ pickValue: 1, facePickValue: 1, ndcDepth: depth });
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildFaceScene();
    renderer.render(createPackedSceneRuntime(scene), faceCamera, scene.parts);

    await expect(renderer.pickPoint(faceCamera, 400, 300)).resolves.toEqual(
      unprojectPoint(faceCamera, [400.5, 300.5, Math.fround(depth)]),
    );
    renderer.destroy();
  });

  it("follows displayed GPU depth instead of the undeformed CPU face plane", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const faceCamera = { ...camera, position: [0, 0, 5] as const, target: [0, 0, 0] as const };
    const displayedDepth = projectPoint(faceCamera, [0, 0, 1])?.[2] ?? 1;
    const gpu = fakeGpuDevice({ pickValue: 1, facePickValue: 1, ndcDepth: displayedDepth });
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildFaceScene();
    renderer.render(createPackedSceneRuntime(scene), faceCamera, scene.parts);

    const point = await renderer.pickPoint(faceCamera, 400, 300);
    expect(point?.[2]).toBeCloseTo(1, 3);
    renderer.destroy();
  });

  it("patches only the affected GPU subranges from packed deltas", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);

    const instanceWrites = () => gpu.writes.filter((write) => write.bytes.byteLength !== 64);
    const writeRanges = (start: number) =>
      instanceWrites()
        .slice(start)
        .map((write) => [write.offset, write.bytes.byteLength]);

    const override = setPartOverride(createInteractionState(), 1, {
      color: { r: 0.75, g: 0.1, b: 0.25, a: 1 },
      opacity: 0.1,
    });
    const beforeStyle = instanceWrites().length;
    renderer.updateInstances(runtime, override, [0]);
    expect(writeRanges(beforeStyle)).toEqual([
      [64, 16],
      [0, 4],
    ]);

    const beforeNoop = instanceWrites().length;
    renderer.updateInstances(runtime, override, [0]);
    expect(instanceWrites().length).toBe(beforeNoop);

    const hidden = runtime.setInstanceVisible(1, false);
    const beforeVisibility = instanceWrites().length;
    renderer.updateInstances(runtime, override, hidden.changedInstanceIds);
    expect(writeRanges(beforeVisibility)).toEqual([
      [160, 16],
      [4, 8],
    ]);

    renderer.render(runtime, camera, scene.parts);
    expect(gpu.drawCalls.at(-1)).toEqual({ indexCount: 3, instanceCount: 1 });

    runtime.setInstanceVisible(1, true);
    renderer.updateInstances(runtime, override, [0, 1, 2]);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.drawCalls.at(-1)).toEqual({ indexCount: 3, instanceCount: 3 });
  });

  it("culls hidden parts from the draw order without rewriting records", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);

    const hidden = runtime.setPartVisible(1, false);
    renderer.updateVisibility(runtime, hidden.changedInstanceIds);
    const callsBefore = gpu.drawCalls.length;
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.drawCalls.length).toBe(callsBefore);

    const shown = runtime.setPartVisible(1, true);
    renderer.updateVisibility(runtime, shown.changedInstanceIds);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.drawCalls.at(-1)).toEqual({ indexCount: 3, instanceCount: 3 });
  });

  it("reports device loss, blocks rendering, and recovers on a fresh device", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpus = installFreshDeviceNavigator();
    const onLost = vi.fn();
    const renderer = await createWebGpuRenderer({
      canvas: fakeCanvas(),
      onDeviceLost: onLost,
      pointSizePixels: 12,
      nodeSizePixels: 5,
    });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.setPointSizePixels(14);
    renderer.setNodeSizePixels(7);
    renderer.render(runtime, camera, scene.parts);
    renderer.setDeformation({
      scale: 1,
      displacements: new Map([[1, new Float32Array([1, 0, 0])]]),
    });
    renderer.render(runtime, camera, scene.parts);
    const latestDisplacements = new Float32Array([2, 0, 0, 0, 2, 0]);
    renderer.setDeformation({
      scale: 3,
      displacements: new Map([[1, latestDisplacements]]),
    });
    renderer.render(runtime, camera, scene.parts);
    const first = gpus[0];
    if (first === undefined) throw new Error("no fake device created");
    expect(first.drawCalls.length).toBeGreaterThan(0);
    expect(renderer.lost).toBe(false);
    expect(renderer.device).toBe(first.device);

    first.lose("unknown", "gpu device crashed");
    await first.lost;
    expect(renderer.lost).toBe(true);
    expect(onLost).toHaveBeenCalledWith({ reason: "unknown", message: "gpu device crashed" });
    expect(() => {
      renderer.render(runtime, camera, scene.parts);
    }).toThrow(/lost/);
    await expect(renderer.pick(1, 1)).rejects.toThrow(/lost/);

    await renderer.recover();
    expect(renderer.lost).toBe(false);
    expect(gpus).toHaveLength(2);
    const second = gpus[1];
    if (second === undefined) throw new Error("no recovered device created");
    expect(renderer.device).toBe(second.device);
    renderer.render(runtime, camera, scene.parts);
    expect(second.drawCalls.length).toBeGreaterThan(0);
    const recoveredCamera = second.buffers.find(
      (buffer) => buffer.size === 128 && (buffer.usage & 1) !== 0,
    );
    const recoveredCameraWrite = second.writes
      .filter((write) => write.buffer === recoveredCamera?.resource)
      .at(-1);
    expect(recoveredCameraWrite).toBeDefined();
    expect(
      recoveredCameraWrite === undefined
        ? undefined
        : Array.from(new Float32Array(recoveredCameraWrite.bytes.buffer).slice(18, 21)),
    ).toEqual([14, 7, 1]);
    const recoveredDisplacement = second.buffers.find(
      (buffer) => buffer.size === latestDisplacements.byteLength && (buffer.usage & 16) !== 0,
    );
    expect(recoveredDisplacement).toBeDefined();
    expect(second.writes.some((write) => write.buffer === recoveredDisplacement?.resource)).toBe(
      true,
    );
    renderer.destroy();
  });

  it("cannot recover an externally provided device", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const external = fakeGpuDevice();
    installNavigator(external.device);
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
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws).toEqual([
      { pipeline: "pipeline-0", indexCount: 3, instanceCount: 3 },
    ]);

    const edge = setPartOverride(createInteractionState(), 1, { edge: true });
    renderer.updateInstances(runtime, edge, [0, 1, 2]);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws.slice(-2)).toEqual([
      { pipeline: "pipeline-0", indexCount: 3, instanceCount: 3 },
      { pipeline: "pipeline-17", indexCount: 6, instanceCount: 3 },
    ]);

    renderer.setEdgeDepthTest(false);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws.at(-1)).toEqual({
      pipeline: "pipeline-18",
      indexCount: 6,
      instanceCount: 3,
    });

    renderer.setEdgeDepthTest(true);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws.at(-1)).toEqual({
      pipeline: "pipeline-17",
      indexCount: 6,
      instanceCount: 3,
    });

    renderer.destroy();
  });

  it("keeps transparent fragments in the OIT pass without removing opaque batches", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);

    const transparent = setPartOverride(createInteractionState(), 1, { opacity: 0.5 });
    renderer.updateInstances(runtime, transparent, [0, 1, 2]);
    renderer.render(runtime, camera, scene.parts);

    expect(gpu.pipelineDraws.slice(-2)).toEqual([
      { pipeline: "pipeline-0", indexCount: 3, instanceCount: 3 },
      { pipeline: "pipeline-1", indexCount: 3, instanceCount: 3 },
    ]);
    renderer.destroy();
  });

  it("keeps zero-opacity geometry in the pick pass", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice({ pickValue: 1, ndcDepth: 0.5 });
    installNavigator(gpu.device);
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
      kind: "instance",
      partId: 1,
    });
    renderer.destroy();
  });

  it.each([
    ["instance", () => setPartOverride(createInteractionState(), 1, { opacity: 0.5 })],
    [
      "body",
      () =>
        setBodyOverride(
          createInteractionState(),
          { instanceId: "1/0", bodyId: 3 },
          { opacity: 0.5 },
        ),
    ],
    [
      "element",
      () =>
        setElementOverride(
          createInteractionState(),
          { instanceId: "1/0", elementId: 0 },
          { opacity: 0.5 },
        ),
    ],
  ])("classifies fractional %s alpha in the transparent pass", async (level, createState) => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = level === "body" ? buildBodyScene() : buildFaceScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);
    const interaction = createState();
    if (level === "instance") renderer.updateInstances(runtime, interaction, [0]);
    else renderer.updateElements(runtime, interaction);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws.slice(-2)).toEqual([
      { pipeline: "pipeline-0", indexCount: 3, instanceCount: 1 },
      { pipeline: "pipeline-1", indexCount: 3, instanceCount: 1 },
    ]);
    renderer.destroy();
  });

  it("culls hidden instances from the edge overlay and restores them on show", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);
    const edge = setPartOverride(createInteractionState(), 1, { edge: true });
    renderer.updateInstances(runtime, edge, [0, 1, 2]);

    const hidden = runtime.setInstanceVisible(1, false);
    renderer.updateInstances(runtime, edge, hidden.changedInstanceIds);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws.at(-1)).toEqual({
      pipeline: "pipeline-17",
      indexCount: 6,
      instanceCount: 2,
    });

    runtime.setInstanceVisible(1, true);
    renderer.updateInstances(runtime, edge, [0, 1, 2]);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws.at(-1)).toEqual({
      pipeline: "pipeline-17",
      indexCount: 6,
      instanceCount: 3,
    });

    renderer.destroy();
  });
  it("rebuilds the attachment when a runtime is replaced", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const geometry = {
      positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles" as const,
    };
    const part1 = createPart(1, geometry);

    const wrapped = createScene()
      .addPart(part1)
      .addAssembly({
        id: 2,
        name: "wrapped",
        placements: [{ kind: "part", partId: 1, transform: translation(0, 0, 0) }],
      })
      .addAssembly({
        id: 1,
        name: "root",
        placements: [{ kind: "assembly", assemblyId: 2, transform: identity() }],
      })
      .withRoot(1)
      .build();
    const runtime1 = createPackedSceneRuntime(wrapped);
    renderer.render(runtime1, camera, wrapped.parts);
    expect(gpu.buffers.every((buffer) => !buffer.destroyed)).toBe(true);

    const replacementScene = createScene()
      .addPart(part1)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: translation(0, 0, 0) },
          { kind: "part", partId: 1, transform: translation(2, 0, 0) },
        ],
      })
      .withRoot(1)
      .build();
    const runtime2 = createPackedSceneRuntime(replacementScene);
    renderer.render(runtime2, camera, replacementScene.parts);

    expect(gpu.buffers.some((buffer) => buffer.destroyed)).toBe(true);
    renderer.destroy();
  });
});

describe("WebGPU renderer deformation", () => {
  function uniformWrite(gpu: ReturnType<typeof fakeGpuDevice>) {
    const buffer = gpu.buffers.find(
      (candidate) => candidate.size === 16 && (candidate.usage & 1) !== 0,
    );
    return gpu.writes.find((write) => write.buffer === buffer?.resource);
  }

  it("writes a disabled deformation uniform before any deformation is set", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);
    const ids = new Uint32Array(uniformWrite(gpu)?.bytes.buffer ?? new ArrayBuffer(0), 0, 4);
    expect(ids[1]).toBe(0);
    expect(ids[2]).toBe(0);
    renderer.destroy();
  });

  it("uploads displacement buffers and writes the deformation uniform", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.setDeformation({
      scale: 2,
      displacements: new Map([[1, new Float32Array(3 * 3)]]),
    });
    renderer.render(runtime, camera, scene.parts);
    const write = uniformWrite(gpu);
    const floats = new Float32Array(write?.bytes.buffer ?? new ArrayBuffer(0), 0, 4);
    const ids = new Uint32Array(write?.bytes.buffer ?? new ArrayBuffer(0), 0, 4);
    expect(floats[0]).toBe(2);
    expect(ids[1]).toBe(0);
    expect(ids[2]).toBe(0);
    const storage = gpu.buffers.find((buffer) => buffer.size === 36 && (buffer.usage & 16) !== 0);
    expect(storage).toBeDefined();
    expect(gpu.writes.some((entry) => entry.buffer === storage?.resource)).toBe(true);
    renderer.destroy();
  });

  it("clears deformation buffers and disables the uniform when set to undefined", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.setDeformation({
      scale: 2,
      displacements: new Map([[1, new Float32Array(9)]]),
    });
    renderer.render(runtime, camera, scene.parts);
    const deformationBuffer = gpu.buffers.find(
      (buffer) => buffer.size === 36 && (buffer.usage & 16) !== 0,
    );
    expect(deformationBuffer).toBeDefined();

    renderer.setDeformation(undefined);
    renderer.render(runtime, camera, scene.parts);

    expect(deformationBuffer?.destroyed).toBe(true);
    const uniformBuffer = gpu.buffers.find(
      (buffer) => buffer.size === 16 && (buffer.usage & 1) !== 0,
    );
    const write = gpu.writes.filter((entry) => entry.buffer === uniformBuffer?.resource).at(-1);
    const ids = new Uint32Array(write?.bytes.buffer ?? new ArrayBuffer(0), 0, 4);
    expect(ids[1]).toBe(0);
    expect(ids[2]).toBe(0);
    renderer.destroy();
  });

  it("reuses uploaded displacement buffers across frames until the array changes", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    const deformation = {
      scale: 1,
      displacements: new Map([[1, new Float32Array(3 * 3)]]),
    };
    renderer.setDeformation(deformation);
    renderer.render(runtime, camera, scene.parts);
    const storage = gpu.buffers.find((buffer) => buffer.size === 36 && (buffer.usage & 16) !== 0);
    const uploads = () => gpu.writes.filter((write) => write.buffer === storage?.resource).length;
    expect(uploads()).toBe(1);
    renderer.render(runtime, camera, scene.parts);
    expect(uploads()).toBe(1);
    renderer.setDeformation({
      ...deformation,
      displacements: new Map([[1, new Float32Array(9)]]),
    });
    renderer.render(runtime, camera, scene.parts);
    expect(uploads()).toBe(2);
    renderer.destroy();
  });

  it("rejects an invalid deformation state", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    expect(() => {
      renderer.setDeformation({
        scale: 1,
        displacements: new Map([[1, new Float32Array(5)]]),
      });
    }).toThrow(/not a multiple of 3/);
    renderer.destroy();
  });
});
