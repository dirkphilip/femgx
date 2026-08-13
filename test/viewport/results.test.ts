import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { createElementModel } from "../../src/elements/model";
import { HEX20_SHAPE } from "../../src/elements/shapes";
import { heterogeneousElementParts } from "../../src/geometry/heterogeneous-element-mesh";
import { createPart } from "../../src/geometry/part";
import { createInteractionState, setPartOverride } from "../../src/interaction/interaction";
import { readInteractionState } from "../../src/interaction/state";
import { identity } from "../../src/math/mat4";
import { createResultField } from "../../src/results/fields";
import { createScene } from "../../src/scene/scene";
import { createFemViewport } from "../../src/viewport/fem-viewport";
import {
  applyViewportResultInteraction,
  resolveViewportResults,
  viewportResultColors,
} from "../../src/viewport/results";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "../renderer/fake-gpu";

let restoreGpuGlobals: (() => void) | undefined;
const originalNavigator = globalThis.navigator;

afterEach(() => {
  restoreGpuGlobals?.();
  restoreGpuGlobals = undefined;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

function installNavigator(): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: { getPreferredCanvasFormat: () => "bgra8unorm" } },
  });
}

function createTestScene() {
  const geometry = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
    elements: [{ id: 0, primitiveStart: 0, primitiveCount: 1 }],
    nodePickIds: new Uint32Array([1, 2, 3]),
  };
  return createScene()
    .addPart(createPart(1, geometry))
    .addAssembly({
      id: 1,
      name: "root",
      placements: [{ kind: "part", partId: 1, transform: identity() }],
    })
    .withRoot(1)
    .build();
}

function createHex20ViewportScene() {
  const nodes = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
    [0.5, 0, 0],
    [1, 0.5, 0],
    [0.5, 1, 0],
    [0, 0.5, 0],
    [0.5, 0, 1],
    [1, 0.5, 1],
    [0.5, 1, 1],
    [0, 0.5, 1],
    [0, 0, 0.5],
    [1, 0, 0.5],
    [1, 1, 0.5],
    [0, 1, 0.5],
  ].flat();
  const model = createElementModel(nodes, [
    createElement(
      1,
      HEX20_SHAPE,
      Array.from({ length: 20 }, (_, index) => index),
    ),
  ]);
  const part = heterogeneousElementParts({ triangle: 7 }, model).triangle;
  if (part === undefined) throw new Error("Hex20 viewport fixture has no triangle part");
  const scene = createScene()
    .addPart(part)
    .addAssembly({
      id: 7,
      name: "hex20",
      placements: [{ kind: "part", partId: 7, transform: identity() }],
    })
    .withRoot(7)
    .build();
  return { model, scene, part };
}

function elementalScalar() {
  return createResultField({
    id: "authored-stress",
    name: "Authored stress",
    location: "elemental",
    shape: "scalar",
    count: 1,
    unit: "MPa",
    values: new Float32Array([3]),
  });
}

function nodalDisplacement() {
  return createResultField({
    id: "displacement",
    name: "Displacement",
    location: "nodal",
    shape: "vector",
    count: 3,
    unit: "mm",
    values: new Float32Array([0.1, 0, 0, 0, 0.2, 0, 0, 0, 0.3]),
  });
}

function nodalScalar() {
  return createResultField({
    id: "temperature",
    name: "Temperature",
    location: "nodal",
    shape: "scalar",
    count: 3,
    unit: "C",
    values: new Float32Array([0, 5, 10]),
  });
}

