import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { classifyFaces, facesOf, facesOfElement } from "../../src/elements/faces";
import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
  topologyFor,
  type ElementFamily,
  type ElementShape,
} from "../../src/elements/shapes";

const sequentialElement = (id: number, shape: ElementShape) =>
  createElement(
    id,
    shape,
    Array.from({ length: topologyFor(shape).nodeCount }, (_, index) => index),
  );

const VOLUME_SHAPES: readonly ElementShape[] = [TET4_SHAPE, TET10_SHAPE, HEX8_SHAPE, HEX20_SHAPE];

const CORNER_COORDS: Record<ElementFamily, ReadonlyArray<readonly [number, number, number]>> = {
  point: [],
  line: [],
  tet: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
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
  const corners = CORNER_COORDS[shape.family];
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
  it("extracts four outward-oriented triangular faces from a Tet4", () => {
    expect(facesOf(sequentialElement(1, TET4_SHAPE)).map((face) => face.nodeIds)).toEqual([
      [0, 1, 3],
      [1, 2, 3],
      [2, 0, 3],
      [0, 2, 1],
    ]);
  });

  it("extracts six outward-oriented quad faces from a Hex8", () => {
    expect(facesOf(sequentialElement(1, HEX8_SHAPE)).map((face) => face.nodeIds)).toEqual([
      [0, 4, 7, 3],
      [1, 2, 6, 5],
      [0, 1, 5, 4],
      [3, 7, 6, 2],
      [0, 3, 2, 1],
      [4, 5, 6, 7],
    ]);
  });

  it("interleaves mid-edge nodes into Tet10 faces", () => {
    expect(facesOf(sequentialElement(1, TET10_SHAPE)).map((face) => face.nodeIds)).toEqual([
      [0, 4, 1, 8, 3, 7],
      [1, 5, 2, 9, 3, 8],
      [2, 6, 0, 7, 3, 9],
      [0, 6, 2, 5, 1, 4],
    ]);
  });

  it("interleaves mid-edge nodes into Hex20 faces", () => {
    expect(facesOf(sequentialElement(1, HEX20_SHAPE)).map((face) => face.nodeIds)).toEqual([
      [0, 16, 4, 15, 7, 19, 3, 11],
      [1, 9, 2, 18, 6, 13, 5, 17],
      [0, 8, 1, 17, 5, 12, 4, 16],
      [3, 19, 7, 14, 6, 18, 2, 10],
      [0, 11, 3, 10, 2, 9, 1, 8],
      [4, 12, 5, 13, 6, 14, 7, 15],
    ]);
  });

  it("has no faces for point and line elements", () => {
    expect(facesOf(createElement(1, POINT_SHAPE, [0]))).toEqual([]);
    expect(facesOf(createElement(1, LINE_SHAPE, [0, 1]))).toEqual([]);
    expect(facesOf(createElement(1, LINE3_SHAPE, [0, 1, 2]))).toEqual([]);
  });

  it("preserves the element's node identity, not connectivity positions", () => {
    const element = createElement(1, TET4_SHAPE, [10, 20, 30, 40]);
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
    const element = sequentialElement(1, HEX20_SHAPE);
    expect(facesOf(element)).toEqual(facesOf(element));
  });

  it("winds every face outward for each volume shape", () => {
    for (const shape of VOLUME_SHAPES) {
      assertOutwardFaces(sequentialElement(1, shape));
    }
  });
});

describe("facesOfElement", () => {
  it("pairs every face with a stable element-scoped index", () => {
    const element = sequentialElement(7, TET4_SHAPE);
    const refs = facesOfElement(element);
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
    const classified = classifyFaces([sequentialElement(1, TET4_SHAPE)]);
    expect(classified).toHaveLength(4);
    for (const face of classified) {
      expect(face.elementId).toBe(1);
      expect(face.count).toBe(1);
      expect(face.boundary).toBe(true);
    }
  });

  it("marks a face shared by two tets as interior", () => {
    const a = createElement(1, TET4_SHAPE, [0, 1, 2, 3]);
    const b = createElement(2, TET4_SHAPE, [0, 1, 2, 4]);
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
    const a = createElement(1, HEX8_SHAPE, [0, 1, 2, 3, 4, 5, 6, 7]);
    const b = createElement(2, HEX8_SHAPE, [8, 9, 10, 11, 0, 1, 2, 3]);
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

  it("marks a quadratic face shared by two Tet10 elements as interior", () => {
    const a = createElement(1, TET10_SHAPE, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const b = createElement(2, TET10_SHAPE, [0, 1, 2, 10, 4, 5, 6, 11, 12, 13]);
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
      HEX20_SHAPE,
      Array.from({ length: 20 }, (_, index) => index),
    );
    const b = createElement(
      2,
      HEX20_SHAPE,
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
    const a = createElement(1, TET4_SHAPE, [0, 1, 2, 3]);
    const b = createElement(2, TET4_SHAPE, [0, 1, 2, 4]);
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
