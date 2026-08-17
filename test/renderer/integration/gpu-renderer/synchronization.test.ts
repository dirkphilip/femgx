import { expect, it, describe } from "vitest";
import {
  createWebGpuRenderer,
  readGpuCostSnapshot,
  createPackedSceneRuntime,
  createInteractionState,
  setElementOverride,
  setElementSelected,
  setInstanceOverride,
  setInstanceSelected,
  setPartOverride,
  setBodyVisible,
  setElementVisible,
  setNodeSelected,
  setTargetHovered,
  projectPoint,
  fakeCanvas,
  fakeGpuDevice,
  installNavigator,
  buildScene,
  buildFaceScene,
  buildBodyScene,
  camera,
  installGpuTestGlobals,
} from "./support";

describe("WebGPU renderer", () => {
  it("follows displayed GPU depth instead of the undeformed CPU face plane", async () => {
    installGpuTestGlobals();
    const faceCamera = { ...camera, position: [0, 0, 5] as const, target: [0, 0, 0] as const };
    const displayedDepth = projectPoint(faceCamera, [0, 0, 1])?.[2] ?? 1;
    const gpu = fakeGpuDevice({ pickValue: 1, facePickValue: 1, ndcDepth: displayedDepth });
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildFaceScene();
    renderer.render(createPackedSceneRuntime(scene), faceCamera, scene.parts);

    const point = await renderer.pickPoint(faceCamera, 400, 300);
    expect(point?.[2]).toBeCloseTo(1, 3);
    renderer.destroy();
  });

  it("patches affected GPU records and order ranges from packed deltas", async () => {
    installGpuTestGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);

    const instanceWrites = () => gpu.writes.filter((write) => write.bytes.byteLength !== 64);
    const writeRanges = (start: number) =>
      instanceWrites()
        .slice(start)
        .map((write) => [write.offset, write.bytes.byteLength]);

    const override = setPartOverride(createInteractionState(), 1, {
      color: { r: 0.75, g: 0.1, b: 0.25, a: 1 },
      opacity: 0.1,
    });
    const beforeStyle = instanceWrites().length;
    renderer.updateInstances(runtime, override, [0]);
    expect(writeRanges(beforeStyle)).toEqual([
      [0, 96],
      [0, 4],
    ]);

    const beforeNoop = instanceWrites().length;
    renderer.updateInstances(runtime, override, [0]);
    expect(instanceWrites().length).toBe(beforeNoop);

    const hidden = runtime.setInstanceVisible(1, false);
    const beforeVisibility = instanceWrites().length;
    renderer.updateInstances(runtime, override, hidden.changedInstanceIds);
    expect(writeRanges(beforeVisibility)).toEqual([
      [96, 96],
      [4, 8],
    ]);

    renderer.render(runtime, camera, scene.parts);
    expect(gpu.drawCalls.at(-1)).toEqual({ indexCount: 3, instanceCount: 1 });

    runtime.setInstanceVisible(1, true);
    renderer.updateInstances(runtime, override, [0, 1, 2]);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.drawCalls.at(-1)).toEqual({ indexCount: 3, instanceCount: 3 });
  });

  it("bounds interaction synchronization to changed slots and order scopes", async () => {
    installGpuTestGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    const empty = createInteractionState();
    renderer.render(runtime, camera, scene.parts);
    renderer.render(runtime, camera, scene.parts);

    const hovered = setTargetHovered(empty, { kind: "instance", instanceId: "1/1" });
    renderer.updateElements(runtime, hovered, [1]);
    expect(readGpuCostSnapshot(renderer).cpu).toMatchObject({
      "instance-scan": 1,
      "order-rebuild": 0,
      "call-rebuild": 0,
    });

    renderer.render(runtime, camera, scene.parts);
    const selected = setInstanceSelected(hovered, "1/1", true);
    renderer.updateElements(runtime, selected, [1]);
    expect(readGpuCostSnapshot(renderer).cpu["instance-scan"]).toBe(1);

    renderer.render(runtime, camera, scene.parts);
    const elementSelected = setElementSelected(selected, { instanceId: "1/1", elementId: 0 }, true);
    renderer.updateElements(runtime, elementSelected, []);
    expect(readGpuCostSnapshot(renderer).cpu["instance-scan"]).toBe(1);

    renderer.render(runtime, camera, scene.parts);
    const nodeSelected = setNodeSelected(elementSelected, { instanceId: "1/1", nodeId: 0 }, true);
    renderer.updateElements(runtime, nodeSelected, []);
    expect(readGpuCostSnapshot(renderer).cpu["instance-scan"]).toBe(1);
    expect(readGpuCostSnapshot(renderer).cpu["order-rebuild"]).toBe(1);

    renderer.render(runtime, camera, scene.parts);
    const alphaOverride = setInstanceOverride(nodeSelected, "1/1", { opacity: 0.5 });
    renderer.updateElements(runtime, alphaOverride, []);
    expect(readGpuCostSnapshot(renderer).cpu["instance-scan"]).toBe(1);

    renderer.render(runtime, camera, scene.parts);
    const elementOverride = setElementOverride(
      alphaOverride,
      {
        instanceId: "1/1",
        elementId: 0,
      },
      { opacity: 0.25 },
    );
    renderer.updateElements(runtime, elementOverride, []);
    expect(readGpuCostSnapshot(renderer).cpu["instance-scan"]).toBe(1);
    renderer.destroy();
  });

  it("bounds body and element visibility synchronization to their owning slot", async () => {
    installGpuTestGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildBodyScene();
    const runtime = createPackedSceneRuntime(scene);
    const body = { instanceId: "1/0", bodyId: 3 } as const;
    let interaction = createInteractionState();
    renderer.render(runtime, camera, scene.parts);
    renderer.render(runtime, camera, scene.parts);

    interaction = setBodyVisible(interaction, body, false);
    renderer.updateElements(runtime, interaction, []);
    expect(readGpuCostSnapshot(renderer).cpu["instance-scan"]).toBe(1);

    renderer.render(runtime, camera, scene.parts);
    interaction = setElementVisible(interaction, { instanceId: "1/0", elementId: 0 }, false);
    renderer.updateElements(runtime, interaction, []);
    expect(readGpuCostSnapshot(renderer).cpu["instance-scan"]).toBe(1);
    renderer.destroy();
  });
});
