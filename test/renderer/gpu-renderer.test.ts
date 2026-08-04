import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebGpuRenderer } from "../../src/renderer/gpu-renderer";
import { computeBounds } from "../../src/geometry/part";
import { createSceneRuntime } from "../../src/scene-runtime/runtime";
import { createInteractionState, setPartOverride } from "../../src/interaction/interaction";
import { createScene, type Scene } from "../../src/scene/scene";
import { identity, translation } from "../../src/math/mat4";
import { partFromChunk, type ChunkSource } from "../../src/streaming/chunk";
import { parseChunk } from "../../src/streaming/parser";
import type { Camera } from "../../src/camera/camera";
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
  };
  return createScene()
    .addPart({ id: 1, geometry, bounds: computeBounds(geometry) })
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
    const gpu = fakeGpuDevice({ pickValue: 1 });
    installNavigator(gpu.device);

    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createSceneRuntime(scene);
    await expect(renderer.pick(1, 1)).resolves.toBeUndefined();
    renderer.render(runtime, camera, scene.parts);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.drawCalls).toEqual([
      { indexCount: 3, instanceCount: 3 },
      { indexCount: 3, instanceCount: 3 },
      { indexCount: 3, instanceCount: 3 },
      { indexCount: 3, instanceCount: 3 },
    ]);
    expect(gpu.textureCreations).toBe(4);
    expect(gpu.bindGroupCreations).toBe(2);
    await expect(renderer.pick(400, 300)).resolves.toEqual({ kind: "instance", instanceId: "1/0" });
    renderer.resize(400, 300);
    renderer.destroy();
    renderer.destroy();
    expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    expect(() => {
      renderer.render(runtime, camera, scene.parts);
    }).toThrow("destroyed");
  });

  it("patches only the affected GPU subranges from packed deltas", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createSceneRuntime(scene);
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
    expect(writeRanges(beforeStyle)).toEqual([[64, 16]]);

    const beforeNoop = instanceWrites().length;
    renderer.updateInstances(runtime, override, [0]);
    expect(instanceWrites().length).toBe(beforeNoop);

    runtime.setInstanceTransform(0, translation(10, 0, 0));
    const beforeTransform = instanceWrites().length;
    renderer.updateInstances(runtime, override, [0]);
    expect(writeRanges(beforeTransform)).toEqual([[48, 4]]);

    const hidden = runtime.setInstanceVisible(1, false);
    const beforeVisibility = instanceWrites().length;
    renderer.updateInstances(runtime, override, hidden.changedInstanceIds);
    expect(writeRanges(beforeVisibility)).toEqual([
      [160, 16],
      [4, 8],
    ]);

    renderer.render(runtime, camera, scene.parts);
    expect(gpu.drawCalls.at(-1)).toEqual({ indexCount: 3, instanceCount: 2 });

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
    const runtime = createSceneRuntime(scene);
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
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas(), onDeviceLost: onLost });
    const scene = buildScene();
    const runtime = createSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);
    const first = gpus[0];
    if (first === undefined) throw new Error("no fake device created");
    expect(first.drawCalls.length).toBeGreaterThan(0);
    expect(renderer.lost).toBe(false);

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
    renderer.render(runtime, camera, scene.parts);
    const second = gpus[1];
    if (second === undefined) throw new Error("no recovered device created");
    expect(second.drawCalls.length).toBeGreaterThan(0);
    renderer.destroy();
  });

  it("cannot recover an externally provided device", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const external = fakeGpuDevice();
    installNavigator(external.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas(), device: external.device });
    const scene = buildScene();
    const runtime = createSceneRuntime(scene);
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
    const runtime = createSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws).toEqual([
      { pipeline: "pipeline-0", indexCount: 3, instanceCount: 3 },
      { pipeline: "pipeline-1", indexCount: 3, instanceCount: 3 },
    ]);

    const edge = setPartOverride(createInteractionState(), 1, { edge: true });
    renderer.updateInstances(runtime, edge, [0, 1, 2]);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws.slice(-3)).toEqual([
      { pipeline: "pipeline-0", indexCount: 3, instanceCount: 3 },
      { pipeline: "pipeline-6", indexCount: 6, instanceCount: 3 },
      { pipeline: "pipeline-1", indexCount: 3, instanceCount: 3 },
    ]);

    renderer.setEdgeDepthTest(false);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws.at(-2)).toEqual({
      pipeline: "pipeline-7",
      indexCount: 6,
      instanceCount: 3,
    });

    renderer.setEdgeDepthTest(true);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws.at(-2)).toEqual({
      pipeline: "pipeline-6",
      indexCount: 6,
      instanceCount: 3,
    });

    renderer.destroy();
  });

  it("culls hidden instances from the edge overlay and restores them on show", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);
    const edge = setPartOverride(createInteractionState(), 1, { edge: true });
    renderer.updateInstances(runtime, edge, [0, 1, 2]);

    const hidden = runtime.setInstanceVisible(1, false);
    renderer.updateInstances(runtime, edge, hidden.changedInstanceIds);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws.at(-2)).toEqual({
      pipeline: "pipeline-6",
      indexCount: 6,
      instanceCount: 2,
    });

    runtime.setInstanceVisible(1, true);
    renderer.updateInstances(runtime, edge, [0, 1, 2]);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws.at(-2)).toEqual({
      pipeline: "pipeline-6",
      indexCount: 6,
      instanceCount: 3,
    });

    renderer.destroy();
  });
  it("grows progressively when a chunked runtime appends a part, uploading only the delta", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice({ pickValue: 2 });
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });

    const firstScene = chunkedScene(1, triangleChunk);
    const firstRuntime = createSceneRuntime(firstScene);
    renderer.render(firstRuntime, camera, firstScene.parts);
    const buffersAfterFirst = gpu.buffers.length;
    const texturesAfterFirst = gpu.textureCreations;
    expect(buffersAfterFirst).toBeGreaterThan(0);

    const grownScene = chunkedScene(2, triangleChunk);
    const grownRuntime = createSceneRuntime(grownScene);
    renderer.render(grownRuntime, camera, grownScene.parts);
    renderer.render(grownRuntime, camera, grownScene.parts);

    expect(gpu.buffers.every((buffer) => !buffer.destroyed)).toBe(true);
    expect(gpu.textureCreations).toBe(texturesAfterFirst);
    expect(gpu.buffers.length - buffersAfterFirst).toBe(9);
    expect(gpu.drawCalls.slice(-4)).toEqual([
      { indexCount: 3, instanceCount: 1 },
      { indexCount: 3, instanceCount: 1 },
      { indexCount: 3, instanceCount: 1 },
      { indexCount: 3, instanceCount: 1 },
    ]);
    await expect(renderer.pick(400, 300)).resolves.toEqual({
      kind: "instance",
      instanceId: "1/1/0",
    });
    renderer.destroy();
  });

  it("grows only the affected part storage when a chunk appends existing-part instances", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const geometry = {
      positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
      indices: new Uint32Array([0, 1, 2]),
    };
    const place = (id: number, x: number) => ({
      kind: "part" as const,
      partId: id,
      transform: translation(x, 0, 0),
    });
    const scene1 = createScene()
      .addPart({ id: 1, geometry, bounds: computeBounds(geometry) })
      .addAssembly({
        id: 1,
        name: "root",
        placements: [place(1, 0), place(1, 2)],
      })
      .withRoot(1)
      .build();
    const runtime1 = createSceneRuntime(scene1);
    renderer.render(runtime1, camera, scene1.parts);
    const buffersAfterFirst = gpu.buffers.length;

    const scene2 = createScene()
      .addPart({ id: 1, geometry, bounds: computeBounds(geometry) })
      .addAssembly({
        id: 1,
        name: "root",
        placements: [place(1, 0), place(1, 2), place(1, 4), place(1, 6)],
      })
      .withRoot(1)
      .build();
    const runtime2 = createSceneRuntime(scene2);
    renderer.render(runtime2, camera, scene2.parts);

    expect(gpu.buffers.every((buffer) => !buffer.destroyed)).toBe(true);
    expect(gpu.buffers.length - buffersAfterFirst).toBe(3);
    expect(gpu.drawCalls.slice(-2)).toEqual([
      { indexCount: 3, instanceCount: 4 },
      { indexCount: 3, instanceCount: 4 },
    ]);
    renderer.destroy();
  });

  it("falls back to a full rebuild when a runtime change is not a compatible append", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const geometry = {
      positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
      indices: new Uint32Array([0, 1, 2]),
    };
    const part1 = { id: 1, geometry, bounds: computeBounds(geometry) };

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
    const runtime1 = createSceneRuntime(wrapped);
    renderer.render(runtime1, camera, wrapped.parts);
    expect(gpu.buffers.every((buffer) => !buffer.destroyed)).toBe(true);

    const flattened = createScene()
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
    const runtime2 = createSceneRuntime(flattened);
    renderer.render(runtime2, camera, flattened.parts);

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
    const runtime = createSceneRuntime(scene);
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
    const runtime = createSceneRuntime(scene);
    renderer.setDeformation({
      scale: 2,
      loadCase: 1,
      loadCaseCount: 2,
      displacements: new Map([[1, new Float32Array(3 * 2 * 3)]]),
    });
    renderer.render(runtime, camera, scene.parts);
    const write = uniformWrite(gpu);
    const floats = new Float32Array(write?.bytes.buffer ?? new ArrayBuffer(0), 0, 4);
    const ids = new Uint32Array(write?.bytes.buffer ?? new ArrayBuffer(0), 0, 4);
    expect(floats[0]).toBe(2);
    expect(ids[1]).toBe(1);
    expect(ids[2]).toBe(2);
    const storage = gpu.buffers.find((buffer) => buffer.size === 72 && (buffer.usage & 16) !== 0);
    expect(storage).toBeDefined();
    expect(gpu.writes.some((entry) => entry.buffer === storage?.resource)).toBe(true);
    renderer.destroy();
  });

  it("reuses uploaded displacement buffers across frames until the array changes", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createSceneRuntime(scene);
    const deformation = {
      scale: 1,
      loadCase: 0,
      loadCaseCount: 1,
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
        loadCase: 5,
        loadCaseCount: 2,
        displacements: new Map(),
      });
    }).toThrow(/out of range/);
    renderer.destroy();
  });
});

