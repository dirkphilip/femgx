import { createElement, type Element, type NodeId } from "../elements/element";
import { createElementModel, type ElementModel } from "../elements/model";
import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
} from "../elements/shapes";

/**
 * Deterministic element-model builders for the fixture: shared-node hex and tet
 * grids plus a point/line outline, all conforming so mid-edge nodes align
 * across elements. Internal to the fixture subsystem; not part of the public
 * API.
 */

/** Shared-node builder for conforming corner and mid-edge node ids. */
class SharedNodeBuilder {
  readonly positions: number[] = [];
  private readonly byKey = new Map<string, NodeId>();

  getOrCreate(key: string, position: readonly [number, number, number]): NodeId {
    const existing = this.byKey.get(key);
    if (existing !== undefined) return existing;
    const id = this.positions.length / 3;
    this.byKey.set(key, id);
    this.positions.push(position[0], position[1], position[2]);
    return id;
  }
}

function corner(
  builder: SharedNodeBuilder,
  i: number,
  j: number,
  k: number,
  cellSize: number,
): NodeId {
  return builder.getOrCreate(`c:${i}:${j}:${k}`, [i * cellSize, j * cellSize, k * cellSize]);
}

function midNode(builder: SharedNodeBuilder, a: NodeId, b: NodeId): NodeId {
  const [ax, ay, az] = nodePosition(builder, a);
  const [bx, by, bz] = nodePosition(builder, b);
  return builder.getOrCreate(`m:${Math.min(a, b)}:${Math.max(a, b)}`, [
    (ax + bx) / 2,
    (ay + by) / 2,
    (az + bz) / 2,
  ]);
}

function nodePosition(
  builder: SharedNodeBuilder,
  nodeId: NodeId,
): readonly [number, number, number] {
  return [
    builder.positions[nodeId * 3] ?? 0,
    builder.positions[nodeId * 3 + 1] ?? 0,
    builder.positions[nodeId * 3 + 2] ?? 0,
  ];
}

type HexCell = readonly [NodeId, NodeId, NodeId, NodeId, NodeId, NodeId, NodeId, NodeId];

/** Returns the eight corner node ids of the hex cell at grid position. */
function hexCellCorners(
  builder: SharedNodeBuilder,
  i: number,
  j: number,
  k: number,
  cellSize: number,
): HexCell {
  return [
    corner(builder, i, j, k, cellSize),
    corner(builder, i + 1, j, k, cellSize),
    corner(builder, i + 1, j + 1, k, cellSize),
    corner(builder, i, j + 1, k, cellSize),
    corner(builder, i, j, k + 1, cellSize),
    corner(builder, i + 1, j, k + 1, cellSize),
    corner(builder, i + 1, j + 1, k + 1, cellSize),
    corner(builder, i, j + 1, k + 1, cellSize),
  ];
}

/** Builds a conforming hex grid, with mid-edge nodes when quadratic. */
export function buildHexModel(
  gridSize: number,
  cellSize: number,
  quadratic: boolean,
): ElementModel {
  const builder = new SharedNodeBuilder();
  const elements: Element[] = [];
  let id = 1;
  for (let i = 0; i < gridSize; i += 1) {
    for (let j = 0; j < gridSize; j += 1) {
      for (let k = 0; k < gridSize; k += 1) {
        const [c0, c1, c2, c3, c4, c5, c6, c7] = hexCellCorners(builder, i, j, k, cellSize);
        if (!quadratic) {
          elements.push(createElement(id, HEX8_SHAPE, [c0, c1, c2, c3, c4, c5, c6, c7]));
        } else {
          const midEdges = [
            midNode(builder, c0, c1),
            midNode(builder, c1, c2),
            midNode(builder, c2, c3),
            midNode(builder, c3, c0),
            midNode(builder, c4, c5),
            midNode(builder, c5, c6),
            midNode(builder, c6, c7),
            midNode(builder, c7, c4),
            midNode(builder, c0, c4),
            midNode(builder, c1, c5),
            midNode(builder, c3, c7),
            midNode(builder, c2, c6),
          ];
          elements.push(
            createElement(id, HEX20_SHAPE, [c0, c1, c2, c3, c4, c5, c6, c7, ...midEdges]),
          );
        }
        id += 1;
      }
    }
  }
  return createElementModel(builder.positions, elements);
}

/** Local tet corner templates splitting one hex cell into six tets. */
const TET_TEMPLATES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 1, 6, 4],
  [0, 4, 6, 7],
  [0, 3, 6, 7],
  [1, 4, 5, 6],
];

