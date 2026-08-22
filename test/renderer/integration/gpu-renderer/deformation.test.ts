import { expect, it, describe } from "vitest";
import type { DeformationState } from "@/results/deform";
import {
  createWebGpuRenderer,
  createPackedSceneRuntime,
  fakeCanvas,
  fakeGpuDevice,
  buildScene,
  camera,
  uniformWrite,
  installGpuTestEnvironment,
} from "./support";

describe("WebGPU renderer deformation", () => {
  it("writes a disabled deformation uniform before any deformation is set", async () => {
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
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
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    setDeformation(renderer, {
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
    const storage = gpu.buffers.find((buffer) => buffer.size === 56 && (buffer.usage & 16) !== 0);
    expect(storage).toBeDefined();
    expect(gpu.writes.some((entry) => entry.buffer === storage?.resource)).toBe(true);
    renderer.destroy();
  });

  it("clears deformation buffers and disables the uniform when set to undefined", async () => {
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    setDeformation(renderer, {
      scale: 2,
      displacements: new Map([[1, new Float32Array(9)]]),
    });
    renderer.render(runtime, camera, scene.parts);
    const deformationBuffer = gpu.buffers.find(
      (buffer) => buffer.size === 56 && (buffer.usage & 16) !== 0,
    );
    expect(deformationBuffer).toBeDefined();

    setDeformation(renderer, undefined);
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
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    const deformation = {
      scale: 1,
      displacements: new Map([[1, new Float32Array(3 * 3)]]),
    };
    setDeformation(renderer, deformation);
    renderer.render(runtime, camera, scene.parts);
    const storage = gpu.buffers.find((buffer) => buffer.size === 56 && (buffer.usage & 16) !== 0);
    const uploads = () => gpu.writes.filter((write) => write.buffer === storage?.resource).length;
    expect(uploads()).toBe(1);
    renderer.render(runtime, camera, scene.parts);
    expect(uploads()).toBe(1);
    setDeformation(renderer, {
      ...deformation,
      displacements: new Map([[1, new Float32Array(9)]]),
    });
    renderer.render(runtime, camera, scene.parts);
    expect(uploads()).toBe(2);
    renderer.destroy();
  });

  it("rejects an invalid deformation state", async () => {
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    const valid = { scale: 2, displacements: new Map([[1, new Float32Array(9)]]) };
    renderer.setResultSnapshot({ deformation: valid, colors: undefined, glyphs: undefined });
    expect(() => {
      renderer.setResultSnapshot({
        deformation: { scale: 1, displacements: new Map([[1, new Float32Array(5)]]) },
        colors: new Map(),
        glyphs: undefined,
      });
    }).toThrow(/not a multiple of 3/);
    renderer.render(runtime, camera, scene.parts);
    const floats = new Float32Array(uniformWrite(gpu)?.bytes.buffer ?? new ArrayBuffer(0), 0, 4);
    expect(floats[0]).toBe(valid.scale);
    renderer.destroy();
  });
});

function setDeformation(
  renderer: Awaited<ReturnType<typeof createWebGpuRenderer>>,
  deformation: DeformationState | undefined,
): void {
  renderer.setResultSnapshot({ deformation, colors: undefined, glyphs: undefined });
}
