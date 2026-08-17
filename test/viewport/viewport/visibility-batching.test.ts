import { describe, expect, it, vi } from "vitest";
import {
  installNavigator,
  latestCameraUniform,
  latestSectionPlaneUniform,
  scene,
  setBodyOverride,
  setBodyVisible,
  createViewport,
  fakeCanvas,
  fakeGpuDevice,
  installTestGpuGlobals,
} from "./support";

describe("Viewport", () => {
  it("validates and updates independent point and node diameters", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const onRender = vi.fn();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: gpu.device,
      pointSizePixels: 12.5,
      nodeSizePixels: 3.25,
      onRender,
    });

    expect(latestCameraUniform(gpu).slice(18, 22)).toEqual(new Float32Array([12.5, 3.25, 1, 8]));
    expect(() => {
      viewport.setPointSizePixels(0);
    }).toThrow(/pointSizePixels/);
    expect(() => {
      viewport.setNodeSizePixels(Number.POSITIVE_INFINITY);
    }).toThrow(/nodeSizePixels/);
    expect(onRender).toHaveBeenCalledOnce();

    viewport.setPointSizePixels(16);
    expect(onRender).toHaveBeenCalledTimes(2);
    viewport.setPointSizePixels(16);
    expect(onRender).toHaveBeenCalledTimes(2);
    viewport.setNodeSizePixels(12);
    expect(onRender).toHaveBeenCalledTimes(3);
    viewport.batch(() => {
      viewport.setPointSizePixels(20);
      viewport.setNodeSizePixels(24);
    });
    expect(onRender).toHaveBeenCalledTimes(4);
    expect(latestCameraUniform(gpu).slice(18, 22)).toEqual(new Float32Array([20, 24, 1, 8]));
    viewport.resize();
    viewport.setScene(scene(10));
    viewport.render();
    expect(latestCameraUniform(gpu).slice(18, 22)).toEqual(new Float32Array([20, 24, 1, 8]));
    viewport.destroy();

    await expect(
      createViewport({ canvas: fakeCanvas(), scene: scene(), pointSizePixels: 65 }),
    ).rejects.toThrow(/pointSizePixels/);
  });

  it("normalizes, persists, and clears one section plane", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: gpu.device,
    });

    viewport.setSectionPlane({ normal: [0, 0, 2], distance: 4 });
    expect(viewport.sectionPlane).toEqual({ normal: [0, 0, 1], distance: 2 });
    expect(latestSectionPlaneUniform(gpu)).toEqual(new Float32Array([0, 0, 1, 2]));
    expect(() => {
      viewport.setSectionPlane({ normal: [0, 0, 0], distance: 0 });
    }).toThrow("Section plane");
    expect(viewport.sectionPlane).toEqual({ normal: [0, 0, 1], distance: 2 });

    viewport.setScene(scene(10));
    expect(viewport.sectionPlane).toEqual({ normal: [0, 0, 1], distance: 2 });
    viewport.clearSectionPlane();
    expect(viewport.sectionPlane).toBeUndefined();
    expect(latestSectionPlaneUniform(gpu)).toEqual(new Float32Array([0, 0, 0, 0]));
    viewport.destroy();
  });

  it("validates and switches the renderer-owned background without rebuilding the viewport", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const onRender = vi.fn();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      background: "white",
      device: gpu.device,
      onRender,
    });
    expect(onRender).toHaveBeenCalledOnce();
    const pipelineCount = gpu.renderPipelineDescriptors.length;
    viewport.setBackground("dark");
    expect(onRender).toHaveBeenCalledTimes(2);
    expect(gpu.renderPipelineDescriptors).toHaveLength(pipelineCount);
    viewport.setBackground("dark");
    expect(onRender).toHaveBeenCalledTimes(2);
    expect(() => {
      viewport.setBackground("invalid" as never);
    }).toThrow("Invalid viewport background");
    expect(onRender).toHaveBeenCalledTimes(2);
    viewport.destroy();

    await expect(
      createViewport({ canvas: fakeCanvas(), scene: scene(), background: "invalid" as never }),
    ).rejects.toThrow("Invalid viewport background");
    await expect(
      createViewport({ canvas: fakeCanvas(), scene: scene(), originTriad: "invalid" as never }),
    ).rejects.toThrow("Invalid originTriad");
  });
});

describe("Viewport", () => {
  it("coalesces body and visibility mutations inside one batch", async () => {
    installTestGpuGlobals();
    installNavigator();
    const onRender = vi.fn();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
      onRender,
    });
    expect(onRender).toHaveBeenCalledOnce();

    const finalInteraction = viewport.batch(() => {
      let interaction = setBodyVisible(
        viewport.interaction,
        { instanceId: "1/0", bodyId: 0 },
        false,
      );
      viewport.setInteraction(interaction);
      interaction = setBodyOverride(
        interaction,
        { instanceId: "1/0", bodyId: 0 },
        { emissive: 0.5 },
      );
      viewport.setInteraction(interaction);
      viewport.setPartVisible(1, false);
      viewport.setPartVisible(1, true);
      expect(onRender).toHaveBeenCalledOnce();
      return interaction;
    });

    expect(finalInteraction).toBe(viewport.interaction);
    expect(viewport.runtime.visibleCount).toBe(1);
    expect(onRender).toHaveBeenCalledTimes(2);
    viewport.destroy();
  });

  it("keeps runtime visibility isolated between viewports", async () => {
    installTestGpuGlobals();
    installNavigator();
    const first = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
    });
    const second = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
    });

    first.setPartVisible(1, false);
    expect(first.runtime.visibleCount).toBe(0);
    expect(second.runtime.visibleCount).toBe(1);
    expect(second.runtime.isInstanceVisible("1/0")).toBe(true);

    first.destroy();
    second.destroy();
  });
});
