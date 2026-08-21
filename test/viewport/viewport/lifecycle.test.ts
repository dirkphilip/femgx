import { describe, expect, it, vi } from "vitest";
import {
  installNavigator,
  scene,
  invalidScene,
  resultScene,
  createResultField,
  setPartOverride,
  createViewport,
  GpuRenderer,
  type Viewport,
  fakeCanvas,
  fakeGpuDevice,
  installTestGpuGlobals,
  translationMatrix,
} from "./support";
import { UnknownSceneIdentityError } from "@/entries/root";
import { createPartRecord } from "@/geometry/part";

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

  it("releases the renderer when initial viewport setup fails", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    // Keep the genuine implementation available while the spy injects the setup failure.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const resize = GpuRenderer.prototype.resize;
    const rendererResize = vi.spyOn(GpuRenderer.prototype, "resize");
    const rendererDestroy = vi.spyOn(GpuRenderer.prototype, "destroy");
    rendererResize.mockImplementation(function (this: GpuRenderer, width?, height?) {
      if (rendererResize.mock.calls.length > 1) throw new Error("initial viewport resize failed");
      resize.call(this, width, height);
    });

    try {
      await expect(
        createViewport({ canvas: fakeCanvas(), scene: scene(), device: gpu.device }),
      ).rejects.toThrow("initial viewport resize failed");
      expect(rendererDestroy).toHaveBeenCalledOnce();
      expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    } finally {
      rendererResize.mockRestore();
      rendererDestroy.mockRestore();
    }
  });

  it("releases the renderer when scene initialization fails before lifecycle setup", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const rendererDestroy = vi.spyOn(GpuRenderer.prototype, "destroy");

    try {
      await expect(
        createViewport({ canvas: fakeCanvas(), scene: invalidScene(), device: gpu.device }),
      ).rejects.toThrow();
      expect(rendererDestroy).toHaveBeenCalledOnce();
      expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    } finally {
      rendererDestroy.mockRestore();
    }
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

    expect(viewport.occurrences.partOccurrenceCount).toBe(1);
    expect(Array.from(viewport.occurrences.visiblePartOccurrenceIds())).toEqual(["1/0"]);
    expect(viewport.view.camera.width).toBe(640);
    expect(viewport.stats()).toEqual({ visiblePartOccurrences: 1, drawBatches: 1 });
    expect(onRender).toHaveBeenCalledOnce();

    const interaction = setPartOverride(viewport.interaction.state, 1, {
      color: { r: 1, g: 0, b: 0, a: 1 },
    });
    viewport.interaction.set(interaction);
    viewport.presentation.setEdgeDepthTest(false);
    viewport.render();
    expect(viewport.interaction.state).toBe(interaction);

    viewport.visibility.setPartVisible(1, false);
    expect(viewport.stats().visiblePartOccurrences).toBe(0);
    expect(Array.from(viewport.occurrences.visiblePartOccurrenceIds())).toEqual([]);
    viewport.visibility.setPartVisible(1, true);
    expect(Array.from(viewport.occurrences.visiblePartOccurrenceIds())).toEqual(["1/0"]);
    viewport.visibility.setPartOccurrenceVisible("1/0", false);
    expect(viewport.stats().visiblePartOccurrences).toBe(0);
    expect(Array.from(viewport.occurrences.visiblePartOccurrenceIds())).toEqual([]);

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

    viewport.replaceScene(scene(10));
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
    viewport.replaceScene(scene(10));
    const implicitSource = scene(20);
    const sourcePart = implicitSource.parts.get(1);
    if (sourcePart === undefined) throw new Error("test part is missing");
    const sourceRoot = implicitSource.assemblies.get(1);
    if (sourceRoot === undefined) throw new Error("test root is missing");
    viewport.replaceScene({
      ...implicitSource,
      assemblies: new Map([
        [
          1,
          {
            ...sourceRoot,
            placements: sourceRoot.placements.map((placement) => ({
              ...placement,
              placementId: "retained",
            })),
          },
        ],
      ]),
    });
    const addedPart = createPartRecord(
      2,
      {
        geometries: sourcePart.geometries,
        ...(sourcePart.elements === undefined ? {} : { elements: sourcePart.elements }),
        ...(sourcePart.nodePositions === undefined
          ? {}
          : { nodePositions: sourcePart.nodePositions }),
        ...(sourcePart.bodies === undefined ? {} : { bodies: sourcePart.bodies }),
      },
      sourcePart.bounds,
    );
    viewport.updateScene((update) => {
      update.addPart(addedPart);
      update.addPlacement(1, {
        kind: "part",
        placementId: "recovered-addition",
        partId: 2,
        transform: translationMatrix(20, 0, 0),
      });
    });
    await viewport.recover();
    viewport.render();

    expect(viewport.view).toBe(capabilities.view);
    expect(viewport.interaction).toBe(capabilities.interaction);
    expect(viewport.visibility).toBe(capabilities.visibility);
    expect(viewport.results).toBe(capabilities.results);
    expect(viewport.presentation).toBe(capabilities.presentation);
    expect(viewport.occurrences.getPartId("1/recovered-addition")).toBe(2);
    viewport.destroy();
  });

  it.each([
    [
      "part",
      999,
      (viewport: Viewport) => {
        viewport.visibility.setPartVisible(999, false);
      },
    ],
    [
      "assembly",
      999,
      (viewport: Viewport) => {
        viewport.visibility.setAssemblyVisible(999, false);
      },
    ],
    [
      "assembly-occurrence",
      "missing-occurrence",
      (viewport: Viewport) => {
        viewport.visibility.setAssemblyOccurrenceVisible("missing-occurrence", false);
      },
    ],
    [
      "partOccurrence",
      "missing-instance",
      (viewport: Viewport) => {
        viewport.visibility.setPartOccurrenceVisible("missing-instance", false);
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
      const beforeVisible = Array.from(viewport.occurrences.visiblePartOccurrenceIds());
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
      expect(Array.from(viewport.occurrences.visiblePartOccurrenceIds())).toEqual(beforeVisible);
      expect(gpu.writes).toHaveLength(beforeWrites);
      viewport.destroy();
    },
  );

  it("validates a bulk occurrence update atomically and synchronizes once", async () => {
    installTestGpuGlobals();
    installNavigator();
    const updateVisibility = vi.spyOn(GpuRenderer.prototype, "updateVisibility");
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
    });
    updateVisibility.mockClear();

    expect(() => {
      viewport.visibility.setPartOccurrences(["1/0", "missing"], false);
    }).toThrow(UnknownSceneIdentityError);
    expect(viewport.occurrences.isPartOccurrenceVisible("1/0")).toBe(true);
    expect(updateVisibility).not.toHaveBeenCalled();

    let iterations = 0;
    const duplicateIds = {
      *[Symbol.iterator]() {
        iterations += 1;
        yield "1/0";
        yield "1/0";
      },
    };
    viewport.visibility.setPartOccurrences(duplicateIds, false);
    expect(iterations).toBe(1);
    expect(viewport.occurrences.isPartOccurrenceVisible("1/0")).toBe(false);
    expect(updateVisibility).toHaveBeenCalledOnce();
    viewport.visibility.setPartOccurrences(["1/0"], false);
    viewport.visibility.setPartOccurrences([], true);
    expect(updateVisibility).toHaveBeenCalledOnce();
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
        current.updateScene(() => undefined);
      },
      (current) => {
        current.visibility.setPartVisible(1, false);
      },
      (current) => {
        current.visibility.setAssemblyOccurrenceVisible("1", false);
      },
      (current) => {
        current.visibility.setAssemblyVisible(1, false);
      },
      (current) => {
        current.visibility.setPartOccurrenceVisible("1/0", false);
      },
      (current) => {
        current.visibility.setPartOccurrences(["1/0"], false);
      },
    ];
    const before = {
      drawList: Array.from(viewport.occurrences.visiblePartOccurrenceIds()),
      instances: Array.from(viewport.occurrences.partOccurrences()),
      occurrenceIds: Array.from(
        viewport.occurrences.assemblyOccurrences(),
        ({ assemblyOccurrenceId }) => assemblyOccurrenceId,
      ),
      submissions: gpu.submissionCount,
      writes: gpu.writes.length,
    };

    viewport.destroy();

    for (const setVisible of visibilitySetters) {
      expect(() => {
        setVisible(viewport);
      }).toThrow("Viewport has been destroyed");
    }
    expect(Array.from(viewport.occurrences.visiblePartOccurrenceIds())).toEqual(before.drawList);
    expect(Array.from(viewport.occurrences.partOccurrences())).toEqual(before.instances);
    expect(
      Array.from(
        viewport.occurrences.assemblyOccurrences(),
        ({ assemblyOccurrenceId }) => assemblyOccurrenceId,
      ),
    ).toEqual(before.occurrenceIds);
    expect(gpu.submissionCount).toBe(before.submissions);
    expect(gpu.writes).toHaveLength(before.writes);
    expect(() => {
      viewport.destroy();
    }).not.toThrow();
  });
});
