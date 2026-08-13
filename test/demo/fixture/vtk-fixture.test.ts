import { describe, expect, it } from "vitest";
import { createVtkFixture } from "../../../demo/fixture/vtk-fixture";

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
    expect(fixture.results.field.name).toBe("stress");
    expect(fixture.results.deformation?.field.name).toBe("displacement");
    expect(fixture.scene.parts.size).toBe(1);
    const solid = fixture.scene.parts.get(fixture.partIds.solid)?.geometry;
    if (solid?.primitive !== "triangles") throw new Error("VTK solid fixture is not triangles");
    expect(solid.faceSubset?.faceIds.length).toBeGreaterThan(0);
    expect(solid.faceSubset?.faceIds.length).toBeLessThan(solid.faces?.length ?? 0);
  });
});
