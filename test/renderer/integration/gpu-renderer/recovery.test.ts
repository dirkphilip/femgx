import { expect, it, vi, describe } from "vitest";
import {
  createWebGpuRenderer,
  readGpuCostSnapshot,
  createPackedSceneRuntime,
  createInteractionState,
  setElementSelected,
  setElementVisible,
  setPartOverride,
  setTargetHovered,
  setElementOverride,
  setNodeSelected,
  fakeCanvas,
  fakeGpuDevice,
  installFreshDeviceNavigator,
  buildScene,
  buildSectionScene,
  buildSubsetSelectionScene,
  camera,
  installGpuTestGlobals,
  installGpuTestEnvironment,
} from "./support";
import { setRendererResultColors } from "@/renderer/gpu-renderer";

describe("WebGPU renderer", () => {
  it("culls hidden parts from the draw order without rewriting records", async () => {
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);
    const nodes = setPartOverride(createInteractionState(), 1, { nodes: true });
    renderer.updateInstances(runtime, nodes, [0, 1, 2]);
    renderer.updateElements(runtime, nodes, [0, 1, 2]);

    const hidden = runtime.setPartVisible(1, false);
    renderer.updateVisibility(runtime, hidden.affectedPartIds);
    const hovered = setTargetHovered(nodes, { kind: "partOccurrence", partOccurrenceId: "1/0" });
    renderer.updateElements(runtime, hovered, [0]);
    const callsBefore = gpu.drawCalls.length;
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.drawCalls.length).toBe(callsBefore);
    expect(readGpuCostSnapshot(renderer).draws.nodes.instances).toBe(0);

    const shown = runtime.setPartVisible(1, true);
    renderer.updateVisibility(runtime, shown.affectedPartIds);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.drawCalls).toContainEqual({ indexCount: 3, instanceCount: 3 });
  });

  it("reports device loss, blocks rendering, and recovers on a fresh device", async () => {
    installGpuTestGlobals();
    const gpus = installFreshDeviceNavigator();
    const onLost = vi.fn();
    const renderer = await createWebGpuRenderer({
      canvas: fakeCanvas(),
      onDeviceLost: onLost,
      pointSizePixels: 12,
      nodeSizePixels: 5,
    });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    const presentation = setPartOverride(createInteractionState(), 1, { edge: true, nodes: true });
    renderer.updateInstances(runtime, presentation, [0, 1, 2]);
    renderer.setPointSizePixels(14);
    renderer.setNodeSizePixels(7);
    renderer.setSectionPlane({ normal: [0, 0, 1], distance: -0.25 });
    renderer.render(runtime, camera, scene.parts);
    renderer.setDeformation({
      scale: 1,
      displacements: new Map([[1, new Float32Array([1, 0, 0])]]),
    });
    renderer.render(runtime, camera, scene.parts);
    const latestDisplacements = new Float32Array([2, 0, 0, 0, 2, 0]);
    renderer.setDeformation({
      scale: 3,
      displacements: new Map([[1, latestDisplacements]]),
    });
    renderer.render(runtime, camera, scene.parts);
    const first = gpus[0];
    if (first === undefined) throw new Error("no fake device created");
    expect(first.drawCalls.length).toBeGreaterThan(0);
    expect(
      first.renderPipelineDescriptors.some(
        (descriptor) => descriptor.label === "presentation depth resolve",
      ),
    ).toBe(true);
    expect(
      first.renderPipelineDescriptors.some(
        (descriptor) => descriptor.label === "resolved node annotation overlay",
      ),
    ).toBe(true);
    renderer.resize(400, 300);
    renderer.render(runtime, camera, scene.parts);
    expect(first.textures.some((texture) => texture.destroyed)).toBe(true);
    expect(renderer.lost).toBe(false);
    expect(renderer.device).toBe(first.device);

    first.lose("unknown", "gpu device crashed");
    await first.lost;
    expect(renderer.lost).toBe(true);
    expect(onLost).toHaveBeenCalledWith({ reason: "unknown", message: "gpu device crashed" });
    expect(() => {
      renderer.render(runtime, camera, scene.parts);
    }).toThrow(/lost/);
    await expect(renderer.pick(1, 1)).rejects.toThrow(/lost/);

    await renderer.recover();
    expect(renderer.lost).toBe(false);
    expect(gpus).toHaveLength(2);
    const second = gpus[1];
    if (second === undefined) throw new Error("no recovered device created");
    expect(renderer.device).toBe(second.device);
    expect(
      second.renderPipelineDescriptors.some(
        (descriptor) => descriptor.label === "presentation depth resolve",
      ),
    ).toBe(false);
    renderer.updateInstances(runtime, presentation, [0, 1, 2]);
    renderer.updateElements(runtime, presentation, [0, 1, 2]);
    renderer.render(runtime, camera, scene.parts);
    expect(second.drawCalls.length).toBeGreaterThan(0);
    expect(
      second.renderPipelineDescriptors.some(
        (descriptor) => descriptor.label === "presentation depth resolve",
      ),
    ).toBe(true);
    expect(
      second.renderPipelineDescriptors.some(
        (descriptor) => descriptor.label === "resolved node annotation overlay",
      ),
    ).toBe(true);
    const recoveredCamera = second.buffers.find(
      (buffer) => buffer.size === 128 && (buffer.usage & 1) !== 0,
    );
    const recoveredCameraWrite = second.writes
      .filter((write) => write.buffer === recoveredCamera?.resource)
      .at(-1);
    expect(recoveredCameraWrite).toBeDefined();
    expect(
      recoveredCameraWrite === undefined
        ? undefined
        : Array.from(new Float32Array(recoveredCameraWrite.bytes.buffer).slice(18, 21)),
    ).toEqual([14, 7, 1]);
    const recoveredDisplacement = second.buffers.find(
      (buffer) => buffer.size === 44 && (buffer.usage & 16) !== 0,
    );
    expect(recoveredDisplacement).toBeDefined();
    expect(second.writes.some((write) => write.buffer === recoveredDisplacement?.resource)).toBe(
      true,
    );
    const sectionBuffer = second.buffers
      .filter((buffer) => buffer.size === 16 && (buffer.usage & 1) !== 0)
      .at(-1);
    const recoveredSectionPlane = second.writes
      .filter((write) => write.buffer === sectionBuffer?.resource)
      .at(-1);
    expect(recoveredSectionPlane).toBeDefined();
    expect(
      recoveredSectionPlane === undefined
        ? undefined
        : Array.from(new Float32Array(recoveredSectionPlane.bytes.buffer)),
    ).toEqual([0, 0, 1, -0.25]);
    renderer.destroy();
  });

  it("restores selected-node presentation after device recovery", async () => {
    installGpuTestGlobals();
    const gpus = installFreshDeviceNavigator();
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    const selected = setNodeSelected(
      createInteractionState(),
      { partOccurrenceId: "1/0", nodeId: 1 },
      true,
    );
    renderer.render(runtime, camera, scene.parts);
    renderer.updateElements(runtime, selected);
    renderer.render(runtime, camera, scene.parts);
    expect(readGpuCostSnapshot(renderer).draws["selection-visible"].instances).toBe(1);

    const first = gpus[0];
    if (first === undefined) throw new Error("missing initial fake device");
    first.lose();
    await first.lost;
    await renderer.recover();
    renderer.render(runtime, camera, scene.parts);

    expect(readGpuCostSnapshot(renderer).draws["selection-visible"].instances).toBe(1);
    renderer.destroy();
  });

  it("rebuilds compact subset selection replay after device recovery", async () => {
    installGpuTestGlobals();
    const gpus = installFreshDeviceNavigator();
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildSubsetSelectionScene();
    const runtime = createPackedSceneRuntime(scene);
    const selected = setElementSelected(
      createInteractionState(),
      { partOccurrenceId: "1/0", elementId: 7 },
      true,
    );
    renderer.render(runtime, camera, scene.parts);
    renderer.updateInstances(runtime, selected, [0]);
    renderer.updateElements(runtime, selected, [0]);
    const first = gpus[0];
    if (first === undefined) throw new Error("missing initial fake device");
    const allocationStart = first.buffers.length;
    const drawStart = first.drawCalls.length;
    renderer.render(runtime, camera, scene.parts);
    expect(first.drawCalls.slice(drawStart)).toContainEqual({ indexCount: 3, instanceCount: 1 });
    const replayBuffers = first.buffers.slice(allocationStart);
    expect(replayBuffers.length).toBeGreaterThanOrEqual(4);

    first.lose("unknown", "selection replay recovery");
    await first.lost;
    await renderer.recover();
    expect(replayBuffers.every((buffer) => buffer.destroyed)).toBe(true);

    const recovered = gpus[1];
    if (recovered === undefined) throw new Error("missing recovered fake device");
    renderer.render(runtime, camera, scene.parts);
    renderer.updateInstances(runtime, selected, [0]);
    renderer.updateElements(runtime, selected, [0]);
    const recoveredDrawStart = recovered.drawCalls.length;
    renderer.render(runtime, camera, scene.parts);
    expect(recovered.drawCalls.slice(recoveredDrawStart)).toContainEqual({
      indexCount: 3,
      instanceCount: 1,
    });
    renderer.destroy();
  });

  it("renders bounded exact caps only while an active plane intersects a solid", async () => {
    installGpuTestGlobals();
    const gpus = installFreshDeviceNavigator();
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const gpu = gpus[0];
    if (gpu === undefined) throw new Error("missing initial fake device");
    const scene = buildSectionScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.setSectionPlane({ normal: [0, 0, 1], distance: -0.5 });
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.drawCalls.filter((call) => call.indexCount === 3).length).toBeGreaterThan(0);
    const activeBuffers = gpu.buffers.length;
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.buffers.length).toBe(activeBuffers);

    gpu.lose("unknown", "section-cap recovery");
    await gpu.lost;
    await renderer.recover();
    const recovered = gpus[1];
    if (recovered === undefined) throw new Error("missing recovered fake device");
    renderer.render(runtime, camera, scene.parts);
    expect(recovered.drawCalls.some((call) => call.indexCount === 3)).toBe(true);

    renderer.setSectionPlane(undefined);
    const offStart = recovered.drawCalls.length;
    renderer.render(runtime, camera, scene.parts);
    expect(
      recovered.drawCalls.slice(offStart).filter((call) => call.indexCount === 3),
    ).toHaveLength(0);
    renderer.destroy();
  });

  it("retains active cap geometry through the Viewport instance-then-element selection order", async () => {
    const gpu = fakeGpuDevice({
      pickValue: 1,
      elementPickValue: 8,
      nodePickValue: 99,
      ndcDepth: 0.5,
    });
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildSectionScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.setSectionPlane({ normal: [0, 0, 1], distance: -0.5 });
    renderer.render(runtime, camera, scene.parts);
    const buffers = [...gpu.buffers];

    const selected = setElementSelected(
      createInteractionState(),
      { partOccurrenceId: "1/0", elementId: 7 },
      true,
    );
    renderer.updateInstances(runtime, selected, [0]);
    renderer.updateElements(runtime, selected);
    renderer.render(runtime, camera, scene.parts);

    expect(buffers.every((buffer) => !buffer.destroyed)).toBe(true);
    await expect(renderer.pick(2, 2)).resolves.toMatchObject({ kind: "element", elementId: 7 });
    renderer.destroy();
  });

  it("drops and restores caps through the Viewport instance-then-element visibility order", async () => {
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildSectionScene();
    const runtime = createPackedSceneRuntime(scene);
    const visible = createInteractionState();
    renderer.setSectionPlane({ normal: [0, 0, 1], distance: -0.5 });
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.drawCalls.filter((call) => call.indexCount === 3)).not.toHaveLength(0);

    const hidden = setElementVisible(visible, { partOccurrenceId: "1/0", elementId: 7 }, false);
    renderer.updateInstances(runtime, hidden, [0]);
    renderer.updateElements(runtime, hidden, [0]);
    const hideStart = gpu.drawCalls.length;
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.drawCalls.slice(hideStart).filter((call) => call.indexCount === 3)).toHaveLength(0);

    renderer.updateInstances(runtime, visible, [0]);
    renderer.updateElements(runtime, visible, [0]);
    const restoreStart = gpu.drawCalls.length;
    renderer.render(runtime, camera, scene.parts);
    expect(
      gpu.drawCalls.slice(restoreStart).filter((call) => call.indexCount === 3),
    ).not.toHaveLength(0);
    renderer.destroy();
  });

  it("applies section visibility from an instance-only renderer update", async () => {
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildSectionScene();
    const runtime = createPackedSceneRuntime(scene);
    const visible = createInteractionState();
    renderer.setSectionPlane({ normal: [0, 0, 1], distance: -0.5 });
    renderer.render(runtime, camera, scene.parts);

    const hidden = setElementVisible(visible, { partOccurrenceId: "1/0", elementId: 7 }, false);
    renderer.updateInstances(runtime, hidden, [0]);
    const hideStart = gpu.drawCalls.length;
    renderer.render(runtime, camera, scene.parts);

    expect(gpu.drawCalls.slice(hideStart).filter((call) => call.indexCount === 3)).toHaveLength(0);
    renderer.updateInstances(runtime, visible, [0]);
    const restoreStart = gpu.drawCalls.length;
    renderer.render(runtime, camera, scene.parts);
    expect(
      gpu.drawCalls.slice(restoreStart).filter((call) => call.indexCount === 3),
    ).not.toHaveLength(0);
    renderer.destroy();
  });

  it("maps cap fragments to the owning element without fabricated node identityMatrix", async () => {
    const gpu = fakeGpuDevice({
      pickValue: 1,
      elementPickValue: 8,
      nodePickValue: 99,
      ndcDepth: 0.5,
    });
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildSectionScene();
    renderer.setSectionPlane({ normal: [0, 0, 1], distance: -0.5 });
    renderer.render(createPackedSceneRuntime(scene), camera, scene.parts);
    await expect(renderer.pick(2, 2)).resolves.toMatchObject({ kind: "element", elementId: 7 });
    renderer.destroy();
  });

  it("shares a flat elemental result color with the owning section cap", async () => {
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildSectionScene();
    const runtime = createPackedSceneRuntime(scene);
    setRendererResultColors(renderer, elementalColors());
    renderer.setSectionPlane({ normal: [0, 0, 1], distance: -0.5 });
    renderer.render(runtime, camera, scene.parts);
    expect(elementalResultWrites(gpu)).toHaveLength(2);
    renderer.destroy();
  });

  it("keeps an explicit element color above the result color on its section cap", async () => {
    const gpu = fakeGpuDevice();
    installGpuTestEnvironment(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildSectionScene();
    const runtime = createPackedSceneRuntime(scene);
    const interaction = setElementOverride(
      createInteractionState(),
      { partOccurrenceId: "1/0", elementId: 7 },
      { color: { r: 0, g: 1, b: 0, a: 1 } },
    );
    renderer.updateElements(runtime, interaction);
    setRendererResultColors(renderer, elementalColors());
    renderer.setSectionPlane({ normal: [0, 0, 1], distance: -0.5 });
    renderer.render(runtime, camera, scene.parts);
    expect(elementalResultWrites(gpu)).toHaveLength(1);
    renderer.destroy();
  });
});

function elementalColors() {
  return new Map([
    [
      1,
      {
        location: "elemental" as const,
        values: new Float32Array([0, 0, 0, 0, 0.8, 0.2, 0.1, 1]),
      },
    ],
  ]);
}

function elementalResultWrites(gpu: ReturnType<typeof fakeGpuDevice>) {
  return gpu.writes.filter((write) => {
    if (!(write.source instanceof Float32Array) || write.source.length !== 14) return false;
    const words = new Uint32Array(write.source.buffer, write.source.byteOffset, 2);
    return words[0] === 1 && words[1] === 2 && write.source[2] === 1 && write.source[3] === 2;
  });
}
