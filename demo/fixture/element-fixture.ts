import {
  createElementModel,
  createScene,
  elementPart,
  polygonPart,
  translation,
  type AssemblyId,
  type ElementModel,
  type Part,
  type PartId,
  type Scene,
} from "../../src/index";
import {
  buildHex20CylinderModel,
  buildHexModel,
  buildPointLineModel,
  buildPyramid5Model,
  buildQuadModel,
  buildQuad8Model,
  buildTriangleModel,
  buildTri6Model,
  buildTetModel,
  buildWedge6Model,
} from "./element-models";

/** Stable part identifiers for the helper and generic mapping examples. */
export interface ElementFixtureParts {
  readonly point: PartId;
  readonly line: PartId;
  readonly line3: PartId;
  readonly triangle: PartId;
  readonly tri6: PartId;
  readonly quad: PartId;
  readonly quad8: PartId;
  readonly generic: PartId;
  readonly tet4: PartId;
  readonly tet10: PartId;
  readonly hex8: PartId;
  readonly hex20: PartId;
  readonly wedge6: PartId;
  readonly pyramid5: PartId;
}

/** Tuning knobs for the deterministic element gallery. */
export interface ElementFixtureOptions {
  /** Hex elements along each axis of the volume grids (default `2`). */
  readonly gridSize?: number;
  /** Edge length of one element in model units (default `1`). */
  readonly cellSize?: number;
}

/** A deterministic gallery of built-in topology helpers and one generic mapping. */
export interface ElementFixture {
  readonly scene: Scene;
  readonly partIds: ElementFixtureParts;
  readonly elementModels: ReadonlyMap<PartId, ElementModel>;
  readonly instanceCount: number;
}

const POINT_PART_ID: PartId = 1;
const LINE_PART_ID: PartId = 2;
const LINE3_PART_ID: PartId = 3;
const TRIANGLE_PART_ID: PartId = 8;
const QUAD_PART_ID: PartId = 9;
const GENERIC_PART_ID: PartId = 10;
const TRI6_PART_ID: PartId = 11;
const QUAD8_PART_ID: PartId = 12;
const TET4_PART_ID: PartId = 4;
const TET10_PART_ID: PartId = 5;
const HEX8_PART_ID: PartId = 6;
const HEX20_PART_ID: PartId = 7;
const WEDGE6_PART_ID: PartId = 13;
const PYRAMID5_PART_ID: PartId = 14;
const ROOT_ASSEMBLY_ID: AssemblyId = 1;
const GAP = 1;

interface GalleryPlacement {
  readonly partId: PartId;
  readonly column: number;
  readonly row: number;
}

const GALLERY_LAYOUT: readonly GalleryPlacement[] = [
  { partId: POINT_PART_ID, column: 0, row: 0 },
  { partId: LINE_PART_ID, column: 1, row: 0 },
  { partId: LINE3_PART_ID, column: 2, row: 0 },
  { partId: TRIANGLE_PART_ID, column: 3, row: 0 },
  { partId: QUAD_PART_ID, column: 4, row: 0 },
  { partId: TRI6_PART_ID, column: 5, row: 0 },
  { partId: GENERIC_PART_ID, column: 0, row: 1 },
  { partId: TET4_PART_ID, column: 1, row: 1 },
  { partId: TET10_PART_ID, column: 2, row: 1 },
  { partId: HEX8_PART_ID, column: 3, row: 1 },
  { partId: HEX20_PART_ID, column: 4, row: 1 },
  { partId: QUAD8_PART_ID, column: 5, row: 1 },
  { partId: WEDGE6_PART_ID, column: 1, row: 2 },
  { partId: PYRAMID5_PART_ID, column: 2, row: 2 },
];

const SINGLE_PART_LAYOUT: readonly GalleryPlacement[] = [
  { partId: HEX20_PART_ID, column: 0, row: 0 },
];

