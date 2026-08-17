import { describe, expect, it, vi } from "vitest";
import {
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

    viewport.visibility.setInstance("1/0", false);
    viewport.visibility.setInstance("1/0", true);
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
    expect(viewport.runtime.getTransform("1/0")?.[12]).toBe(25);
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
    viewport.visibility.setInstance("1/0", false);
    viewport.interaction.set(
      setTargetSelected(viewport.interaction.state, { kind: "instance", instanceId: "1/0" }, true),
    );
    const before = viewport.view.camera;

    viewport.view.fitSelection({ durationMs: 0 });

    expect(viewport.view.camera).toBe(before);
    viewport.destroy();
  });
});
