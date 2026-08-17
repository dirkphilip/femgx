import { POINT_SHAPE, LINE_SHAPE, LINE3_SHAPE } from "../../../src/elements/shapes";

import type { GoldenElementConvention } from "./types";

export const pointLineConventions: readonly GoldenElementConvention[] = [
  {
    name: "point",
    shape: POINT_SHAPE,
    nodeCount: 1,
    corners: [0],
    edges: [],
    edgeNodes: [],
    reference: [[0, 0, 0]],
    faces: [],
    edgeSequences: [],
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
    volume: 0,
  },
  {
    name: "line",
    shape: LINE_SHAPE,
    nodeCount: 2,
    corners: [0, 1],
    edges: [[0, 1]],
    edgeNodes: [],
    reference: [
      [0, 0, 0],
      [1, 0, 0],
    ],
    faces: [],
    edgeSequences: [[0, 1]],
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0, maxZ: 0 },
    volume: 0,
  },
  {
    name: "line3",
    shape: LINE3_SHAPE,
    nodeCount: 3,
    corners: [0, 1],
    edges: [[0, 1]],
    edgeNodes: [2],
    reference: [
      [0, 0, 0],
      [1, 0, 0],
      [0.5, 0, 0],
    ],
    faces: [],
    edgeSequences: [[0, 2, 1]],
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0, maxZ: 0 },
    volume: 0,
  },
];
