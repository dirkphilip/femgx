import { describe, expect, it } from "vitest";
import { createResultsFixture } from "../../demo/results-fixture";
import { deformPositions } from "../../src/results/deform";
import { createCasePlayer, sampleDisplacements } from "../../src/results/case-player";

describe("createResultsFixture", () => {
  it("tessellates the plate through the FE geometry builder with a per-vertex node map", () => {
    const { mesh } = createResultsFixture();
    const vertexCount = mesh.positions.length / 3;
    expect(mesh.nodePickIds.length).toBe(vertexCount);
    expect(mesh.nodePickIds).not.toContain(0);
    expect(mesh.triangleElements.length).toBe(mesh.indices.length / 3);
  });

  it("deforms every tessellated vertex by its own node's displacement", () => {
    const { mesh, cases } = createResultsFixture();
    const field = sampleDisplacements(createCasePlayer(cases.map((caze) => caze.displacement)));
    const deformed = deformPositions(mesh.positions, mesh.nodePickIds, field, 1);
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex++) {
      const nodePickId = mesh.nodePickIds[vertex];
      if (nodePickId === undefined) continue;
      const source = (nodePickId - 1) * 3;
      const base = vertex * 3;
      for (let component = 0; component < 3; component++) {
        expect(deformed[base + component]).toBeCloseTo(
          (mesh.positions[base + component] ?? 0) + (field.values[source + component] ?? 0),
          5,
        );
      }
    }
  });
});
