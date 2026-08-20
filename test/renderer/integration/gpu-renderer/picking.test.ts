import { expect, it, describe } from "vitest";
import {
  createWebGpuRenderer,
  createPackedSceneRuntime,
  createInteractionState,
  setPartOverride,
  setBodyHighlighted,
  setBodySelected,
  setBodyVisible,
  projectPoint,
  unprojectPoint,
  fakeCanvas,
  fakeGpuDevice,
  installNavigator,
  buildScene,
  buildFaceScene,
  buildBodyScene,
  camera,
  installGpuTestGlobals,
} from "./support";
import { setRendererResultColors } from "@/renderer/gpu-renderer";

describe("WebGPU renderer", () => {
  it("reuses pick snapshots until pick-relevant state changes", async () => {
    installGpuTestGlobals();
    const gpu = fakeGpuDevice({ pickValue: 1 });
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    const interaction = createInteractionState();

    renderer.render(runtime, camera, scene.parts);
    await renderer.pick(100, 100);
    expect(gpu.drawCalls).toHaveLength(2);
    await renderer.pick(200, 200);
    expect(gpu.drawCalls).toHaveLength(2);

    const styled = setPartOverride(interaction, 1, {
      color: { r: 1, g: 0, b: 0, a: 1 },
    });
    renderer.updateInstances(runtime, styled, [0]);
    renderer.render(runtime, camera, scene.parts);
    await renderer.pick(300, 300);
    expect(gpu.drawCalls).toHaveLength(3);

    const wider = setPartOverride(interaction, 1, { lineWidthPixels: 12 });
    renderer.updateInstances(runtime, wider, [0]);
    renderer.render(runtime, camera, scene.parts);
    await renderer.pick(300, 300);
    expect(gpu.drawCalls).toHaveLength(5);

    const movedCamera = { ...camera, target: [1, 0, 0] as const };
    renderer.render(runtime, movedCamera, scene.parts);
    await renderer.pick(300, 300);
    expect(gpu.drawCalls).toHaveLength(7);

    const hidden = runtime.setInstanceVisible(1, false);
    renderer.updateVisibility(runtime, hidden.affectedPartIds);
    renderer.render(runtime, movedCamera, scene.parts);
    await renderer.pick(300, 300);
    expect(gpu.drawCalls).toHaveLength(9);

    renderer.resize(400, 300);
    await renderer.pick(150, 100);
    expect(gpu.drawCalls).toHaveLength(10);

    renderer.setDeformation({
      scale: 1,
      displacements: new Map([[1, new Float32Array(9)]]),
    });
    renderer.render(runtime, movedCamera, scene.parts);
    await renderer.pick(150, 100);
    expect(gpu.drawCalls).toHaveLength(12);
    renderer.destroy();
  });

  it("preserves pick snapshots across result color updates", async () => {
    installGpuTestGlobals();
    const gpu = fakeGpuDevice({ pickValue: 1 });
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);

    renderer.render(runtime, camera, scene.parts);
    await renderer.pick(100, 100);

    for (const colors of [
      new Map([[1, { location: "nodal" as const, values: new Float32Array(16).fill(1) }]]),
      new Map([[1, { location: "nodal" as const, values: new Float32Array(16).fill(2) }]]),
      undefined,
    ]) {
      setRendererResultColors(renderer, colors);
      renderer.render(runtime, camera, scene.parts);
      const drawCallsAfterVisibleRender = gpu.drawCalls.length;
      await renderer.pick(100, 100);
      expect(gpu.drawCalls).toHaveLength(drawCallsAfterVisibleRender);
    }
    renderer.destroy();
  });

  it("invalidates pick snapshots when body visibility changes", async () => {
    installGpuTestGlobals();
    const gpu = fakeGpuDevice({ pickValue: 1 });
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildBodyScene();
    const runtime = createPackedSceneRuntime(scene);
    const body = { partOccurrenceId: "1/0", bodyId: 3 } as const;
    let interaction = createInteractionState();

    renderer.render(runtime, camera, scene.parts);
    renderer.updateElements(runtime, interaction);
    await renderer.pick(100, 100);
    expect(gpu.drawCalls).toHaveLength(2);

    interaction = setBodyVisible(interaction, body, false);
    renderer.updateElements(runtime, interaction);
    renderer.render(runtime, camera, scene.parts);
    await renderer.pick(100, 100);
    expect(gpu.drawCalls).toHaveLength(4);

    renderer.updateElements(runtime, interaction);
    renderer.render(runtime, camera, scene.parts);
    await renderer.pick(100, 100);
    expect(gpu.drawCalls).toHaveLength(5);

    interaction = setBodyVisible(interaction, body, true);
    renderer.updateElements(runtime, interaction);
    renderer.render(runtime, camera, scene.parts);
    await renderer.pick(100, 100);
    expect(gpu.drawCalls).toHaveLength(7);

    interaction = setBodySelected(interaction, body, true);
    renderer.updateElements(runtime, interaction);
    renderer.render(runtime, camera, scene.parts);
    await renderer.pick(100, 100);
    expect(gpu.drawCalls).toHaveLength(10);

    interaction = setBodyHighlighted(interaction, body, true);
    renderer.updateElements(runtime, interaction);
    renderer.render(runtime, camera, scene.parts);
    await renderer.pick(100, 100);
    expect(gpu.drawCalls).toHaveLength(13);

    renderer.destroy();
  });

  it.each(["perspective", "orthographic"] as const)(
    "resolves a visible face pixel to an exact world-space point in %s mode",
    async (mode) => {
      installGpuTestGlobals();
      const faceCamera = {
        ...camera,
        mode,
        position: [0, 0, 5] as const,
        target: [0, 0, 0] as const,
      };
      const depth = projectPoint(faceCamera, [0, 0, 0])?.[2] ?? 1;
      const gpu = fakeGpuDevice({
        pickValue: 1,
        elementPickValue: 1,
        facePickValue: 1,
        ndcDepth: depth,
      });
      installNavigator(gpu.device);
      const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
      const scene = buildFaceScene();
      const runtime = createPackedSceneRuntime(scene);
      renderer.render(runtime, faceCamera, scene.parts);

      await expect(renderer.pick(400, 300)).resolves.toMatchObject({
        kind: "face",
        partId: 1,
        partOccurrenceId: "1/0",
        elementId: 0,
        key: "0,1,2",
        worldPosition: unprojectPoint(faceCamera, [400.5, 300.5, depth]),
      });

      await expect(renderer.pickPoint(faceCamera, 400, 300)).resolves.toEqual(
        unprojectPoint(faceCamera, [400.5, 300.5, depth]),
      );
      renderer.destroy();
    },
  );

  it("reconstructs a displayed point in a large-coordinate camera frame", async () => {
    installGpuTestGlobals();
    const faceCamera = {
      ...camera,
      position: [10_000, 20_000, 30_005] as const,
      target: [10_000, 20_000, 30_000] as const,
      far: 100,
    };
    const displayedPoint = [10_000, 20_000, 30_001] as const;
    const depth = projectPoint(faceCamera, displayedPoint)?.[2] ?? 1;
    const gpu = fakeGpuDevice({ pickValue: 1, facePickValue: 1, ndcDepth: depth });
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildFaceScene();
    renderer.render(createPackedSceneRuntime(scene), faceCamera, scene.parts);

    await expect(renderer.pickPoint(faceCamera, 400, 300)).resolves.toEqual(
      unprojectPoint(faceCamera, [400.5, 300.5, Math.fround(depth)]),
    );
    renderer.destroy();
  });

  it("materializes exact edge-pick geometry without enabling the presentation overlay", async () => {
    installGpuTestGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildFaceScene();
    renderer.render(createPackedSceneRuntime(scene), camera, scene.parts);

    await renderer.pick(400, 300, "edge");
    expect(gpu.submissionCount).toBeGreaterThan(1);
    renderer.destroy();
  });
});
