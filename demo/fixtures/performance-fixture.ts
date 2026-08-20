import type { ModelPreset } from "./presets";
import { createPart, type Part } from "../../src/geometry/part";
import { translationMatrix } from "../../src/math/mat4";
import { createSceneBuilder } from "../../src/scene/scene";
import type { PartId } from "../../src/geometry/part";
import { createPlanarGridGeometry } from "./planar-grid";

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
  const build = createPlanarGridGeometry(CELLS_PER_SIDE, {
    elementFamily: "quad",
    withFaces: true,
  });
  const part: Part = createPart(PART_ID, {
    geometries: [build.geometry],
    elements: build.elements,
    nodePositions: build.nodePositions,
  });
  let builder = createSceneBuilder().addPart(part);
  builder = builder.addAssembly({
    id: ROOT_ASSEMBLY_ID,
    name: "two-million-triangle shell",
    placements: Array.from({ length: COLUMNS * ROWS }, (_, index) => ({
      kind: "part" as const,
      partId: PART_ID,
      transform: translationMatrix((index % COLUMNS) * 1.15, Math.floor(index / COLUMNS) * 1.15, 0),
    })),
  });
  const scene = builder.setRootAssembly(ROOT_ASSEMBLY_ID).build();
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
