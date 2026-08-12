import type { ModelPreset } from "./presets";
import {
  createPart,
  type ElementTessellation,
  type FaceTessellation,
  type Geometry,
  type Part,
} from "../../src/geometry/part";
import { translation } from "../../src/math/mat4";
import { createScene } from "../../src/scene/scene";
import type { PartId } from "../../src/index";

const PART_ID: PartId = 1;
const ROOT_ASSEMBLY_ID = 1;
const CELLS_PER_SIDE = 128;
const COLUMNS = 8;
const ROWS = 8;

/**
 * Demo-only, repeatable high-performance case: a flat two-dimensional
 * 32,768-triangle shell reused 64 times for 2,097,152 triangles. It exercises
 * the standard two-sided FE surface renderer, not a benchmark-only path.
 */
export function createPerformancePreset(): ModelPreset {
  const geometry = createGridGeometry(CELLS_PER_SIDE);
  const part: Part = createPart(PART_ID, geometry);
  let builder = createScene().addPart(part);
  builder = builder.addAssembly({
    id: ROOT_ASSEMBLY_ID,
    name: "two-million-triangle shell",
    placements: Array.from({ length: COLUMNS * ROWS }, (_, index) => ({
      kind: "part" as const,
      partId: PART_ID,
      transform: translation((index % COLUMNS) * 1.15, Math.floor(index / COLUMNS) * 1.15, 0),
    })),
  });
  const scene = builder.withRoot(ROOT_ASSEMBLY_ID).build();
  return {
    id: "performance",
    name: "Performance · 2.10M triangles",
    scene,
    elementModels: new Map(),
    partColors: new Map([[PART_ID, { r: 0.24, g: 0.58, b: 0.93, a: 1 }]]),
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    partNames: new Map([[PART_ID, "128 × 128 reusable shell"]]),
    bounds: {
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: COLUMNS * 1.15 - 0.15,
      maxY: ROWS * 1.15 - 0.15,
      maxZ: 0,
    },
  };
}

function createGridGeometry(cells: number): Geometry {
  const positions = new Float32Array((cells + 1) * (cells + 1) * 3);
  const indices = new Uint32Array(cells * cells * 6);
  const elements: ElementTessellation[] = [];
  const faces: FaceTessellation[] = [];
  const facePickIds = new Uint32Array(cells * cells * 2);
  for (let y = 0; y <= cells; y++) {
    for (let x = 0; x <= cells; x++) {
      const offset = (y * (cells + 1) + x) * 3;
      positions[offset] = x / cells;
      positions[offset + 1] = y / cells;
      positions[offset + 2] = 0;
    }
  }
  let offset = 0;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const bottomLeft = y * (cells + 1) + x;
      const bottomRight = bottomLeft + 1;
      const topLeft = bottomLeft + cells + 1;
      const topRight = topLeft + 1;
      indices.set([bottomLeft, bottomRight, topRight, bottomLeft, topRight, topLeft], offset);
      const cell = y * cells + x;
      const elementId = cell + 1;
      elements.push({ id: elementId, primitiveStart: cell * 2, primitiveCount: 2 });
      faces.push({
        id: cell,
        elementId,
        faceIndex: 0,
        key: [bottomLeft, bottomRight, topRight, topLeft].sort((a, b) => a - b).join(":"),
        nodeIds: [bottomLeft, bottomRight, topRight, topLeft],
        neighborElementIds: [],
      });
      facePickIds[cell * 2] = cell + 1;
      facePickIds[cell * 2 + 1] = cell + 1;
      offset += 6;
    }
  }
  const nodePickIds = new Uint32Array((cells + 1) * (cells + 1));
  for (let node = 0; node < nodePickIds.length; node++) nodePickIds[node] = node + 1;
  return {
    positions,
    indices,
    primitive: "triangles",
    elements,
    faces,
    facePickIds,
    nodePickIds,
    nodePositions: positions,
  };
}
