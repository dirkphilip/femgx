import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { edgesOf } from "../../src/elements/edges";
import { facesOf } from "../../src/elements/faces";
import { topologyFor } from "../../src/elements/shapes";
import { computeBounds, type Geometry } from "../../src/geometry/part";
import { transformPoint, translationMatrix } from "../../src/math/mat4";
import { GOLDEN_ELEMENT_CONVENTIONS, type GoldenElementConvention } from "./golden";

function sequentialElement(convention: GoldenElementConvention) {
  return createElement(
    1,
    convention.shape,
    Array.from({ length: convention.nodeCount }, (_, index) => index),
  );
}

function referenceGeometry(convention: GoldenElementConvention): Geometry {
  const positions = new Float32Array(convention.reference.length * 3);
  convention.reference.forEach((point, index) => {
    positions[index * 3] = point[0];
    positions[index * 3 + 1] = point[1];
    positions[index * 3 + 2] = point[2];
  });
  return { positions, indices: new Uint32Array(), primitive: "triangles" as const };
}

function pointAt(
  convention: GoldenElementConvention,
  index: number,
): readonly [number, number, number] {
  const point = convention.reference[index];
  if (point === undefined) {
    throw new Error(`Reference coordinate ${index} is missing for ${convention.name}`);
  }
  return point;
}

function tripleProduct(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
): number {
  return (
    a[0] * (b[1] * c[2] - b[2] * c[1]) +
    a[1] * (b[2] * c[0] - b[0] * c[2]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
  );
}

/** Signed volume of a closed triangle mesh via the divergence theorem. */
function signedVolume(convention: GoldenElementConvention): number {
  let volume = 0;
  for (const face of convention.faces) {
    const a = pointAt(convention, face[0] ?? 0);
    for (let i = 1; i + 1 < face.length; i += 1) {
      const b = pointAt(convention, face[i] ?? 0);
      const c = pointAt(convention, face[i + 1] ?? 0);
      volume += tripleProduct(a, b, c);
    }
  }
  return volume / 6;
}

const MID_EDGE_CONVENTIONS = GOLDEN_ELEMENT_CONVENTIONS.filter(
  (convention) => convention.edgeNodes.length > 0,
);

describe("golden element conventions", () => {
  it.each(GOLDEN_ELEMENT_CONVENTIONS)(
    "topologyFor reports the documented node ordering for $name",
    (convention) => {
      const topology = topologyFor(convention.shape);
      expect(topology.nodeCount).toBe(convention.nodeCount);
      expect(topology.corners).toEqual(convention.corners);
      expect(topology.edges).toEqual(convention.edges);
      expect(topology.edgeNodes).toEqual(convention.edgeNodes);
    },
  );

  it.each(GOLDEN_ELEMENT_CONVENTIONS)(
    "facesOf extracts the documented face loops for $name",
    (convention) => {
      expect(facesOf(sequentialElement(convention)).map((face) => face.nodeIds)).toEqual(
        convention.faces,
      );
    },
  );

  it.each(GOLDEN_ELEMENT_CONVENTIONS)(
    "edgesOf extracts the documented edge sequences for $name",
    (convention) => {
      expect(edgesOf(sequentialElement(convention)).map((edge) => edge.nodeIds)).toEqual(
        convention.edgeSequences,
      );
    },
  );

  it.each(GOLDEN_ELEMENT_CONVENTIONS)(
    "the reference geometry has the documented bounds for $name",
    (convention) => {
      expect(computeBounds(referenceGeometry(convention))).toEqual(convention.bounds);
    },
  );

  it.each(GOLDEN_ELEMENT_CONVENTIONS.filter((convention) => convention.faces.length > 0))(
    "the reference faces enclose the documented volume for $name",
    (convention) => {
      expect(signedVolume(convention)).toBeCloseTo(convention.volume, 10);
    },
  );

  it.each(
    GOLDEN_ELEMENT_CONVENTIONS.filter(
      (convention) => convention.volume === 0 && convention.faces.length === 0,
    ),
  )("point and line shapes enclose no volume for $name", (convention) => {
    expect(convention.faces).toEqual([]);
    expect(signedVolume(convention)).toBe(0);
  });

  it.each(MID_EDGE_CONVENTIONS)(
    "mid-edge nodes lie exactly at the edge midpoints for $name",
    (convention) => {
      convention.edges.forEach(([a, b], edgeIndex) => {
        const midIndex = convention.edgeNodes[edgeIndex];
        if (midIndex === undefined) {
          throw new Error(`Missing mid-edge node for edge ${edgeIndex} of ${convention.name}`);
        }
        const pa = pointAt(convention, a);
        const pb = pointAt(convention, b);
        const mid = pointAt(convention, midIndex);
        expect(mid[0]).toBeCloseTo((pa[0] + pb[0]) / 2, 10);
        expect(mid[1]).toBeCloseTo((pa[1] + pb[1]) / 2, 10);
        expect(mid[2]).toBeCloseTo((pa[2] + pb[2]) / 2, 10);
      });
    },
  );
});

describe("golden element transforms", () => {
  it.each(GOLDEN_ELEMENT_CONVENTIONS)(
    "translating the reference geometry moves its bounds for $name",
    (convention) => {
      const offset = [10, -3, 4] as const;
      const translated = new Float32Array(convention.reference.length * 3);
      convention.reference.forEach((point, index) => {
        const [x, y, z] = transformPoint(
          translationMatrix(offset[0], offset[1], offset[2]),
          ...point,
        );
        translated[index * 3] = x;
        translated[index * 3 + 1] = y;
        translated[index * 3 + 2] = z;
      });
      const bounds = computeBounds({
        positions: translated,
        indices: new Uint32Array(),
        primitive: "triangles",
      });
      expect(bounds.minX).toBeCloseTo(convention.bounds.minX + offset[0], 6);
      expect(bounds.minY).toBeCloseTo(convention.bounds.minY + offset[1], 6);
      expect(bounds.minZ).toBeCloseTo(convention.bounds.minZ + offset[2], 6);
      expect(bounds.maxX).toBeCloseTo(convention.bounds.maxX + offset[0], 6);
      expect(bounds.maxY).toBeCloseTo(convention.bounds.maxY + offset[1], 6);
      expect(bounds.maxZ).toBeCloseTo(convention.bounds.maxZ + offset[2], 6);
    },
  );
});
