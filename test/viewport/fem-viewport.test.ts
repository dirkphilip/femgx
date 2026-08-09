import { afterEach, describe, expect, it, vi } from "vitest";
import { computeBounds } from "../../src/geometry/part";
import { setPartOverride } from "../../src/interaction/interaction";
import { translation } from "../../src/math/mat4";
import { createScene } from "../../src/scene/scene";
import { createFemViewport } from "../../src/viewport/fem-viewport";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "../renderer/fake-gpu";

let restoreGpuGlobals: (() => void) | undefined;
const originalNavigator = globalThis.navigator;

afterEach(() => {
  restoreGpuGlobals?.();
  restoreGpuGlobals = undefined;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

function installNavigator(): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: { getPreferredCanvasFormat: () => "bgra8unorm" } },
  });
}

function scene(offset = 0) {
  const geometry = {
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  };
  return createScene()
    .addPart({ id: 1, geometry, bounds: computeBounds(geometry) })
    .addAssembly({
      id: 1,
      name: "root",
      placements: [{ kind: "part", partId: 1, transform: translation(offset, 0, 0) }],
    })
    .withRoot(1)
    .build();
}

describe("FemViewport", () => {
  it("owns fitted camera, runtime, interaction, visibility, resize, and teardown", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const canvas = fakeCanvas(640, 360);
    const onRender = vi.fn();
    const viewport = await createFemViewport({
      canvas,
      scene: scene(),
      device: gpu.device,
      onRender,
    });

    expect(viewport.runtime.instanceCount).toBe(1);
    expect(viewport.camera.width).toBe(640);
    expect(viewport.stats()).toEqual({ visibleInstances: 1, drawBatches: 1 });
    expect(onRender).toHaveBeenCalledOnce();

    const interaction = setPartOverride(viewport.interaction, 1, {
      color: { r: 1, g: 0, b: 0, a: 1 },
    });
    viewport.setInteraction(interaction);
    viewport.setEdgeDepthTest(false);
    viewport.setNodeOverlay(true);
    viewport.render();
    expect(viewport.interaction).toBe(interaction);

    viewport.setPartVisible(1, false);
    expect(viewport.stats().visibleInstances).toBe(0);
    viewport.setPartVisible(1, true);
    viewport.setInstanceVisible(0, false);
    expect(viewport.stats().visibleInstances).toBe(0);

    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 200 });
    viewport.resize();
    expect(viewport.camera.width).toBe(320);
    expect(viewport.camera.height).toBe(200);

    viewport.setScene(scene(10));
    viewport.render();
    expect(viewport.camera.target[0]).toBeCloseTo(10);
    viewport.setCamera({ ...viewport.camera, position: [20, 20, 20] });
    expect(viewport.camera.position).toEqual([20, 20, 20]);

    viewport.destroy();
    expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    expect(() => {
      viewport.render();
    }).toThrow("destroyed");
  });

  it("includes instance transforms when fitting the scene", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const viewport = await createFemViewport({
      canvas: fakeCanvas(),
      scene: scene(25),
      device: fakeGpuDevice().device,
    });

    expect(viewport.camera.target[0]).toBeCloseTo(25);
    expect(viewport.runtime.getTransform(0)?.[12]).toBe(25);
    viewport.destroy();
  });

  it("owns unrecoverable device-loss cleanup and error reporting", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const onError = vi.fn();
    await createFemViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: gpu.device,
      onError,
    });

    gpu.lose("destroyed", "test loss");

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledOnce();
    });
    expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });
});