/** Builds a tet grid by splitting each hex cell into six tets. */
export function buildTetModel(
  gridSize: number,
  cellSize: number,
  quadratic: boolean,
): ElementModel {
  const builder = new SharedNodeBuilder();
  const elements: Element[] = [];
  let id = 1;
  for (let i = 0; i < gridSize; i += 1) {
    for (let j = 0; j < gridSize; j += 1) {
      for (let k = 0; k < gridSize; k += 1) {
        const cell = hexCellCorners(builder, i, j, k, cellSize);
        const cellElements = buildCellTets(builder, cell, quadratic, id);
        elements.push(...cellElements);
        id += cellElements.length;
      }
    }
  }
  return createElementModel(builder.positions, elements);
}

/** Splits one hex cell into six conforming tets, linear or quadratic. */
function buildCellTets(
  builder: SharedNodeBuilder,
  cell: HexCell,
  quadratic: boolean,
  startId: number,
): readonly Element[] {
  const elements: Element[] = [];
  let id = startId;
  for (const template of TET_TEMPLATES) {
    const tetCorners: [NodeId, NodeId, NodeId, NodeId] = [
      cell[template[0]] as NodeId,
      cell[template[1]] as NodeId,
      cell[template[2]] as NodeId,
      cell[template[3]] as NodeId,
    ];
    if (!quadratic) {
      elements.push(createElement(id, TET4_SHAPE, tetCorners));
    } else {
      const [a, b, c, d] = tetCorners;
      const midEdges = [
        midNode(builder, a, b),
        midNode(builder, b, c),
        midNode(builder, c, a),
        midNode(builder, a, d),
        midNode(builder, b, d),
        midNode(builder, c, d),
      ];
      elements.push(createElement(id, TET10_SHAPE, [a, b, c, d, ...midEdges]));
    }
    id += 1;
  }
  return elements;
}

/** Point and line elements tracing the outer outline of one grid block. */
export function buildPointLineModel(gridSize: number, cellSize: number): ElementModel {
  const builder = new SharedNodeBuilder();
  const count = gridSize + 1;
  const cornerIds: NodeId[] = [];
  for (let i = 0; i <= gridSize; i += 1) {
    for (let j = 0; j <= gridSize; j += 1) {
      for (let k = 0; k <= gridSize; k += 1) {
        cornerIds.push(
          builder.getOrCreate(`c:${i}:${j}:${k}`, [i * cellSize, j * cellSize, k * cellSize]),
        );
      }
    }
  }
  const at = (i: number, j: number, k: number): NodeId => {
    const index = (i * count + j) * count + k;
    return cornerIds[index] as NodeId;
  };

  const elements: Element[] = [];
  let id = 1;
  for (let i = 0; i <= gridSize; i += 1) {
    for (let j = 0; j <= gridSize; j += 1) {
      for (let k = 0; k <= gridSize; k += 1) {
        elements.push(createElement(id, POINT_SHAPE, [at(i, j, k)]));
        id += 1;
      }
    }
  }
  elements.push(...outlineLineElements(at, gridSize, id));

  return createElementModel(builder.positions, elements);
}

/** Line elements tracing the outer outline of one grid block. */
function outlineLineElements(
  at: (i: number, j: number, k: number) => NodeId,
  gridSize: number,
  startId: number,
): readonly Element[] {
  const elements: Element[] = [];
  let id = startId;
  const end = gridSize;
  for (const [a, b] of blockEdgeSegments(end)) {
    elements.push(createElement(id, LINE_SHAPE, [at(a[0], a[1], a[2]), at(b[0], b[1], b[2])]));
    id += 1;
  }
  elements.push(createElement(id, LINE3_SHAPE, [at(0, 0, 0), at(end, end, end), at(0, 0, end)]));
  return elements;
}

/** Grid segments tracing the block outline on its two end planes and four corners. */
function blockEdgeSegments(
  gridSize: number,
): ReadonlyArray<readonly [readonly [number, number, number], readonly [number, number, number]]> {
  const end = gridSize;
  const blockEdges: Array<
    readonly [readonly [number, number, number], readonly [number, number, number]]
  > = [];
  for (const k of [0, end]) {
    for (let j = 0; j <= end; j += 1) {
      for (let i = 0; i < end; i += 1) {
        blockEdges.push([
          [i, j, k],
          [i + 1, j, k],
        ]);
      }
    }
    for (let i = 0; i <= end; i += 1) {
      for (let j = 0; j < end; j += 1) {
        blockEdges.push([
          [i, j, k],
          [i, j + 1, k],
        ]);
      }
    }
  }
  for (const [i, j] of blockCorners(end)) {
    blockEdges.push([
      [i, j, 0],
      [i, j, end],
    ]);
  }
  return blockEdges;
}

function blockCorners(gridSize: number): ReadonlyArray<readonly [number, number]> {
  const corners: Array<readonly [number, number]> = [];
  for (const i of [0, gridSize]) {
    for (const j of [0, gridSize]) {
      corners.push([i, j]);
    }
  }
  return corners;
}
