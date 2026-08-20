import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { createElementModel } from "../../src/elements/model";
import {
  boundaryFaceRefs,
  boundaryFaceRefsForModel,
  classifyFaces,
  facesOf,
  faceRefsOf,
} from "../../src/elements/faces";
import { ElementShape, topologyFor, type ElementFamily } from "../../src/elements/shapes";

const sequentialElement = (id: number, shape: ElementShape) =>
  createElement(
    id,
    shape,
    Array.from({ length: topologyFor(shape).nodeCount }, (_, index) => index),
  );

const VOLUME_SHAPES: readonly ElementShape[] = [
  ElementShape.Tet4,
  ElementShape.Tet10,
  ElementShape.Wedge6,
  ElementShape.Pyramid5,
  ElementShape.Hex8,
  ElementShape.Hex20,
];

const CORNER_COORDS: Record<ElementFamily, ReadonlyArray<readonly [number, number, number]>> = {
  point: [],
  line: [],
  triangle: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  quad: [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ],
  tet: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  wedge: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
  ],
  pyramid: [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0.5, 0.5, 1],
  ],
  hex: [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ],
};

function coordinatesFor(shape: ElementShape): Map<number, [number, number, number]> {
  const topology = topologyFor(shape);
  const corners = CORNER_COORDS[topology.family];
  const coords = new Map<number, [number, number, number]>();
  for (const [position, cornerIndex] of topology.corners.entries()) {
    const corner = corners[cornerIndex];
    if (corner !== undefined) {
      coords.set(position, [...corner]);
    }
  }
  for (const [edgeIndex, [a, b]] of topology.edges.entries()) {
    if (topology.order < 2) {
      continue;
    }
    const midIndex = topology.edgeNodes[edgeIndex];
    const pa = corners[a];
    const pb = corners[b];
    if (midIndex !== undefined && pa !== undefined && pb !== undefined) {
      coords.set(midIndex, [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2]);
    }
  }
  return coords;
}

function normal(
  points: ReadonlyArray<readonly [number, number, number]>,
): [number, number, number] {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p0 = points[i];
    const p1 = points[(i + 1) % points.length];
    if (p0 === undefined || p1 === undefined) {
      continue;
    }
    const [x0, y0, z0] = p0;
    const [x1, y1, z1] = p1;
    nx += (y0 - y1) * (z0 + z1);
    ny += (z0 - z1) * (x0 + x1);
    nz += (x0 - x1) * (y0 + y1);
  }
  return [nx, ny, nz];
}

function centroid(
  points: ReadonlyArray<readonly [number, number, number]>,
): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [px, py, pz] of points) {
    x += px;
    y += py;
    z += pz;
  }
  const size = points.length;
  return [x / size, y / size, z / size];
}

function assertOutwardFaces(element: ReturnType<typeof sequentialElement>): void {
  const coords = coordinatesFor(element.shape);
  const allPoints = element.nodeIds.map((id) => coords.get(id) ?? ([0, 0, 0] as const));
  const center = centroid(allPoints);
  for (const face of facesOf(element)) {
    const points = face.nodeIds.map((id) => coords.get(id) ?? ([0, 0, 0] as const));
    const faceNormal = normal(points);
    const faceCenter = centroid(points);
    const dot =
      faceNormal[0] * (faceCenter[0] - center[0]) +
      faceNormal[1] * (faceCenter[1] - center[1]) +
      faceNormal[2] * (faceCenter[2] - center[2]);
    expect(dot, `face ${face.key} should wind outward`).toBeGreaterThan(0);
  }
}

describe("facesOf", () => {
  it("preserves the element's node identityMatrix, not connectivity positions", () => {
    const element = createElement(1, ElementShape.Tet4, [10, 20, 30, 40]);
    expect(facesOf(element).map((face) => face.nodeIds)).toEqual([
      [10, 20, 40],
      [20, 30, 40],
      [30, 10, 40],
      [10, 30, 20],
    ]);
  });

  it("assigns a unique canonical key to every face of a single element", () => {
    for (const shape of VOLUME_SHAPES) {
      const faces = facesOf(sequentialElement(1, shape));
      expect(new Set(faces.map((face) => face.key)).size).toBe(faces.length);
    }
  });

  it("is deterministic across repeated calls", () => {
    const element = sequentialElement(1, ElementShape.Hex20);
    expect(facesOf(element)).toEqual(facesOf(element));
  });

  it("winds every face outward for each volume shape", () => {
    for (const shape of VOLUME_SHAPES) {
      assertOutwardFaces(sequentialElement(1, shape));
    }
  });
});

describe("faceRefsOf", () => {
  it("pairs every face with a stable element-scoped index", () => {
    const element = sequentialElement(7, ElementShape.Tet4);
    const refs = faceRefsOf(element);
    expect(refs).toHaveLength(4);
    refs.forEach((ref, index) => {
      expect(ref.elementId).toBe(7);
      expect(ref.faceIndex).toBe(index);
      expect(ref.face).toEqual(facesOf(element)[index]);
    });
  });
});

