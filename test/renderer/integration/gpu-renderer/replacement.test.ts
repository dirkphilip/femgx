import { expect, it, describe } from "vitest";
import {
  createWebGpuRenderer,
  readGpuCostSnapshot,
  createPart,
  createPackedSceneRuntime,
  createInteractionState,
  setElementOverride,
  setElementSelected,
  setElementVisible,
  setPartOverride,
  setBodyOverride,
  createScene,
  identity,
  translation,
  fakeCanvas,
  fakeGpuDevice,
  installNavigator,
  buildScene,
  buildFaceScene,
  buildBodyScene,
  buildSelectablePart,
  buildSubsetPart,
  camera,
  installGpuTestGlobals,
} from "./support";

describe("WebGPU renderer", () => {
  it.each([
    ["instance", () => setPartOverride(createInteractionState(), 1, { opacity: 0.5 })],
    [
      "body",
      () =>
        setBodyOverride(
          createInteractionState(),
          { partOccurrenceId: "1/0", bodyId: 3 },
          { opacity: 0.5 },
        ),
    ],
    [
      "element",
      () =>
        setElementOverride(
          createInteractionState(),
          { partOccurrenceId: "1/0", elementId: 0 },
          { opacity: 0.5 },
        ),
    ],
  ])("classifies fractional %s alpha in the transparent pass", async (level, createState) => {
    installGpuTestGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = level === "body" ? buildBodyScene() : buildFaceScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);
    const interaction = createState();
    if (level === "instance") renderer.updateInstances(runtime, interaction, [0]);
    else renderer.updateElements(runtime, interaction);
    renderer.render(runtime, camera, scene.parts);
    const pipelineBase = level === "instance" ? 10 : 0;
    expect(gpu.pipelineDraws.slice(-2)).toEqual([
      { pipeline: `pipeline-${pipelineBase}`, indexCount: 3, instanceCount: 1 },
      { pipeline: `pipeline-${pipelineBase + 1}`, indexCount: 3, instanceCount: 1 },
    ]);
    renderer.destroy();
  });

  it("culls hidden instances from the edge overlay and restores them on show", async () => {
    installGpuTestGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const scene = buildScene();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);
    const edge = setPartOverride(createInteractionState(), 1, { edge: true });
    renderer.updateInstances(runtime, edge, [0, 1, 2]);

    const hidden = runtime.setInstanceVisible(1, false);
    renderer.updateInstances(runtime, edge, hidden.changedInstanceIds);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws.at(-1)).toEqual({
      pipeline: "pipeline-20",
      indexCount: 6,
      instanceCount: 2,
    });

    runtime.setInstanceVisible(1, true);
    renderer.updateInstances(runtime, edge, [0, 1, 2]);
    renderer.render(runtime, camera, scene.parts);
    expect(gpu.pipelineDraws.at(-1)).toEqual({
      pipeline: "pipeline-20",
      indexCount: 6,
      instanceCount: 3,
    });

    renderer.destroy();
  });

  it("rebuilds the attachment when a runtime is replaced", async () => {
    installGpuTestGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const geometry = {
      positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles" as const,
    };
    const part1 = createPart(1, { geometries: [geometry] });

    const wrapped = createScene()
      .addPart(part1)
      .addAssembly({
        id: 2,
        name: "wrapped",
        placements: [{ kind: "part", partId: 1, transform: translation(0, 0, 0) }],
      })
      .addAssembly({
        id: 1,
        name: "root",
        placements: [{ kind: "assembly", assemblyId: 2, transform: identity() }],
      })
      .withRoot(1)
      .build();
    const runtime1 = createPackedSceneRuntime(wrapped);
    renderer.render(runtime1, camera, wrapped.parts);
    expect(gpu.buffers.every((buffer) => !buffer.destroyed)).toBe(true);
    const geometryBuffers = gpu.buffers.filter((buffer) => (buffer.usage & 4) !== 0);

    const replacementScene = createScene()
      .addPart(part1)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [
          { kind: "part", partId: 1, transform: translation(0, 0, 0) },
          { kind: "part", partId: 1, transform: translation(2, 0, 0) },
        ],
      })
      .withRoot(1)
      .build();
    const runtime2 = createPackedSceneRuntime(replacementScene);
    renderer.render(runtime2, camera, replacementScene.parts);

    expect(gpu.buffers.some((buffer) => buffer.destroyed)).toBe(true);
    expect(geometryBuffers.every((buffer) => !buffer.destroyed)).toBe(true);
    renderer.destroy();
  });

  it("clears stale selected primitive ranges when parts change for the same runtime", async () => {
    installGpuTestGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const initialPart = buildSelectablePart([
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    const scene = createScene()
      .addPart(initialPart)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [{ kind: "part", partId: initialPart.id, transform: identity() }],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);

    const selected = setElementSelected(
      createInteractionState(),
      { partOccurrenceId: "1/0", elementId: 101 },
      true,
    );
    renderer.updateElements(runtime, selected);
    renderer.render(runtime, camera, scene.parts);
    expect(readGpuCostSnapshot(renderer).draws["selection-visible"].indices).toBe(3);

    const replacementPart = buildSelectablePart([
      [1, 2],
      [0, 1],
    ]);
    renderer.render(runtime, camera, new Map([[replacementPart.id, replacementPart]]));

    expect(readGpuCostSnapshot(renderer).draws["selection-visible"].indices).toBe(9);
    renderer.destroy();
  });

  it("uses exterior selection geometry only for opaque unsectioned scenes", async () => {
    installGpuTestGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const part = buildSubsetPart();
    const scene = createScene()
      .addPart(part)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [{ kind: "part", partId: part.id, transform: identity() }],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);
    renderer.updateElements(
      runtime,
      setElementSelected(
        createInteractionState(),
        { partOccurrenceId: "1/0", elementId: 101 },
        true,
      ),
    );
    renderer.render(runtime, camera, scene.parts);
    expect(readGpuCostSnapshot(renderer).draws["selection-visible"].indices).toBe(3);
    expect(readGpuCostSnapshot(renderer).draws["selection-hidden"].indices).toBe(3);

    renderer.setSectionPlane({ normal: [0, 0, 1], distance: 0 });
    renderer.render(runtime, camera, scene.parts);
    expect(readGpuCostSnapshot(renderer).draws["selection-visible"].indices).toBe(6);
    expect(readGpuCostSnapshot(renderer).draws["selection-hidden"].indices).toBe(6);
    expect(gpu.drawCalls.some((call) => call.indexCount === 6)).toBe(true);

    renderer.setSectionPlane(undefined);
    const fractional = setPartOverride(createInteractionState(), 1, { opacity: 0.5 });
    const selected = setElementSelected(
      fractional,
      { partOccurrenceId: "1/0", elementId: 101 },
      true,
    );
    renderer.updateElements(runtime, selected);
    renderer.render(runtime, camera, scene.parts);
    expect(readGpuCostSnapshot(renderer).draws["selection-visible"].indices).toBe(6);
    expect(readGpuCostSnapshot(renderer).draws["selection-hidden"].indices).toBe(6);
    renderer.destroy();
  });

  it("submits a compact solid skin after element visibility exposes an interior", async () => {
    installGpuTestGlobals();
    const gpu = fakeGpuDevice();
    installNavigator(gpu.device);
    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    const part = buildSubsetPart();
    const scene = createScene()
      .addPart(part)
      .addAssembly({
        id: 1,
        name: "root",
        placements: [{ kind: "part", partId: part.id, transform: identity() }],
      })
      .withRoot(1)
      .build();
    const runtime = createPackedSceneRuntime(scene);
    renderer.render(runtime, camera, scene.parts);
    expect(readGpuCostSnapshot(renderer).draws.opaque.indices).toBe(3);

    renderer.updateElements(
      runtime,
      setElementVisible(
        createInteractionState(),
        { partOccurrenceId: "1/0", elementId: 101 },
        false,
      ),
    );
    renderer.render(runtime, camera, scene.parts);

    expect(readGpuCostSnapshot(renderer).draws.opaque.indices).toBe(3);
    await renderer.pick(400, 300);
    expect(readGpuCostSnapshot(renderer).draws.pick.indices).toBe(3);
    renderer.destroy();
  });
});
