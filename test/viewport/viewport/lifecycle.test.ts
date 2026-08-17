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
import { UnknownSceneIdentityError } from "../../../src/entries/root";

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
    expect(viewport.view.camera.width).toBe(640);
    expect(viewport.stats()).toEqual({ visibleInstances: 1, drawBatches: 1 });
    expect(onRender).toHaveBeenCalledOnce();

    const interaction = setPartOverride(viewport.interaction.state, 1, {
      color: { r: 1, g: 0, b: 0, a: 1 },
    });
    viewport.interaction.set(interaction);
    viewport.presentation.setEdgeDepthTest(false);
    viewport.render();
    expect(viewport.interaction.state).toBe(interaction);

    viewport.visibility.setPart(1, false);
    expect(viewport.stats().visibleInstances).toBe(0);
    expect(viewport.runtime.getVisibleInstanceIds()).toEqual([]);
    viewport.visibility.setPart(1, true);
    expect(viewport.runtime.getVisibleInstanceIds()).toEqual(["1/0"]);
    viewport.visibility.setInstance("1/0", false);
    expect(viewport.stats().visibleInstances).toBe(0);
    expect(viewport.runtime.getVisibleInstanceIds()).toEqual([]);

    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 200 });
    viewport.resize();
    expect(viewport.view.camera.width).toBe(320);
    expect(viewport.view.camera.height).toBe(200);
    const manuallyFramed = {
      ...viewport.view.camera,
      orthoHeight: viewport.view.camera.orthoHeight * 0.5,
    };
    viewport.view.setCamera(manuallyFramed);
    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 640 });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 360 });
    viewport.resize();
    expect(viewport.view.camera.orthoHeight).toBe(manuallyFramed.orthoHeight);

    viewport.setScene(scene(10));
    viewport.render();
    expect(viewport.view.camera.target[0]).toBeCloseTo(0);
    viewport.view.setCamera({ ...viewport.view.camera, position: [20, 20, 20] });
    expect(viewport.view.camera.position).toEqual([20, 20, 20]);

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

    expect(viewport.view.camera.target[0]).toBeCloseTo(5);
    viewport.destroy();
  });

  it("keeps capability references live across scene, render, resize, and recovery", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: gpu.device,
    });
    const capabilities = {
      view: viewport.view,
      interaction: viewport.interaction,
      visibility: viewport.visibility,
      results: viewport.results,
      presentation: viewport.presentation,
    };

    viewport.render();
    viewport.resize();
    viewport.setScene(scene(10));
    viewport.updateScene(scene(20));
    await viewport.recover();

    expect(viewport.view).toBe(capabilities.view);
    expect(viewport.interaction).toBe(capabilities.interaction);
    expect(viewport.visibility).toBe(capabilities.visibility);
    expect(viewport.results).toBe(capabilities.results);
    expect(viewport.presentation).toBe(capabilities.presentation);
    viewport.destroy();
  });

  it.each([
    [
      "part",
      999,
      (viewport: Viewport) => {
        viewport.visibility.setPart(999, false);
      },
    ],
    [
      "assembly",
      999,
      (viewport: Viewport) => {
        viewport.visibility.setAssembly(999, false);
      },
    ],
    [
      "assembly-occurrence",
      "missing-occurrence",
      (viewport: Viewport) => {
        viewport.visibility.setAssemblyOccurrence("missing-occurrence", false);
      },
    ],
    [
      "instance",
      "missing-instance",
      (viewport: Viewport) => {
        viewport.visibility.setInstance("missing-instance", false);
      },
    ],
  ] as const)(
    "throws a typed error before mutating for an unknown %s",
    async (_kind, _id, mutate) => {
      installTestGpuGlobals();
      installNavigator();
      const gpu = fakeGpuDevice();
      const viewport = await createViewport({
        canvas: fakeCanvas(),
        scene: scene(),
        device: gpu.device,
      });
      const beforeVisible = viewport.runtime.getVisibleInstanceIds();
      const beforeWrites = gpu.writes.length;
      let error: unknown;
      expect(() => {
        viewport.batch(() => {
          mutate(viewport);
        });
      }).toThrow(UnknownSceneIdentityError);
      try {
        mutate(viewport);
      } catch (caught: unknown) {
        error = caught;
      }
      expect(error).toBeInstanceOf(UnknownSceneIdentityError);
      expect((error as UnknownSceneIdentityError).kind).toBe(_kind);
      expect((error as UnknownSceneIdentityError).id).toBe(_id);
      expect(viewport.runtime.getVisibleInstanceIds()).toEqual(beforeVisible);
      expect(gpu.writes).toHaveLength(beforeWrites);
      viewport.destroy();
    },
  );

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
        void current.view.camera;
      },
      (current) => {
        void current.interaction.state;
      },
      (current) => {
        void current.interaction.pick(0, 0);
      },
      (current) => {
        void current.results.state;
      },
      (current) => {
        void current.presentation.sectionPlane;
      },
      (current) => {
        current.updateScene(scene());
      },
      (current) => {
        current.visibility.setPart(1, false);
      },
      (current) => {
        current.visibility.setAssemblyOccurrence("1", false);
      },
      (current) => {
        current.visibility.setAssembly(1, false);
      },
      (current) => {
        current.visibility.setInstance("1/0", false);
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
