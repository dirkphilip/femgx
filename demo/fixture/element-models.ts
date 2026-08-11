import { createElement, type Element, type NodeId } from "../../src/elements/element";
import { createElementModel, type ElementModel } from "../../src/elements/model";
import {
  HEX20_SHAPE,
  HEX8_SHAPE,
  LINE3_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  QUAD_SHAPE,
  TRIANGLE_SHAPE,
  TET10_SHAPE,
  TET4_SHAPE,
} from "../../src/elements/shapes";

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
            midNode(builder, c2, c6),
            midNode(builder, c3, c7),
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
export function buildPointLineModel(
  gridSize: number,
  cellSize: number,
  lineKind: "all" | "linear" | "quadratic" = "all",
): ElementModel {
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
  elements.push(...outlineLineElements(at, gridSize, id, lineKind));

  return createElementModel(builder.positions, elements);
}

/** Builds a planar pair that demonstrates typed triangle and quad surfaces. */
export function buildSurfaceModel(): ElementModel {
  return createElementModel(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 2, 1, 0],
    [createElement(1, TRIANGLE_SHAPE, [0, 1, 2]), createElement(2, QUAD_SHAPE, [1, 3, 4, 2])],
  );
}

/** Optional dimensions for the curved Hex20 cylinder fixture. */
interface Hex20CylinderOptions {
  readonly sectors?: number;
  readonly radialCells?: number;
  readonly axialCells?: number;
  readonly innerRadius?: number;
  readonly outerRadius?: number;
  readonly height?: number;
}

/** Builds a small annular cylinder from conforming quadratic Hex20 elements. */
export function buildHex20CylinderModel(options: Hex20CylinderOptions = {}): ElementModel {
  const sectors = options.sectors ?? 12;
  const radialCells = options.radialCells ?? 2;
  const axialCells = options.axialCells ?? 3;
  const innerRadius = options.innerRadius ?? 0.2;
  const outerRadius = options.outerRadius ?? 1;
  const height = options.height ?? 1.8;
  const builder = new SharedNodeBuilder();
  const elements: Element[] = [];
  let id = 1;
  for (let layer = 0; layer < axialCells; layer += 1) {
    const z0 = (layer / axialCells - 0.5) * height;
    const z1 = ((layer + 1) / axialCells - 0.5) * height;
    for (let sector = 0; sector < sectors; sector += 1) {
      const nextSector = (sector + 1) % sectors;
      const angle0 = (sector / sectors) * Math.PI * 2;
      const angle1 = ((sector + 1) / sectors) * Math.PI * 2;
      for (let radial = 0; radial < radialCells; radial += 1) {
        const r0 = innerRadius + ((outerRadius - innerRadius) * radial) / radialCells;
        const r1 = innerRadius + ((outerRadius - innerRadius) * (radial + 1)) / radialCells;
        const corners = [
          cylinderNode(builder, layer, sector, radial, r0, angle0, z0),
          cylinderNode(builder, layer, sector, radial + 1, r1, angle0, z0),
          cylinderNode(builder, layer, nextSector, radial + 1, r1, angle1, z0),
          cylinderNode(builder, layer, nextSector, radial, r0, angle1, z0),
          cylinderNode(builder, layer + 1, sector, radial, r0, angle0, z1),
          cylinderNode(builder, layer + 1, sector, radial + 1, r1, angle0, z1),
          cylinderNode(builder, layer + 1, nextSector, radial + 1, r1, angle1, z1),
          cylinderNode(builder, layer + 1, nextSector, radial, r0, angle1, z1),
        ] as const;
        const midEdges = [
          cylinderNode(builder, layer, sector, radial + 0.5, (r0 + r1) / 2, angle0, z0),
          cylinderNode(builder, layer, sector + 0.5, radial + 1, r1, (angle0 + angle1) / 2, z0),
          cylinderNode(builder, layer, nextSector, radial + 0.5, (r0 + r1) / 2, angle1, z0),
          cylinderNode(builder, layer, sector + 0.5, radial, r0, (angle0 + angle1) / 2, z0),
          cylinderNode(builder, layer + 1, sector, radial + 0.5, (r0 + r1) / 2, angle0, z1),
          cylinderNode(builder, layer + 1, sector + 0.5, radial + 1, r1, (angle0 + angle1) / 2, z1),
          cylinderNode(builder, layer + 1, nextSector, radial + 0.5, (r0 + r1) / 2, angle1, z1),
          cylinderNode(builder, layer + 1, sector + 0.5, radial, r0, (angle0 + angle1) / 2, z1),
          cylinderNode(builder, layer + 0.5, sector, radial, r0, angle0, (z0 + z1) / 2),
          cylinderNode(builder, layer + 0.5, sector, radial + 1, r1, angle0, (z0 + z1) / 2),
          cylinderNode(builder, layer + 0.5, nextSector, radial + 1, r1, angle1, (z0 + z1) / 2),
          cylinderNode(builder, layer + 0.5, nextSector, radial, r0, angle1, (z0 + z1) / 2),
        ];
        elements.push(createElement(id, HEX20_SHAPE, [...corners, ...midEdges]));
        id += 1;
      }
    }
  }
  return createElementModel(builder.positions, elements);
}

function cylinderNode(
  builder: SharedNodeBuilder,
  ...values: [number, number, number, number, number, number]
): NodeId {
  const [layer, sector, radial, radius, angle, z] = values;
  const normalizedSector = sector < 0 ? sector + 100000 : sector;
  return builder.getOrCreate(`cylinder:${layer}:${normalizedSector}:${radial}`, [
    radius * Math.cos(angle),
    radius * Math.sin(angle),
    z,
  ]);
}

/** Line elements tracing the outer outline of one grid block. */
function outlineLineElements(
  at: (i: number, j: number, k: number) => NodeId,
  gridSize: number,
  startId: number,
  lineKind: "all" | "linear" | "quadratic",
): readonly Element[] {
  const elements: Element[] = [];
  let id = startId;
  const end = gridSize;
  if (lineKind !== "quadratic") {
    for (const [a, b] of blockEdgeSegments(end)) {
      elements.push(createElement(id, LINE_SHAPE, [at(a[0], a[1], a[2]), at(b[0], b[1], b[2])]));
      id += 1;
    }
  }
  if (lineKind !== "linear") {
    elements.push(createElement(id, LINE3_SHAPE, [at(0, 0, 0), at(end, end, end), at(0, 0, end)]));
  }
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
