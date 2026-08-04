import { afterEach, describe, expect, it } from "vitest";
import { createWebGpuRenderer } from "../../src/renderer/gpu-renderer";
import { computeBounds } from "../../src/geometry/part";
import { createSceneRuntime } from "../../src/scene-runtime/runtime";
import { createInteractionState, setPartOverride } from "../../src/interaction/interaction";
import { createScene, type Scene } from "../../src/scene/scene";
import { translation } from "../../src/math/mat4";
import type { Camera } from "../../src/camera/camera";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "./fake-gpu";

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
});
