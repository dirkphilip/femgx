import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { ElementShape } from "../../src/elements/shapes";
import { createElementModel } from "../../src/elements/model";
import { authoredEdgeSourcesForOrdinals } from "../../src/geometry/authored-edges";

function edgeRows(source: ReturnType<typeof authoredEdgeSourcesForOrdinals>) {
  return Array.from(source.geometryOrdinals, (_geometry, edge) => {
    const nodes = source.nodeIds.subarray(
      source.nodeOffsets[edge] ?? 0,
      source.nodeOffsets[edge + 1] ?? 0,
    );
    const incidents = source.incidentElementIds.subarray(
      source.incidentOffsets[edge] ?? 0,
      source.incidentOffsets[edge + 1] ?? 0,
    );
    const faces = Array.from(
      source.faceElementIds.subarray(
        source.faceOffsets[edge] ?? 0,
        source.faceOffsets[edge + 1] ?? 0,
      ),
      (elementId, index) => ({
        elementId,
        faceIndex: source.faceIndices[(source.faceOffsets[edge] ?? 0) + index],
      }),
    );
    return { nodes: Array.from(nodes), incidents: Array.from(incidents), faces };
  });
}

describe("authoredEdgeSourcesForElements", () => {
  it("retains one occurrence identityMatrix and all incident elements for shared edges", () => {
    const elements = [
      createElement(1, ElementShape.Tet10, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
      createElement(2, ElementShape.Tet10, [0, 1, 2, 10, 4, 5, 6, 11, 12, 13]),
    ];
    const model = createElementModel(new Float32Array(14 * 3), elements);
    const shared = edgeRows(authoredEdgeSourcesForOrdinals(model, new Uint32Array([0, 1]))).find(
      (edge) => edge.nodes.join(",") === "0,4,1",
    );
    expect(shared).toMatchObject({ nodes: [0, 4, 1], incidents: [1, 2] });
    expect(shared?.faces).toHaveLength(4);
  });

  it("keeps linear and quadratic edge identities deterministic", () => {
    const model = createElementModel(new Float32Array(4 * 3), [
      createElement(1, ElementShape.Tet4, [3, 2, 1, 0]),
    ]);
    const linear = edgeRows(authoredEdgeSourcesForOrdinals(model, new Uint32Array([0])));
    expect(linear.map((edge) => edge.nodes)).toEqual([
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
  });
});
