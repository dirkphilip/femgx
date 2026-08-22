import {
  createPart,
  createSceneBuilder,
  multiplyMatrices,
  scalingMatrix,
  translationMatrix,
  type AssemblyId,
  type Bounds,
  type Part,
  type PartId,
  type Scene,
} from "@/entries/root";
import {
  createElementModel,
  createPartFromElementModel,
  createPartFromExplicitTopology,
  topologyFor,
  type ElementModel,
} from "@/entries/model";
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
import { createTet4Fixture } from "../../fixtures/fe/tet4";

/** Stable part identifiers for the helper and generic mapping examples. */
export interface ElementFixtureParts {
  readonly controlNode: PartId;
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
  readonly mixed: PartId;
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
  readonly partOccurrenceCount: number;
}

const POINT_PART_ID: PartId = 1;
const CONTROL_NODE_PART_ID: PartId = 16;
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
const MIXED_PART_ID: PartId = 15;
const ROOT_ASSEMBLY_ID: AssemblyId = 1;
const GAP = 1;

export interface ElementGalleryEntry {
  readonly partId: PartId;
  readonly category: "0d-1d" | "2d" | "3d";
  readonly order: number;
  readonly cell: readonly [column: number, row: number];
  readonly displayScale: number;
  readonly centering: "bounds";
}

export const ELEMENT_GALLERY_ENTRIES: readonly ElementGalleryEntry[] = [
  {
    partId: CONTROL_NODE_PART_ID,
    category: "0d-1d",
    order: 0,
    cell: [-0.5, 0.5],
    displayScale: 1,
    centering: "bounds",
  },
  {
    partId: POINT_PART_ID,
    category: "0d-1d",
    order: 1,
    cell: [1, 0],
    displayScale: 1,
    centering: "bounds",
  },
  {
    partId: LINE_PART_ID,
    category: "0d-1d",
    order: 2,
    cell: [2, 0],
    displayScale: 1,
    centering: "bounds",
  },
  {
    partId: LINE3_PART_ID,
    category: "0d-1d",
    order: 3,
    cell: [3, 0],
    displayScale: 1,
    centering: "bounds",
  },
  {
    partId: TRIANGLE_PART_ID,
    category: "2d",
    order: 0,
    cell: [0, 1],
    displayScale: 1,
    centering: "bounds",
  },
  {
    partId: TRI6_PART_ID,
    category: "2d",
    order: 1,
    cell: [1, 1],
    displayScale: 1,
    centering: "bounds",
  },
  {
    partId: QUAD_PART_ID,
    category: "2d",
    order: 2,
    cell: [2, 1],
    displayScale: 1,
    centering: "bounds",
  },
  {
    partId: QUAD8_PART_ID,
    category: "2d",
    order: 3,
    cell: [3, 1],
    displayScale: 1,
    centering: "bounds",
  },
  {
    partId: GENERIC_PART_ID,
    category: "2d",
    order: 4,
    cell: [4, 1],
    displayScale: 1,
    centering: "bounds",
  },
  {
    partId: MIXED_PART_ID,
    category: "2d",
    order: 5,
    cell: [5, 1],
    displayScale: 1,
    centering: "bounds",
  },
  {
    partId: TET4_PART_ID,
    category: "3d",
    order: 0,
    cell: [0, 2],
    displayScale: 1,
    centering: "bounds",
  },
  {
    partId: TET10_PART_ID,
    category: "3d",
    order: 1,
    cell: [1, 2],
    displayScale: 1,
    centering: "bounds",
  },
  {
    partId: WEDGE6_PART_ID,
    category: "3d",
    order: 2,
    cell: [2, 2],
    displayScale: 2,
    centering: "bounds",
  },
  {
    partId: PYRAMID5_PART_ID,
    category: "3d",
    order: 3,
    cell: [3, 2],
    displayScale: 2,
    centering: "bounds",
  },
  {
    partId: HEX8_PART_ID,
    category: "3d",
    order: 4,
    cell: [4, 2],
    displayScale: 1,
    centering: "bounds",
  },
  {
    partId: HEX20_PART_ID,
    category: "3d",
    order: 5,
    cell: [5, 2],
    displayScale: 1,
    centering: "bounds",
  },
];

interface GalleryPlacement {
  readonly partId: PartId;
  readonly cell: readonly [column: number, row: number];
  readonly displayScale: number;
  readonly centering: "bounds" | "none";
}

