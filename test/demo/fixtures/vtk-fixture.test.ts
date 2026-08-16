import { describe, expect, it } from "vitest";
import { createVtkFixture } from "../../../demo/fixtures/vtk-fixture";
import { createVtkScene } from "../../../demo/fixtures/vtk-scene";
import { parseVtk } from "../../../src/entries/io";

const MIXED_VTK = [
  "# vtk DataFile Version 5.0",
  "mixed primitive example",
  "ASCII",
  "DATASET UNSTRUCTURED_GRID",
  "POINTS 7 double",
  "0 0 0",
  "1 0 0",
  "2 0 0",
  "0 1 0",
  "1 1 0",
  "0 0 1",
  "0 0 2",
  "CELLS 3 9",
  "1 0",
  "2 1 2",
  "3 3 4 5",
  "CELL_TYPES 3",
  "1",
  "3",
  "5",
].join("\n");

describe("createVtkFixture", () => {
  it("parses the checked-in mesh and its nodal/element results", () => {
    const fixture = createVtkFixture();
    expect(fixture.vtkModel.nodes.count).toBe(18);
    expect(fixture.vtkModel.elementShapeBlocks[0]?.count).toBe(4);
    expect(fixture.vtkModel.results.map((result) => result.name)).toEqual([
      "temperature",
      "displacement",
      "stress",
    ]);
    expect(fixture.vtkModel.results[0]?.location).toBe("node");
    expect(fixture.vtkModel.results[1]?.location).toBe("node");
    expect(fixture.vtkModel.results[2]?.location).toBe("element");
    expect(fixture.results.scalar?.field.name).toBe("stress");
    expect(fixture.results.deformation?.field.name).toBe("displacement");
    expect(fixture.resultScalarFields.map((field) => [field.name, field.location])).toEqual([
      ["stress", "elemental"],
      ["temperature", "nodal"],
    ]);
    expect(fixture.scene.parts.size).toBe(1);
    const solid = fixture.scene.parts.get(fixture.partIds.solid)?.geometries[0];
    if (solid?.primitive !== "triangles") throw new Error("VTK solid fixture is not triangles");
    expect(solid.faceSubset?.faceIds.length).toBeGreaterThan(0);
    expect(solid.faceSubset?.faceIds.length).toBeLessThan(solid.faces?.length ?? 0);
  });

  it("builds mixed VTK cells into one semantic part", () => {
    const imported = createVtkScene(parseVtk(MIXED_VTK).model);
    const part = [...imported.scene.parts.values()][0];
    expect(part?.geometries.map((geometry) => geometry.primitive)).toEqual([
      "triangles",
      "lines",
      "points",
    ]);
    expect(imported.partNames.size).toBe(1);
    expect(imported.elementModels.size).toBe(1);
  });
});
