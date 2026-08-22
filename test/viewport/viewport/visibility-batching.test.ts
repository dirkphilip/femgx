import { describe, expect, it, vi } from "vitest";
import {
  installNavigator,
  latestCameraUniform,
  latestSectionPlaneUniform,
  scene,
  setBodyOverride,
  identityScene,
  setTargetSelected,
  createViewport,
  fakeCanvas,
  fakeGpuDevice,
  installTestGpuGlobals,
} from "./support";

describe("Viewport", () => {
  it("makes body and element visibility authoritative on the viewport facade", async () => {
    installTestGpuGlobals();
    installNavigator();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: identityScene(true),
      device: fakeGpuDevice().device,
    });
    const body = { partOccurrenceId: "1/keep" as const, bodyId: 1 };
    const first = { partOccurrenceId: "1/keep" as const, elementId: 10 };
    const second = { partOccurrenceId: "1/keep" as const, elementId: 11 };

    expect(viewport.visibility.isBodyDirectlyVisible(body)).toBe(true);
    expect(viewport.visibility.isElementEffectivelyVisible(first)).toBe(true);
    viewport.visibility.setElementsVisible([first, second], false);
    expect(viewport.visibility.isElementDirectlyVisible(first)).toBe(false);
    expect(viewport.visibility.isElementEffectivelyVisible(first)).toBe(false);
    viewport.visibility.setElementVisible(first, true);
    viewport.visibility.setPartOccurrenceVisible("1/keep", false);
    expect(viewport.visibility.isElementDirectlyVisible(first)).toBe(true);
    expect(viewport.visibility.isElementEffectivelyVisible(first)).toBe(false);
    viewport.visibility.showAll();
    expect(viewport.visibility.isElementEffectivelyVisible(first)).toBe(true);
    expect(viewport.visibility.isElementEffectivelyVisible(second)).toBe(true);

    viewport.interaction.set(
      setTargetSelected(viewport.interaction.state, { kind: "element", ...first }, true),
    );
    viewport.visibility.hideSelectedElements();
    expect(viewport.visibility.isElementDirectlyVisible(first)).toBe(false);
    expect(viewport.interaction.state).toBe(viewport.interaction.state);
    viewport.presentation.setEdgesVisible(false);
    viewport.presentation.setNodesVisible(false);
    viewport.presentation.setEdgesVisible(true);
    viewport.presentation.setNodesVisible(true);
    viewport.destroy();
  });

  it("validates and updates independent point and node diameters", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const onRender = vi.fn();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: identityScene(true),
      device: gpu.device,
      pointSizePixels: 12.5,
      nodeSizePixels: 3.25,
      onRender,
    });

    expect(latestCameraUniform(gpu).slice(18, 22)).toEqual(new Float32Array([12.5, 3.25, 1, 8]));
    expect(() => {
      viewport.presentation.setPointSizePixels(0);
    }).toThrow(/pointSizePixels/);
    expect(() => {
      viewport.presentation.setNodeSizePixels(Number.POSITIVE_INFINITY);
    }).toThrow(/nodeSizePixels/);
    expect(onRender).toHaveBeenCalledOnce();

    viewport.presentation.setPointSizePixels(16);
    expect(onRender).toHaveBeenCalledTimes(2);
    viewport.presentation.setPointSizePixels(16);
    expect(onRender).toHaveBeenCalledTimes(2);
    viewport.presentation.setNodeSizePixels(12);
    expect(onRender).toHaveBeenCalledTimes(3);
    viewport.batch(() => {
      viewport.presentation.setPointSizePixels(20);
      viewport.presentation.setNodeSizePixels(24);
    });
    expect(onRender).toHaveBeenCalledTimes(4);
    expect(latestCameraUniform(gpu).slice(18, 22)).toEqual(new Float32Array([20, 24, 1, 8]));
    viewport.resize();
    viewport.replaceScene(scene(10));
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

    viewport.presentation.setSectionPlane({ normal: [0, 0, 2], distance: 4 });
    expect(viewport.presentation.sectionPlane).toEqual({ normal: [0, 0, 1], distance: 2 });
    expect(latestSectionPlaneUniform(gpu)).toEqual(new Float32Array([0, 0, 1, 2]));
    expect(() => {
      viewport.presentation.setSectionPlane({ normal: [0, 0, 0], distance: 0 });
    }).toThrow("Section plane");
    expect(viewport.presentation.sectionPlane).toEqual({ normal: [0, 0, 1], distance: 2 });

    viewport.replaceScene(scene(10));
    expect(viewport.presentation.sectionPlane).toEqual({ normal: [0, 0, 1], distance: 2 });
    viewport.presentation.clearSectionPlane();
    expect(viewport.presentation.sectionPlane).toBeUndefined();
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
    viewport.presentation.setBackground("dark");
    expect(onRender).toHaveBeenCalledTimes(2);
    expect(gpu.renderPipelineDescriptors).toHaveLength(pipelineCount);
    viewport.presentation.setBackground("dark");
    expect(onRender).toHaveBeenCalledTimes(2);
    expect(() => {
      viewport.presentation.setBackground("invalid" as never);
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
      scene: identityScene(true),
      device: fakeGpuDevice().device,
      onRender,
    });
    expect(onRender).toHaveBeenCalledOnce();

    const finalInteraction = viewport.batch(() => {
      viewport.visibility.setBodyVisible({ partOccurrenceId: "1/keep", bodyId: 1 }, false);
      const interaction = setBodyOverride(
        viewport.interaction.state,
        { partOccurrenceId: "1/keep", bodyId: 1 },
        { emissive: 0.5 },
      );
      viewport.interaction.set(interaction);
      viewport.visibility.setPartVisible(1, false);
      viewport.visibility.setPartVisible(1, true);
      expect(onRender).toHaveBeenCalledOnce();
      return interaction;
    });

    expect(finalInteraction).toBe(viewport.interaction.state);
    expect(viewport.occurrences.visibleCount).toBe(1);
    expect(onRender).toHaveBeenCalledTimes(2);

    viewport.batch(() => {
      viewport.visibility.setBodyVisible({ partOccurrenceId: "1/keep", bodyId: 1 }, true);
      expect(onRender).toHaveBeenCalledTimes(2);
    });
    expect(
      viewport.visibility.isBodyDirectlyVisible({ partOccurrenceId: "1/keep", bodyId: 1 }),
    ).toBe(true);
    expect(onRender).toHaveBeenCalledTimes(3);
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

    first.visibility.setPartVisible(1, false);
    expect(first.occurrences.visibleCount).toBe(0);
    expect(second.occurrences.visibleCount).toBe(1);
    expect(second.occurrences.isPartOccurrenceVisible("1/0")).toBe(true);

    first.destroy();
    second.destroy();
  });
});