const SINGLE_PART_LAYOUT: readonly GalleryPlacement[] = [
  { partId: HEX20_PART_ID, cell: [0, 0], displayScale: 1, centering: "none" },
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
  const sharedTet4 =
    options.gridSize === undefined && options.cellSize === undefined
      ? createTet4Fixture()
      : undefined;
  const tet4Model = sharedTet4?.elementModel ?? buildTetModel(gridSize, cellSize, false);
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
    createControlNodePart(),
    createPartFromElementModel(POINT_PART_ID, elementsOf(pointLineModel, "point")),
    createPartFromElementModel(LINE_PART_ID, elementsOf(lineModel, "line", 1)),
    createPartFromElementModel(LINE3_PART_ID, elementsOf(line3Model, "line", 2)),
    sharedTet4?.part ?? createPartFromElementModel(TET4_PART_ID, tet4Model),
    createPartFromElementModel(TET10_PART_ID, tet10Model),
    createPartFromElementModel(HEX8_PART_ID, hex8Model),
    createPartFromElementModel(HEX20_PART_ID, hex20Model),
    createPartFromElementModel(WEDGE6_PART_ID, wedge6Model),
    createPartFromElementModel(PYRAMID5_PART_ID, pyramid5Model),
    createPartFromElementModel(TRIANGLE_PART_ID, triangleModel),
    createPartFromElementModel(QUAD_PART_ID, quadModel),
    createPartFromElementModel(TRI6_PART_ID, tri6Model),
    createPartFromElementModel(QUAD8_PART_ID, quad8Model),
    genericPart,
    createMixedPrimitivePart(),
  ];
  const scene = galleryScene(parts, blockSize, ELEMENT_GALLERY_ENTRIES);
  return {
    scene,
    partIds: {
      controlNode: CONTROL_NODE_PART_ID,
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
      mixed: MIXED_PART_ID,
    },
    elementModels: models,
    partOccurrenceCount: parts.length,
  };
}

/** One selectable node without element ownership, suitable for control points. */
function createControlNodePart(): Part {
  const positions = new Float32Array([0, 0, 0]);
  return createPart(CONTROL_NODE_PART_ID, {
    geometries: [
      {
        positions,
        indices: new Uint32Array([0]),
        primitive: "points",
        nodePickIds: new Uint32Array([1]),
      },
    ],
    nodePositions: positions,
  });
}

/** One semantic element rendered through point, line, and triangle leaves. */
function createMixedPrimitivePart(): Part {
  return createPartFromExplicitTopology(MIXED_PART_ID, {
    positions: [0, 0, 0, 0.35, 0, 0, 1.25, 0, 0, 0.35, 0.35, 0, 1.25, 0.35, 0, 0.8, 1.2, 0],
    facets: {
      connectivity: [3, 3, 4, 5],
      elementIds: [1],
      faceIndices: [0],
    },
    lines: { connectivity: [2, 1, 2], elementIds: [1] },
    points: { nodeIds: [0], elementIds: [1] },
  });
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
  const part = createPartFromElementModel(HEX20_PART_ID, model);
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
    partOccurrenceCount: parts.length,
  };
}

function elementsOf(model: ElementModel, family: "point" | "line", order?: number): ElementModel {
  return createElementModel(
    [...model.nodes],
    [...model.elements].filter(
      (element) =>
        topologyFor(element.shape).family === family &&
        (order === undefined || topologyFor(element.shape).order === order),
    ),
  );
}

/** Maps temporary solver-style polyhedron records into one retained Part. */
function createGenericSolverMappedPart(): Part {
  const solverNodes = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, 0.35, 0.2, 1.5];
  return createPartFromExplicitTopology(GENERIC_PART_ID, {
    positions: solverNodes,
    facets: {
      connectivity: [4, 0, 3, 2, 1, 3, 0, 1, 4, 3, 1, 2, 4, 3, 2, 3, 4, 3, 3, 0, 4],
      elementIds: [42, 42, 42, 42, 42],
      faceIndices: [0, 1, 2, 3, 4],
    },
    bodies: [{ id: 1, name: "Mapped solver body", elementIds: [42] }],
  });
}

function galleryScene(
  parts: readonly Part[],
  blockSize: number,
  layout: readonly (ElementGalleryEntry | GalleryPlacement)[],
): Scene {
  let builder = createSceneBuilder();
  for (const part of parts) builder = builder.addPart(part);
  const partById = new Map(parts.map((part) => [part.id, part]));
  const spacing = blockSize + GAP;
  const root = {
    id: ROOT_ASSEMBLY_ID,
    name: "element-gallery",
    placements: layout.map((entry, index) => {
      const part = partById.get(entry.partId);
      if (part === undefined) throw new Error(`Element fixture layout has no part ${entry.partId}`);
      const [column, row] = entry.cell;
      return {
        kind: "part" as const,
        placementId: `gallery-${index}`,
        partId: entry.partId,
        transform:
          entry.centering === "bounds"
            ? centeredTransform(
                part.bounds,
                entry.displayScale,
                column * spacing,
                row * spacing,
                blockSize,
              )
            : translationMatrix(column * spacing, row * spacing, 0),
      };
    }),
  };
  return builder.addAssembly(root).setRootAssembly(root.id).build();
}

function centeredTransform(
  bounds: Bounds,
  displayScale: number,
  cellOriginX: number,
  cellOriginY: number,
  blockSize: number,
): Float32Array {
  const centerX = ((bounds.minX + bounds.maxX) / 2) * displayScale;
  const centerY = ((bounds.minY + bounds.maxY) / 2) * displayScale;
  const centerZ = ((bounds.minZ + bounds.maxZ) / 2) * displayScale;
  const target = cellOriginX + blockSize / 2;
  return multiplyMatrices(
    translationMatrix(
      target - centerX,
      cellOriginY + blockSize / 2 - centerY,
      blockSize / 2 - centerZ,
    ),
    scalingMatrix(displayScale),
  );
}

function validateFixtureOptions(gridSize: number, cellSize: number): void {
  if (!Number.isInteger(gridSize) || gridSize < 1) {
    throw new Error("gridSize must be a positive integer");
  }
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new Error("cellSize must be a positive finite number");
  }
}
