import { describe, expect, it } from "vitest";
import { createElement } from "../../../src/elements/element";
import { createElementModel } from "../../../src/elements/model";
import { ElementShape } from "../../../src/elements/shapes";
import {
  tet10Model,
  sharedTetPairModel,
  pointLineModel,
  containsPosition,
  geometryFor,
  boundaryFaceRefs,
  FaceSelectionError,
  TET_NODES,
} from "./support";

describe("createPartFromElementModel geometry", () => {
  it("records exact face ranges, descriptors, and neighbors", () => {
    const solid = geometryFor(sharedTetPairModel(), "triangle");
    expect(solid.faces?.count).toBe(8);
    for (const face of solid.faces ?? []) {
      expect(face.primitiveCount).toBeGreaterThan(0);
      expect(face.nodeIds.length).toBeGreaterThanOrEqual(3);
      expect(face.key).toBeDefined();
    }
  });

  it("retains interior face metadata in solid geometry", () => {
    const solid = geometryFor(sharedTetPairModel(), "triangle");
    expect(Array.from(solid.faces ?? []).some((face) => face.neighborElementId !== undefined)).toBe(
      true,
    );
  });

  it("keeps full geometry while drawing an explicit stable face subset", () => {
    const geometry = geometryFor(sharedTetPairModel(), "triangle", {
      faceSubset: [{ elementId: 1, faceIndex: 3 }],
    });
    expect(geometry.indices.length).toBe(8 * 3);
    expect(Array.from(geometry.faceSubset ?? [])).toEqual([{ elementId: 1, faceIndex: 3 }]);
    expect(geometry.faces?.count).toBe(8);
    expect(geometry.faces?.at(3)).toMatchObject({
      elementId: 1,
      faceIndex: 3,
      neighborElementId: 2,
    });
  });

  it("accepts an empty face subset and rejects unresolved identities", () => {
    const empty = geometryFor(sharedTetPairModel(), "triangle", { faceSubset: [] });
    expect(empty.faceSubset?.count).toBe(0);
    expect(() =>
      geometryFor(sharedTetPairModel(), "triangle", {
        faceSubset: [{ elementId: 1, faceIndex: 8 }],
      }),
    ).toThrow(FaceSelectionError);
    expect(() =>
      geometryFor(sharedTetPairModel(), "triangle", {
        faceSubset: [{ elementId: 99, faceIndex: 0 }],
      }),
    ).toThrow(/outside heterogeneous elements/);
    expect(() =>
      geometryFor(sharedTetPairModel(), "triangle", {
        faceSubset: [
          { elementId: 1, faceIndex: 0 },
          { elementId: 1, faceIndex: 0 },
        ],
      }),
    ).toThrow(/repeats element 1 face 0/);
  });

  it("preserves explicit subset order after typed identityMatrix resolution", () => {
    const geometry = geometryFor(sharedTetPairModel(), "triangle", {
      faceSubset: [
        { elementId: 2, faceIndex: 3 },
        { elementId: 1, faceIndex: 0 },
      ],
    });
    expect(Array.from(geometry.faceSubset ?? [])).toEqual([
      { elementId: 2, faceIndex: 3 },
      { elementId: 1, faceIndex: 0 },
    ]);
  });

  it("rejects three coincident faces without a model-sized neighbor map", () => {
    const model = createElementModel(TET_NODES, [
      createElement(1, ElementShape.Tet4, [0, 1, 2, 3]),
      createElement(2, ElementShape.Tet4, [0, 1, 2, 3]),
      createElement(3, ElementShape.Tet4, [0, 1, 2, 3]),
    ]);
    expect(() => geometryFor(model, "triangle")).toThrow(
      "Non-manifold face 0,1,2 has 3 incident elements",
    );
  });

  it("derives stable exterior identities from face classification", () => {
    const elements = [...sharedTetPairModel().elements];
    const refs = boundaryFaceRefs(elements);
    expect(refs).toEqual([
      { elementId: 1, faceIndex: 0 },
      { elementId: 1, faceIndex: 1 },
      { elementId: 1, faceIndex: 2 },
      { elementId: 2, faceIndex: 0 },
      { elementId: 2, faceIndex: 1 },
      { elementId: 2, faceIndex: 2 },
    ]);
  });

  it("generates point sprites for point elements", () => {
    const geometry = geometryFor(pointLineModel(), "point");
    expect(geometry.primitive).toBe("points");
    expect(geometry.positions.length / 3).toBe(2);
    expect(geometry.indices.length).toBe(2);
    expect(containsPosition(geometry, [1, 2, 3])).toBe(true);
    expect(containsPosition(geometry, [4, 5, 6])).toBe(true);
    expect(Array.from(geometry.nodePickIds ?? [])).toEqual([1, 2]);
  });

  it("generates line segments for line elements", () => {
    const geometry = geometryFor(pointLineModel(), "line");
    expect(geometry.primitive).toBe("lines");
    expect(geometry.indices.length).toBe(2 + 2 * 2);
    expect(containsPosition(geometry, [1, 2, 3])).toBe(true);
    expect(containsPosition(geometry, [7, 8, 9])).toBe(true);
    expect(Array.from(geometry.nodePickIds ?? [])).toEqual([1, 2, 2, 1, 3]);
  });

  it("produces deterministic output on repeated calls", () => {
    const first = geometryFor(tet10Model(), "triangle");
    const second = geometryFor(tet10Model(), "triangle");
    expect(first.positions).toEqual(second.positions);
    expect(first.indices).toEqual(second.indices);
  });
});