/** A deterministic single-triangle chunk, one part placement wide. */
function triangleChunk(chunkId: number, index: number, x: number): ChunkSource {
  return {
    chunkId,
    index,
    data: {
      positions: new Float32Array([x, -0.5, 0, x + 1, -0.5, 0, x + 0.5, 0.5, 0]),
      indices: new Uint32Array([0, 1, 2]),
    },
  };
}

/** Scene with chunk parts `1..partCount`, each placed once under sub-assembly `id`. */
function chunkedScene(
  partCount: number,
  chunk: (chunkId: number, index: number, x: number) => ChunkSource,
): Scene {
  let builder = createScene();
  const rootPlacements: Array<{ kind: "assembly"; assemblyId: number; transform: Float32Array }> =
    [];
  for (let id = 1; id <= partCount; id++) {
    const part = partFromChunk(parseChunk(chunk(id, id - 1, (id - 1) * 3)), id);
    builder = builder.addPart(part);
    const subcaseId = id + 100;
    builder = builder.addAssembly({
      id: subcaseId,
      name: `chunk-${id}`,
      placements: [{ kind: "part", partId: id, transform: identity() }],
    });
    rootPlacements.push({ kind: "assembly", assemblyId: subcaseId, transform: identity() });
  }
  return builder
    .addAssembly({ id: 1, name: "root", placements: rootPlacements })
    .withRoot(1)
    .build();
}
