import { afterEach, describe, expect, it } from "vitest";
import { computeBounds } from "../../src/geometry/part";
import { createInteractionState } from "../../src/interaction/interaction";
import { identity } from "../../src/math/mat4";
import { createResultField } from "../../src/results/fields";
import { createScene } from "../../src/scene/scene";
import { createFemViewport } from "../../src/viewport/fem-viewport";
import { resolveViewportResults } from "../../src/viewport/results";
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
    elements: [{ id: 0, triangleStart: 0, triangleCount: 1 }],
    nodePickIds: new Uint32Array([1, 2, 3]),
  };
  return createScene()
    .addPart({ id: 1, geometry, bounds: computeBounds(geometry) })
    .addAssembly({
      id: 1,
      name: "root",
      placements: [{ kind: "part", partId: 1, transform: identity() }],
    })
    .withRoot(1)
    .build();
}

function elementalTensor() {
  return createResultField({
    id: "stress",
    name: "Stress",
    location: "elemental",
    shape: "tensor",
    count: 1,
    unit: "MPa",
    values: new Float32Array([3, 0, 0, 0, 0, 0]),
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

describe("viewport results workflow", () => {
  it("derives, maps, and validates one elemental result", () => {
    const scene = createTestScene();
    const runtime = {
      instanceCount: 1,
      getPartId: () => 1,
      getInstanceId: () => "1/0",
    } as never;
    const resolved = resolveViewportResults(
      {
        field: elementalTensor(),
        derive: "vonMises",
        deformation: { field: nodalDisplacement(), scale: 2 },
      },
      scene,
      runtime,
      createInteractionState(),
    );

    expect(resolved.scalarField.name).toBe("Stress von Mises");
    expect(resolved.scalarField.values[0]).toBeCloseTo(3);
    expect(resolved.range.min).toBeLessThan(3);
    expect(resolved.range.max).toBeGreaterThan(3);
    expect(resolved.interaction.elementOverrides.get("1/0")?.get(0)?.color).toMatchObject({
      r: 0.95,
      g: 0.85,
      a: 1,
    });
    expect(resolved.deformation?.scale).toBe(2);
    expect(resolved.deformation?.displacements.get(1)).toEqual(
      new Float32Array([0.1, 0, 0, 0, 0.2, 0, 0, 0, 0.3]),
    );
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
        field: elementalTensor(),
        derive: "vonMises",
        deformation: { field: nodalDisplacement(), scale: 2 },
      },
    });

    expect(viewport.results?.scalarField.name).toBe("Stress von Mises");
    expect(viewport.results?.deformation?.loadCaseCount).toBe(1);
    expect(
      gpu.writes.some((write) => write.bytes.byteLength === nodalDisplacement().values.byteLength),
    ).toBe(true);

    viewport.clearResults();
    expect(viewport.results).toBeUndefined();
    expect(viewport.interaction).toBe(base);
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
      resolveViewportResults(
        { field, range: { min: 0, max: 1 } },
        scene,
        runtime,
        createInteractionState(),
      ),
    ).toThrow("has no value for element 0 in part 1");
  });
});
