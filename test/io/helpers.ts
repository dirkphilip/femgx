import { expect } from "vitest";
import { topologyFor, type ElementFamily, type ElementShape } from "../../src/elements/shapes";
import { createModelBuilder } from "../../src/io/build";
import type { FemModel, ModelElementBlock } from "../../src/io/model";

/**
 * Asserts that a possibly-undefined value is defined and narrows its type, so
 * tests can avoid non-null assertions (which the lint gate forbids).
 */
export function required<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}

/** Bounds-checked read so the strict indexing settings need no non-null assertions. */
function read<T>(items: ArrayLike<T>, index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Missing item at index ${index} of ${items.length}`);
  }
  return item;
}

type Point = readonly [number, number, number];

/** Reference corner coordinates per family: a unit hex, tet, or line. */
const CORNER_COORDS: ReadonlyMap<ElementFamily, ReadonlyArray<Point>> = new Map([
  [
    "hex",
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  ],
  [
    "tet",
    [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
  ],
  [
    "line",
    [
      [0, 0, 0],
      [1, 0, 0],
    ],
  ],
  ["point", [[0, 0, 0]]],
]);

/**
 * Coordinates for a shape in canonical node order: corners on a unit element
 * and every mid-edge node exactly on its canonical edge's midpoint, so each
 * slot's geometric placement is unambiguous.
 */
export function canonicalElementCoordinates(shape: ElementShape): Float64Array {
  const topology = topologyFor(shape);
  const corners = CORNER_COORDS.get(shape.family);
  if (corners === undefined) {
    throw new Error(`No reference corners for family ${shape.family}`);
  }
  const coords = new Float64Array(topology.nodeCount * 3);
  for (let corner = 0; corner < topology.corners.length; corner += 1) {
    const point = read(corners, corner);
    const slot = read(topology.corners, corner);
    coords[3 * slot] = point[0];
    coords[3 * slot + 1] = point[1];
    coords[3 * slot + 2] = point[2];
  }
  for (let edge = 0; edge < topology.edges.length; edge += 1) {
    const [a, b] = read(topology.edges, edge);
    const pa = read(corners, a);
    const pb = read(corners, b);
    const slot = read(topology.edgeNodes, edge);
    coords[3 * slot] = (pa[0] + pb[0]) / 2;
    coords[3 * slot + 1] = (pa[1] + pb[1]) / 2;
    coords[3 * slot + 2] = (pa[2] + pb[2]) / 2;
  }
  return coords;
}

/** Asserts that every mid-edge node of `block` sits on its canonical edge's midpoint. */
export function expectMidEdgePlacement(
  block: ModelElementBlock,
  coordsOf: (id: number) => Point,
): void {
  const topology = topologyFor(block.shape);
  for (let edge = 0; edge < topology.edges.length; edge += 1) {
    const [a, b] = read(topology.edges, edge);
    const cornerA = coordsOf(read(block.connectivity, read(topology.corners, a)));
    const cornerB = coordsOf(read(block.connectivity, read(topology.corners, b)));
    const mid = coordsOf(read(block.connectivity, read(topology.edgeNodes, edge)));
    expect(mid[0]).toBeCloseTo((cornerA[0] + cornerB[0]) / 2, 12);
    expect(mid[1]).toBeCloseTo((cornerA[1] + cornerB[1]) / 2, 12);
    expect(mid[2]).toBeCloseTo((cornerA[2] + cornerB[2]) / 2, 12);
  }
}

/** Returns a coordinate lookup by node id for a parsed/written model. */
export function coordsOfModel(model: FemModel): (id: number) => Point {
  const coords = model.nodes.coordinates;
  const indexOf = new Map<number, number>();
  model.nodes.ids.forEach((id, index) => {
    indexOf.set(id, index);
  });
  return (id) => {
    const index = indexOf.get(id) ?? 0;
    return [read(coords, 3 * index), read(coords, 3 * index + 1), read(coords, 3 * index + 2)];
  };
}

/** Returns a single-element canonical-order model plus a coordinate lookup by node id. */
export function canonicalElementModel(
  shape: ElementShape,
  elementId = 1,
): {
  readonly model: FemModel;
  readonly coordsOf: (id: number) => Point;
} {
  const topology = topologyFor(shape);
  const ids = new Uint32Array(topology.nodeCount);
  const connectivity = new Uint32Array(topology.nodeCount);
  for (let slot = 0; slot < topology.nodeCount; slot += 1) {
    ids[slot] = slot;
    connectivity[slot] = slot;
  }
  const coordinates = canonicalElementCoordinates(shape);
  const builder = createModelBuilder();
  builder.appendNodes(ids, coordinates);
  builder.openElementBlock(shape);
  builder.appendElements([elementId], connectivity);
  return {
    model: builder.build(),
    coordsOf: (id) => [
      read(coordinates, 3 * id),
      read(coordinates, 3 * id + 1),
      read(coordinates, 3 * id + 2),
    ],
  };
}
