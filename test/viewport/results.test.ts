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
