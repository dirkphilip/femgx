import { describe, expect, it, vi } from "vitest";
import {
  installNavigator,
  scene,
  resultScene,
  createResultField,
  setPartOverride,
  createViewport,
  type Viewport,
  fakeCanvas,
  fakeGpuDevice,
  installTestGpuGlobals,
} from "./support";

describe("Viewport", () => {
  it("rejects an orientation gizmo container that does not contain the canvas before setup", async () => {
    const canvas = fakeCanvas();
    const contains = vi.fn(() => false);
    const container = { contains } as unknown as HTMLElement;

    await expect(
      createViewport({
        canvas,
        scene: scene(),
        orientationGizmo: { container },
      }),
    ).rejects.toThrow("orientationGizmo.container must contain the canvas");
    expect(contains).toHaveBeenCalledWith(canvas);
  });

  it("owns fitted camera, runtime, interaction, visibility, resize, and teardown", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const canvas = fakeCanvas(640, 360);
    const onRender = vi.fn();
    const viewport = await createViewport({
      canvas,
      scene: scene(),
      device: gpu.device,
      onRender,
    });

    expect(viewport.runtime.instanceCount).toBe(1);
    expect(viewport.runtime.getVisibleInstanceIds()).toEqual(["1/0"]);
    expect(viewport.camera.width).toBe(640);
    expect(viewport.stats()).toEqual({ visibleInstances: 1, drawBatches: 1 });
    expect(onRender).toHaveBeenCalledOnce();

    const interaction = setPartOverride(viewport.interaction, 1, {
      color: { r: 1, g: 0, b: 0, a: 1 },
    });
    viewport.setInteraction(interaction);
    viewport.setEdgeDepthTest(false);
    viewport.render();
    expect(viewport.interaction).toBe(interaction);

    viewport.setPartVisible(1, false);
    expect(viewport.stats().visibleInstances).toBe(0);
    expect(viewport.runtime.getVisibleInstanceIds()).toEqual([]);
    viewport.setPartVisible(1, true);
    expect(viewport.runtime.getVisibleInstanceIds()).toEqual(["1/0"]);
    viewport.setInstanceVisible("1/0", false);
    expect(viewport.stats().visibleInstances).toBe(0);
    expect(viewport.runtime.getVisibleInstanceIds()).toEqual([]);

    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 200 });
    viewport.resize();
    expect(viewport.camera.width).toBe(320);
    expect(viewport.camera.height).toBe(200);
    const manuallyFramed = { ...viewport.camera, orthoHeight: viewport.camera.orthoHeight * 0.5 };
    viewport.setCamera(manuallyFramed);
    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 640 });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 360 });
    viewport.resize();
    expect(viewport.camera.orthoHeight).toBe(manuallyFramed.orthoHeight);

    viewport.setScene(scene(10));
    viewport.render();
    expect(viewport.camera.target[0]).toBeCloseTo(0);
    viewport.setCamera({ ...viewport.camera, position: [20, 20, 20] });
    expect(viewport.camera.position).toEqual([20, 20, 20]);

    viewport.destroy();
    expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    expect(() => {
      viewport.render();
    }).toThrow("destroyed");
  });

  it("fits the initial camera to construction-time nodal deformation", async () => {
    installTestGpuGlobals();
    installNavigator();
    const displacement = createResultField({
      id: "initial-fit-displacement",
      name: "initial fit displacement",
      location: "nodal" as const,
      shape: "vector" as const,
      count: 3,
      unit: "unitless",
      values: new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 0]),
    });
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: resultScene(3),
      device: fakeGpuDevice().device,
      results: { deformation: { field: displacement } },
    });

    expect(viewport.camera.target[0]).toBeCloseTo(5);
    viewport.destroy();
  });

  it("rejects every visibility mutation after destruction without changing state", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: gpu.device,
    });
    const visibilitySetters: readonly ((current: Viewport) => void)[] = [
      (current) => {
        current.updateScene(scene());
      },
      (current) => {
        current.setPartVisible(1, false);
      },
      (current) => {
        current.setAssemblyOccurrenceVisible("1", false);
      },
      (current) => {
        current.setAssemblyVisible(1, false);
      },
      (current) => {
        current.setInstanceVisible("1/0", false);
      },
    ];
    const before = {
      drawList: viewport.runtime.getVisibleInstanceIds(),
      instances: viewport.runtime.getInstances(),
      occurrences: viewport.runtime.getOccurrences(),
      submissions: gpu.submissionCount,
      writes: gpu.writes.length,
    };

    viewport.destroy();

    for (const setVisible of visibilitySetters) {
      expect(() => {
        setVisible(viewport);
      }).toThrow("Viewport has been destroyed");
    }
    expect(viewport.runtime.getVisibleInstanceIds()).toEqual(before.drawList);
    expect(viewport.runtime.getInstances()).toEqual(before.instances);
    expect(viewport.runtime.getOccurrences()).toEqual(before.occurrences);
    expect(gpu.submissionCount).toBe(before.submissions);
    expect(gpu.writes).toHaveLength(before.writes);
    expect(() => {
      viewport.destroy();
    }).not.toThrow();
  });
});
