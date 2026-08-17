import { describe, expect, it } from "vitest";
import {
  createTestScene,
  elementalScalar,
  nodalDisplacement,
  nodalScalar,
  createInteractionState,
  readInteractionState,
  createResultField,
  applyViewportResultInteraction,
  resolveViewportResults,
  viewportResultColors,
} from "./support";

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
        scalar: { field: elementalScalar() },
        deformation: { field: nodalDisplacement(), scale: 2 },
      },
      scene,
      runtime,
    );

    const scalar = resolved.scalar;
    if (scalar === undefined || scalar.field.location !== "elemental") {
      throw new Error("Expected elemental scalar field");
    }
    expect(scalar.field.name).toBe("Authored stress");
    expect(scalar.field.values[0]).toBeCloseTo(3);
    expect(scalar.range.min).toBeLessThan(3);
    expect(scalar.range.max).toBeGreaterThan(3);
    const effective = applyViewportResultInteraction(
      createInteractionState(),
      scalar,
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
      { scalar: { field: nodalScalar(), range: { min: 0, max: 10 } } },
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
        scalar: {
          field: createResultField({
            id: "temperature-a",
            name: "Temperature A",
            location: "nodal",
            shape: "scalar",
            count: 3,
            unit: "C",
            values: scalarValues,
          }),
        },
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
        scalar: {
          field: createResultField({
            id: "temperature-b",
            name: "Temperature B",
            location: "nodal",
            shape: "scalar",
            count: 3,
            unit: "C",
            values: scalarValues,
          }),
        },
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
});
