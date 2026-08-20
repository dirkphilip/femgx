import { describe, expect, it, vi } from "vitest";
import { createCamera, projectPoint } from "../../../src/camera/camera";
import { boundsCorners, createPart } from "../../../src/geometry/part";
import { translationMatrix } from "../../../src/math/mat4";
import {
  explicitScene,
  installNavigator,
  wheelCanvas,
  KeyboardTarget,
  scene,
  setPartOverride,
  setTargetSelected,
  createViewport,
  RendererAttachment,
  fakeCanvas,
  fakeGpuDevice,
  geometryBounds,
  installTestGpuGlobals,
} from "./support";

describe("Viewport", () => {
  it("reuses displayed scene bounds across wheel zoom frames", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const input = wheelCanvas();
    const displayedBounds = vi.spyOn(geometryBounds, "displayedPartBounds");
    const viewport = await createViewport({
      canvas: input.canvas,
      scene: scene(),
      device: gpu.device,
    });
    displayedBounds.mockClear();

    input.wheel(-100);
    input.wheel(-100);
    expect(displayedBounds).toHaveBeenCalledTimes(1);

    viewport.visibility.setPartOccurrenceVisible("1/0", false);
    viewport.visibility.setPartOccurrenceVisible("1/0", true);
    input.wheel(100);
    expect(displayedBounds).toHaveBeenCalledTimes(2);
    viewport.destroy();
    displayedBounds.mockRestore();
  });

  it("does not resynchronize unchanged interaction state during camera-only frames", async () => {
    installTestGpuGlobals();
    installNavigator();
    const updateInstances = vi.spyOn(RendererAttachment.prototype, "updateInstances");
    const updateElements = vi.spyOn(RendererAttachment.prototype, "updateElements");
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
    });

    expect(updateInstances).not.toHaveBeenCalled();
    expect(updateElements).toHaveBeenCalledOnce();
    viewport.render();
    viewport.interaction.set(viewport.interaction.state);
    expect(updateInstances).not.toHaveBeenCalled();
    expect(updateElements).toHaveBeenCalledOnce();

    viewport.interaction.set(setPartOverride(viewport.interaction.state, 1, { emissive: 0.25 }));
    expect(updateInstances).toHaveBeenCalledOnce();
    expect(updateElements).toHaveBeenCalledTimes(2);
    viewport.destroy();
  });
});

describe("Viewport", () => {
  it("includes instance transforms when fitting the scene", async () => {
    installTestGpuGlobals();
    installNavigator();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(25),
      device: fakeGpuDevice().device,
    });

    expect(viewport.view.camera.target[0]).toBeCloseTo(25);
    expect(viewport.occurrences.getTransform("1/0")?.[12]).toBe(25);
    viewport.destroy();
  });
});

describe("Viewport", () => {
  it("owns fit selection, validates transition durations, and scopes Z to the host target", async () => {
    installTestGpuGlobals();
    installNavigator();
    const keyboard = new KeyboardTarget();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
      keyboardTarget: keyboard,
    });
    const previous = viewport.view.camera;
    const invalid = { durationMs: Number.NaN };
    expect(() => {
      viewport.view.fitSelection(invalid);
    }).toThrow(/durationMs/);
    expect(() => {
      viewport.view.setCamera(previous, invalid);
    }).toThrow(/durationMs/);

    const preventDefault = vi.fn();
    keyboard.dispatch({
      key: "Z",
      repeat: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      target: null,
      preventDefault,
    } as unknown as Event);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(viewport.view.camera.target).toEqual(previous.target);

    viewport.destroy();
    keyboard.dispatch({ key: "z", preventDefault: vi.fn() } as unknown as Event);
  });

  it("leaves the camera unchanged when selected geometry is hidden or stale", async () => {
    installTestGpuGlobals();
    installNavigator();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
    });
    viewport.visibility.setPartOccurrenceVisible("1/0", false);
    viewport.interaction.set(
      setTargetSelected(
        viewport.interaction.state,
        { kind: "partOccurrence", partOccurrenceId: "1/0" },
        true,
      ),
    );
    const before = viewport.view.camera;

    viewport.view.fitSelection({ durationMs: 0 });

    expect(viewport.view.camera).toBe(before);
    viewport.destroy();
  });

  it("centres a protected perspective selection in the viewport", async () => {
    installTestGpuGlobals();
    installNavigator();
    const selectionBounds = { minX: -1, minY: -1, minZ: -10, maxX: 1, maxY: 1, maxZ: 1 };
    const selectedPart = createPart(1, {
      geometries: [
        {
          positions: new Float32Array([-1, -1, -10, 1, -1, 1, 0, 1, 1]),
          indices: new Uint32Array([0, 1, 2]),
          primitive: "triangles",
        },
      ],
    });
    const remotePart = createPart(2, {
      geometries: [
        {
          positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
          indices: new Uint32Array([0, 1, 2]),
          primitive: "triangles",
        },
      ],
    });
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: explicitScene(
        [selectedPart, remotePart],
        [
          { kind: "part", partId: 1, transform: translationMatrix(0, 0, 0) },
          { kind: "part", partId: 2, transform: translationMatrix(30, 8, 30) },
        ],
      ),
      device: fakeGpuDevice().device,
    });
    viewport.view.setCamera(
      createCamera({ mode: "perspective", position: [15, 4, 15], target: [0, 0, 0] }),
    );
    viewport.interaction.set(
      setTargetSelected(
        viewport.interaction.state,
        { kind: "partOccurrence", partOccurrenceId: "1/0" },
        true,
      ),
    );

    viewport.view.fitSelection({ durationMs: 0 });

    const projected = boundsCorners(selectionBounds)
      .map((corner) => projectPoint(viewport.view.camera, corner))
      .filter((point): point is readonly [number, number, number] => point !== undefined);
    const centerX =
      (Math.min(...projected.map((point) => point[0])) +
        Math.max(...projected.map((point) => point[0]))) /
      2;
    const centerY =
      (Math.min(...projected.map((point) => point[1])) +
        Math.max(...projected.map((point) => point[1]))) /
      2;
    expect(Math.hypot(...viewport.view.camera.position)).toBeGreaterThan(30);
    expect(Math.abs(centerX - viewport.view.camera.width / 2)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(centerY - viewport.view.camera.height / 2)).toBeLessThanOrEqual(0.1);
    viewport.destroy();
  });
});