describe("viewport results workflow", () => {
  it("maps and validates one authored elemental result", () => {
    const scene = createTestScene();
    const runtime = {
      instanceCount: 1,
      getPartId: () => 1,
      getInstanceId: () => "1/0",
    } as never;
    const resolved = resolveViewportResults(
      {
        field: elementalScalar(),
        deformation: { field: nodalDisplacement(), scale: 2 },
      },
      scene,
      runtime,
    );

    expect(resolved.scalarField.name).toBe("Authored stress");
    expect(resolved.scalarField.values[0]).toBeCloseTo(3);
    expect(resolved.range.min).toBeLessThan(3);
    expect(resolved.range.max).toBeGreaterThan(3);
    if (resolved.scalarField.location !== "elemental") throw new Error("Expected elemental field");
    const effective = applyViewportResultInteraction(
      createInteractionState(),
      resolved.scalarField,
      resolved.colorMap,
      scene,
      runtime,
    );
    expect(
      readInteractionState(effective).elementOverrides.get("1/0")?.get(0)?.color,
    ).toMatchObject({
      r: 0.95,
      g: 0.85,
      a: 1,
    });
    expect(resolved.deformation?.scale).toBe(2);
    expect(resolved.deformation?.displacements.get(1)).toEqual(
      new Float32Array([0.1, 0, 0, 0, 0.2, 0, 0, 0, 0.3]),
    );
  });

  it("maps nodal scalars by exact node pick id without averaging", () => {
    const scene = createTestScene();
    const runtime = {
      instanceCount: 1,
      getPartId: () => 1,
      getInstanceId: () => "1/0",
    } as never;
    const resolved = resolveViewportResults(
      { field: nodalScalar(), range: { min: 0, max: 10 } },
      scene,
      runtime,
    );
    const colors = viewportResultColors(resolved)?.get(1);
    expect(colors?.slice(0, 4)).toEqual(new Float32Array([0, 0, 0, 0]));
    expect(colors?.slice(4, 8)).toEqual(new Float32Array([0.12, 0.34, 0.95, 1]));
    expect(colors?.slice(8, 12)).toEqual(new Float32Array([0.95, 0.85, 0.2, 1]));
    expect(colors?.slice(12, 16)).toEqual(new Float32Array([0.75, 0.05, 0.1, 1]));
  });

  it("reuses derived result buffers when authored arrays are unchanged", () => {
    const scene = createTestScene();
    const runtime = {
      instanceCount: 1,
      getPartId: () => 1,
      getInstanceId: () => "1/0",
    } as never;
    const scalarValues = new Float32Array([0, 5, 10]);
    const displacementValues = new Float32Array([0.1, 0, 0, 0, 0.2, 0, 0, 0, 0.3]);
    const first = resolveViewportResults(
      {
        field: createResultField({
          id: "temperature-a",
          name: "Temperature A",
          location: "nodal",
          shape: "scalar",
          count: 3,
          unit: "C",
          values: scalarValues,
        }),
        deformation: {
          field: createResultField({
            id: "displacement-a",
            name: "Displacement A",
            location: "nodal",
            shape: "vector",
            count: 3,
            unit: "mm",
            values: displacementValues,
          }),
        },
      },
      scene,
      runtime,
    );
    const second = resolveViewportResults(
      {
        field: createResultField({
          id: "temperature-b",
          name: "Temperature B",
          location: "nodal",
          shape: "scalar",
          count: 3,
          unit: "C",
          values: scalarValues,
        }),
        deformation: {
          field: createResultField({
            id: "displacement-b",
            name: "Displacement B",
            location: "nodal",
            shape: "vector",
            count: 3,
            unit: "mm",
            values: displacementValues,
          }),
          scale: 3,
        },
      },
      scene,
      runtime,
      first,
    );

    expect(viewportResultColors(second)?.get(1)).toBe(viewportResultColors(first)?.get(1));
    expect(second.deformation?.displacements.get(1)).toBe(first.deformation?.displacements.get(1));
    expect(second.deformation?.scale).toBe(3);
  });

  it("validates deformation only for parts placed in the compiled runtime", () => {
    const scene = createScene()
      .addPart(
        createPart(1, {
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
          indices: new Uint32Array([0, 1, 2]),
          primitive: "triangles",
          elements: [{ id: 0, primitiveStart: 0, primitiveCount: 1 }],
          nodePickIds: new Uint32Array([1, 2, 3]),
        }),
      )
      .addPart(
        createPart(2, {
          positions: new Float32Array([5, 5, 5]),
          indices: new Uint32Array([0]),
          primitive: "points",
        }),
      )
      .addAssembly({
        id: 1,
        name: "root",
        placements: [{ kind: "part", partId: 1, transform: identity() }],
      })
      .withRoot(1)
      .build();
    const runtime = {
      instanceCount: 1,
      getPartId: () => 1,
      getInstanceId: () => "1/0",
    } as never;

    expect(() =>
      resolveViewportResults(
        {
          field: elementalScalar(),
          deformation: { field: nodalDisplacement() },
        },
        scene,
        runtime,
      ),
    ).not.toThrow();
  });

  it("drives the renderer and restores base interaction when cleared", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const base = createInteractionState();
    const viewport = await createFemViewport({
      canvas: fakeCanvas(),
      scene: createTestScene(),
      device: gpu.device,
      interaction: base,
      results: {
        field: elementalScalar(),
        deformation: { field: nodalDisplacement(), scale: 2 },
      },
    });

    expect(viewport.results?.scalarField.name).toBe("Authored stress");
    expect(viewport.interaction).toBe(base);
    expect(
      gpu.writes.some((write) => write.bytes.byteLength === nodalDisplacement().values.byteLength),
    ).toBe(true);

    viewport.clearResults();
    expect(viewport.results).toBeUndefined();
    expect(viewport.interaction).toBe(base);
    viewport.destroy();
  });

  it("keeps load-step resources bounded and makes scale-only updates uniform-only", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const scene = createTestScene();
    const scalarA = nodalScalar();
    const scalarB = createResultField({
      id: "temperature-b",
      name: "Temperature B",
      location: "nodal",
      shape: "scalar",
      count: 3,
      unit: "C",
      values: new Float32Array([10, 5, 0]),
    });
    const displacementA = nodalDisplacement();
    const displacementB = createResultField({
      id: "displacement-b",
      name: "Displacement B",
      location: "nodal",
      shape: "vector",
      count: 3,
      unit: "mm",
      values: new Float32Array([0.2, 0, 0, 0, 0.1, 0, 0, 0, 0.4]),
    });
    const elementalA = elementalScalar();
    const elementalB = createResultField({
      id: "stress-b",
      name: "Authored stress B",
      location: "elemental",
      shape: "scalar",
      count: 1,
      unit: "MPa",
      values: new Float32Array([6]),
    });
    const viewport = await createFemViewport({
      canvas: fakeCanvas(),
      scene,
      device: gpu.device,
      results: { field: scalarA, deformation: { field: displacementA } },
    });
    const runtime = viewport.runtime;
    const displacementBuffer = gpu.buffers.find(
      (buffer) => buffer.size === displacementA.values.byteLength && (buffer.usage & 16) !== 0,
    );
    const displacementWrites = (): number =>
      gpu.writes.filter((write) => write.buffer === displacementBuffer?.resource).length;
    const uniformBuffer = gpu.buffers.find(
      (buffer) => buffer.size === 16 && (buffer.usage & 1) !== 0,
    );
    const uniformWrites = (): number =>
      gpu.writes.filter((write) => write.buffer === uniformBuffer?.resource).length;
    const beforeScale = displacementWrites();
    const beforeUniform = uniformWrites();

    viewport.setResults({ field: scalarA, deformation: { field: displacementA, scale: 2 } });

    expect(displacementWrites()).toBe(beforeScale);
    expect(uniformWrites()).toBeGreaterThan(beforeUniform);
    viewport.setResults({ field: elementalA, deformation: { field: displacementA } });
    viewport.setResults({ field: elementalB, deformation: { field: displacementB } });
    const bufferCount = gpu.buffers.length;
    for (let step = 0; step < 100; step += 1) {
      const alternate = step % 2 === 1;
      viewport.setResults({
        field: alternate ? scalarB : scalarA,
        deformation: {
          field: alternate ? displacementB : displacementA,
          scale: 1 + (step % 3) * 0.5,
        },
      });
    }

    expect(gpu.buffers.length).toBe(bufferCount);
    expect(displacementBuffer?.destroyed).toBe(false);
    expect(viewport.scene).toBe(scene);
    expect(viewport.runtime).toBe(runtime);
    viewport.destroy();
  });

  it("keeps the host interaction stable while result rendering is active", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const base = setPartOverride(createInteractionState(), 1, {
      color: { r: 1, g: 0, b: 0, a: 1 },
    });
    const viewport = await createFemViewport({
      canvas: fakeCanvas(),
      scene: createTestScene(),
      device: fakeGpuDevice().device,
      interaction: base,
      results: { field: elementalScalar() },
    });

    expect(viewport.interaction).toBe(base);
    expect(viewport.results).not.toHaveProperty("interaction");
    const next = setPartOverride(base, 1, { emissive: 0.4 });
    viewport.setInteraction(next);
    expect(viewport.interaction).toBe(next);
    expect(viewport.results).not.toHaveProperty("interaction");

    viewport.clearResults();
    expect(viewport.interaction).toBe(next);
    viewport.destroy();
  });

  it("drives actual Hex20 tessellation through viewport deformation", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const { model, scene, part } = createHex20ViewportScene();
    const field = createResultField({
      id: "hex20-viewport-displacement",
      name: "Hex20 viewport displacement",
      location: "nodal",
      shape: "vector",
      count: model.nodes.length / 3,
      unit: "mm",
      values: new Float32Array(model.nodes.length).fill(0.1),
    });
    const stress = createResultField({
      id: "hex20-viewport-stress",
      name: "Hex20 viewport stress",
      location: "elemental",
      shape: "scalar",
      count: 2,
      unit: "MPa",
      values: new Float32Array([0, 1]),
    });
    const viewport = await createFemViewport({
      canvas: fakeCanvas(),
      scene,
      device: gpu.device,
      results: { field: stress, deformation: { field } },
    });

    expect(part.geometry.indices.length).toBe(6 * 6 * 3);
    expect(part.geometry.nodePickIds).not.toContain(0);
    expect(viewport.results?.deformation?.displacements.get(7)).toHaveLength(model.nodes.length);
    expect(gpu.writes.some((write) => write.bytes.byteLength === model.nodes.length * 4)).toBe(
      true,
    );
    viewport.destroy();
  });

  it("reports an elemental field/geometry mismatch", () => {
    const scene = createTestScene();
    const runtime = {
      instanceCount: 1,
      getPartId: () => 1,
      getInstanceId: () => "1/0",
    } as never;
    const field = createResultField({
      id: "short",
      name: "Short",
      location: "elemental",
      shape: "scalar",
      count: 0,
      unit: "MPa",
      values: new Float32Array(),
    });

    expect(() =>
      resolveViewportResults({ field, range: { min: 0, max: 1 } }, scene, runtime),
    ).toThrow("has no value for element 0 in part 1");
  });
});