describe("classifyFaces", () => {
  it("flags every face of a lone Tet4 as boundary", () => {
    const classified = classifyFaces([sequentialElement(1, ElementShape.Tet4)]);
    expect(classified).toHaveLength(4);
    for (const face of classified) {
      expect(face.elementId).toBe(1);
      expect(face.count).toBe(1);
      expect(face.boundary).toBe(true);
    }
  });

  it("marks a face shared by two tets as interior", () => {
    const a = createElement(1, ElementShape.Tet4, [0, 1, 2, 3]);
    const b = createElement(2, ElementShape.Tet4, [0, 1, 2, 4]);
    const classified = classifyFaces([a, b]);
    const shared = classified.filter((face) => face.key === "0,1,2");
    expect(shared).toHaveLength(2);
    for (const face of shared) {
      expect(face.count).toBe(2);
      expect(face.boundary).toBe(false);
    }
    expect(classified.filter((face) => face.boundary)).toHaveLength(6);
  });

  it("marks a face shared by two hexahedra as interior with reversed windings", () => {
    const a = createElement(1, ElementShape.Hex8, [0, 1, 2, 3, 4, 5, 6, 7]);
    const b = createElement(2, ElementShape.Hex8, [8, 9, 10, 11, 0, 1, 2, 3]);
    const classified = classifyFaces([a, b]);
    const shared = classified.filter((face) => face.key === "0,1,2,3");
    expect(shared).toHaveLength(2);
    expect(shared.map((face) => face.nodeIds)).toEqual([
      [0, 3, 2, 1],
      [0, 1, 2, 3],
    ]);
    for (const face of shared) {
      expect(face.boundary).toBe(false);
    }
  });

  it("matches a Wedge6 quadrilateral face with a Pyramid5 base", () => {
    const wedge = createElement(1, ElementShape.Wedge6, [0, 1, 2, 3, 4, 5]);
    const pyramid = createElement(2, ElementShape.Pyramid5, [0, 1, 4, 3, 6]);
    const classified = classifyFaces([wedge, pyramid]);
    const shared = classified.filter((face) => face.key === "0,1,3,4");
    expect(shared).toHaveLength(2);
    expect(shared.map((face) => face.nodeIds)).toEqual([
      [0, 1, 4, 3],
      [0, 3, 4, 1],
    ]);
    expect(shared.every((face) => !face.boundary && face.count === 2)).toBe(true);
  });

  it("marks a quadratic face shared by two Tet10 elements as interior", () => {
    const a = createElement(1, ElementShape.Tet10, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const b = createElement(2, ElementShape.Tet10, [0, 1, 2, 10, 4, 5, 6, 11, 12, 13]);
    const classified = classifyFaces([a, b]);
    const shared = classified.filter((face) => face.key === "0,1,2,4,5,6");
    expect(shared).toHaveLength(2);
    for (const face of shared) {
      expect(face.count).toBe(2);
      expect(face.boundary).toBe(false);
    }
  });

  it("marks a quadratic face shared by two Hex20 elements as interior", () => {
    const a = createElement(
      1,
      ElementShape.Hex20,
      Array.from({ length: 20 }, (_, index) => index),
    );
    const b = createElement(
      2,
      ElementShape.Hex20,
      [0, 1, 2, 3, 12, 13, 14, 15, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22, 23],
    );
    const classified = classifyFaces([a, b]);
    const shared = classified.filter((face) => face.key === "0,1,2,3,8,9,10,11");
    expect(shared).toHaveLength(2);
    for (const face of shared) {
      expect(face.count).toBe(2);
      expect(face.boundary).toBe(false);
    }
  });

  it("follows the input element order deterministically", () => {
    const a = createElement(1, ElementShape.Tet4, [0, 1, 2, 3]);
    const b = createElement(2, ElementShape.Tet4, [0, 1, 2, 4]);
    const forward = classifyFaces([a, b]);
    const reversed = classifyFaces([b, a]);
    expect(forward.map((face) => face.elementId)).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
    expect(reversed.map((face) => face.elementId)).toEqual([2, 2, 2, 2, 1, 1, 1, 1]);
    const forwardCounts = new Map(forward.map((face) => [face.key, face.count]));
    for (const face of reversed) {
      expect(face.count).toBe(forwardCounts.get(face.key));
    }
  });

  it("returns an empty classification for no elements", () => {
    expect(classifyFaces([])).toEqual([]);
  });
});

describe("boundaryFaceRefsForModel", () => {
  it("matches descriptor boundary identities in authored row and face order", () => {
    const elements = [
      createElement(9, ElementShape.Tet4, [0, 1, 2, 3]),
      createElement(4, ElementShape.Tet4, [0, 1, 2, 4]),
    ];
    const model = createElementModel(new Float32Array(5 * 3), elements);
    expect(boundaryFaceRefsForModel(model)).toEqual(boundaryFaceRefs(elements));
  });
});