/** Builds the gallery with built-in helpers and a generic solver-mapped element. */
export function createElementFixture(options: ElementFixtureOptions = {}): ElementFixture {
  const gridSize = options.gridSize ?? 2;
  const cellSize = options.cellSize ?? 1;
  validateFixtureOptions(gridSize, cellSize);

  const blockSize = gridSize * cellSize;
  const pointLineModel = buildPointLineModel(gridSize, cellSize);
  const lineModel = buildPointLineModel(gridSize, cellSize, "linear");
  const line3Model = buildPointLineModel(gridSize, cellSize, "quadratic");
  const tet4Model = buildTetModel(gridSize, cellSize, false);
  const tet10Model = buildTetModel(gridSize, cellSize, true);
  const hex8Model = buildHexModel(gridSize, cellSize, false);
  const hex20Model = buildHexModel(gridSize, cellSize, true);
  const wedge6Model = buildWedge6Model();
  const pyramid5Model = buildPyramid5Model();
  const triangleModel = buildTriangleModel();
  const tri6Model = buildTri6Model();
  const quadModel = buildQuadModel();
  const quad8Model = buildQuad8Model();
  const models = new Map<PartId, ElementModel>([
    [POINT_PART_ID, pointLineModel],
    [LINE_PART_ID, lineModel],
    [LINE3_PART_ID, line3Model],
    [TET4_PART_ID, tet4Model],
    [TET10_PART_ID, tet10Model],
    [HEX8_PART_ID, hex8Model],
    [HEX20_PART_ID, hex20Model],
    [WEDGE6_PART_ID, wedge6Model],
    [PYRAMID5_PART_ID, pyramid5Model],
    [TRIANGLE_PART_ID, triangleModel],
    [TRI6_PART_ID, tri6Model],
    [QUAD_PART_ID, quadModel],
    [QUAD8_PART_ID, quad8Model],
  ]);
  const genericPart = createGenericSolverMappedPart();
  const parts: readonly Part[] = [
    elementPart(POINT_PART_ID, elementsOf(pointLineModel, "point")),
    elementPart(LINE_PART_ID, elementsOf(lineModel, "line", 1)),
    elementPart(LINE3_PART_ID, elementsOf(line3Model, "line", 2)),
    elementPart(TET4_PART_ID, tet4Model),
    elementPart(TET10_PART_ID, tet10Model),
    elementPart(HEX8_PART_ID, hex8Model),
    elementPart(HEX20_PART_ID, hex20Model),
    elementPart(WEDGE6_PART_ID, wedge6Model),
    elementPart(PYRAMID5_PART_ID, pyramid5Model),
    elementPart(TRIANGLE_PART_ID, triangleModel),
    elementPart(QUAD_PART_ID, quadModel),
    elementPart(TRI6_PART_ID, tri6Model),
    elementPart(QUAD8_PART_ID, quad8Model),
    genericPart,
  ];
  const scene = galleryScene(parts, blockSize, GALLERY_LAYOUT);
  return {
    scene,
    partIds: {
      point: POINT_PART_ID,
      line: LINE_PART_ID,
      line3: LINE3_PART_ID,
      triangle: TRIANGLE_PART_ID,
      tri6: TRI6_PART_ID,
      quad: QUAD_PART_ID,
      quad8: QUAD8_PART_ID,
      tet4: TET4_PART_ID,
      tet10: TET10_PART_ID,
      hex8: HEX8_PART_ID,
      hex20: HEX20_PART_ID,
      wedge6: WEDGE6_PART_ID,
      pyramid5: PYRAMID5_PART_ID,
      generic: GENERIC_PART_ID,
    },
    elementModels: models,
    instanceCount: parts.length,
  };
}

/** Fixture shape for the linearly tessellated Hex20 cylinder example. */
type Hex20CylinderFixture = Omit<ElementFixture, "partIds"> & {
  readonly partIds: Pick<
    ElementFixtureParts,
    "point" | "line" | "line3" | "tet4" | "tet10" | "hex8" | "hex20"
  >;
};

/** Builds the Hex20 cylinder example used by the gallery preset. */
export function createHex20CylinderFixture(): Hex20CylinderFixture {
  const model = buildHex20CylinderModel();
  const part = elementPart(HEX20_PART_ID, model);
  const parts = [part];
  const scene = galleryScene(parts, 0, SINGLE_PART_LAYOUT);
  return {
    scene,
    partIds: {
      point: POINT_PART_ID,
      line: LINE_PART_ID,
      line3: LINE3_PART_ID,
      tet4: TET4_PART_ID,
      tet10: TET10_PART_ID,
      hex8: HEX8_PART_ID,
      hex20: HEX20_PART_ID,
    },
    elementModels: new Map([[HEX20_PART_ID, model]]),
    instanceCount: parts.length,
  };
}

function elementsOf(model: ElementModel, family: "point" | "line", order?: number): ElementModel {
  return createElementModel(
    [...model.nodes],
    model.elements.filter(
      (element) =>
        element.shape.family === family && (order === undefined || element.shape.order === order),
    ),
  );
}

/** Maps temporary solver-style polyhedron records into one retained Part. */
function createGenericSolverMappedPart(): Part {
  const solverNodes = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, 0.35, 0.2, 1.5];
  const solverFaces = [
    { nodeIds: [0, 3, 2, 1], faceIndex: 0, key: "solver-pyramid-base" },
    { nodeIds: [0, 1, 4], faceIndex: 1, key: "solver-pyramid-front" },
    { nodeIds: [1, 2, 4], faceIndex: 2, key: "solver-pyramid-right" },
    { nodeIds: [2, 3, 4], faceIndex: 3, key: "solver-pyramid-back" },
    { nodeIds: [3, 0, 4], faceIndex: 4, key: "solver-pyramid-left" },
  ] as const;
  return polygonPart(GENERIC_PART_ID, {
    positions: solverNodes,
    faces: solverFaces.map((face) => ({ ...face, elementId: 42, neighborElementIds: [] })),
    bodies: [{ id: 1, name: "Mapped solver body", elementIds: [42] }],
  });
}

function galleryScene(
  parts: readonly Part[],
  blockSize: number,
  layout: readonly GalleryPlacement[],
): Scene {
  let builder = createScene();
  for (const part of parts) builder = builder.addPart(part);
  const partById = new Map(parts.map((part) => [part.id, part]));
  const spacing = blockSize + GAP;
  const root = {
    id: ROOT_ASSEMBLY_ID,
    name: "element-gallery",
    placements: layout.map(({ partId, column, row }) => {
      if (!partById.has(partId)) throw new Error(`Element fixture layout has no part ${partId}`);
      return {
        kind: "part" as const,
        partId,
        transform: translation(column * spacing, row * spacing, 0),
      };
    }),
  };
  return builder.addAssembly(root).withRoot(root.id).build();
}

function validateFixtureOptions(gridSize: number, cellSize: number): void {
  if (!Number.isInteger(gridSize) || gridSize < 1) {
    throw new Error("gridSize must be a positive integer");
  }
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error("cellSize must be a positive finite number");
  }
}
