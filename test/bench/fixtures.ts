import { createPart, type Part } from "../../src/geometry/part";
import type { GeometryBody } from "../../src/geometry/part";
import { identity, translation } from "../../src/math/mat4";
import type { AssemblyDefinition, Placement } from "../../src/scene/assembly";
import { createScene, type Scene } from "../../src/scene/scene";
import type { PartId } from "../../src/geometry/part";
import type { AssemblyId } from "../../src/scene/types";
import { createPlanarGridGeometry } from "../../demo/fixtures/planar-grid";

/**
 * Deterministic benchmark model sizes. These are fixed so measurements stay
 * comparable across runs; change them together with the budgets in
 * `budget.test.ts` and the note in `wiki/engineering/benchmarks.md`.
 */
export const BENCH_PART_COUNT = 200;
export const BENCH_SUBCASE_COUNT = 100;
export const BENCH_PLACEMENTS_PER_SUBCASE = 2_000;
/** Shallow model: root -> subcase -> part placements. */
export const BENCH_INSTANCE_COUNT = BENCH_SUBCASE_COUNT * BENCH_PLACEMENTS_PER_SUBCASE;
/** Deep balanced tree: fanout^depth leaves, each with `partsPerLeaf` parts. */
export const BENCH_HIERARCHY_DEPTH = 4;
export const BENCH_HIERARCHY_FANOUT = 8;
export const BENCH_HIERARCHY_PARTS_PER_LEAF = 50;
export const BENCH_HIERARCHY_INSTANCE_COUNT =
  BENCH_HIERARCHY_FANOUT ** BENCH_HIERARCHY_DEPTH * BENCH_HIERARCHY_PARTS_PER_LEAF;
/** Body-heavy geometry: 16,384 quad elements split across 256 logical bodies. */
export const BENCH_BODY_GRID_CELLS = 128;
export const BENCH_BODY_COUNT = 256;
export const BENCH_BODY_ELEMENT_COUNT = BENCH_BODY_GRID_CELLS ** 2;

export type SceneShape = "distinct-parts" | "shared-part";

/** Builds equal tiny-triangle placement counts with shared or distinct part ownership. */
export function buildTinyManyPieceScene(shape: SceneShape, occurrenceCount: number): Scene {
  const builder = createScene();
  if (shape === "shared-part") builder.addPart(tinyElementPart(1));
  const transform = identity();
  const placements = Array.from({ length: occurrenceCount }, (_, index) => {
    const partId = shape === "shared-part" ? 1 : index + 1;
    if (shape === "distinct-parts") builder.addPart(tinyElementPart(partId));
    return { kind: "part" as const, placementId: String(index), partId, transform };
  });
  return builder
    .addAssembly({ id: 1, name: `${shape}-${occurrenceCount}`, placements })
    .withRoot(1)
    .build();
}

function tinyElementPart(id: PartId): Part {
  const geometry = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
  };
  return createPart(id, {
    geometries: [geometry],
    elements: [
      {
        id: 1,
        primitiveRanges: [{ primitive: "triangles", primitiveStart: 0, primitiveCount: 1 }],
      },
    ],
  });
}

function part(id: PartId): Part {
  const geometry = {
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
  };
  return createPart(id, { geometries: [geometry] });
}

function partMap(count: number): ReadonlyMap<PartId, Part> {
  const parts = new Map<PartId, Part>();
  for (let id = 1; id <= count; id++) {
    parts.set(id, part(id));
  }
  return parts;
}

/**
 * Deterministic part placements cycling over `partCount` parts. The transform
 * spreads instances along x so they remain spatially separated.
 */
function partPlacements(count: number, partCount: number, row: number): Placement[] {
  const placements: Placement[] = [];
  for (let i = 0; i < count; i++) {
    placements.push({
      kind: "part",
      partId: (i % partCount) + 1,
      transform: translation(i * 0.001, row, 0),
    });
  }
  return placements;
}

/** A shallow model: root -> subcase assemblies -> part placements. */
export function makeScene(options: {
  readonly subcaseCount: number;
  readonly placementsPerSubcase: number;
  readonly partCount: number;
}): Scene {
  const { subcaseCount, placementsPerSubcase, partCount } = options;
  const parts = partMap(partCount);
  const assemblies = new Map<AssemblyId, AssemblyDefinition>();
  const rootPlacements: Placement[] = [];
  for (let subcase = 0; subcase < subcaseCount; subcase++) {
    const subcaseId = subcase + 2;
    const subcaseAssembly: AssemblyDefinition = {
      id: subcaseId,
      placements: partPlacements(placementsPerSubcase, partCount, subcase),
    };
    assemblies.set(subcaseId, subcaseAssembly);
    rootPlacements.push({
      kind: "assembly",
      assemblyId: subcaseId,
      transform: identity(),
    });
  }
  assemblies.set(1, { id: 1, placements: rootPlacements });
  return {
    rootAssemblyId: 1,
    parts,
    assemblies,
    visiblePartIds: new Set(parts.keys()),
    visibleAssemblyIds: new Set(assemblies.keys()),
  };
}

/**
 * A deep balanced assembly tree exercising nested transform composition:
 * internal nodes place `fanout` sub-assemblies and leaf nodes place
 * `partsPerLeaf` parts.
 */
export function makeHierarchyScene(options: {
  readonly depth: number;
  readonly fanout: number;
  readonly partsPerLeaf: number;
  readonly partCount: number;
}): Scene {
  const { depth, fanout, partsPerLeaf, partCount } = options;
  const parts = partMap(partCount);
  const assemblies = new Map<AssemblyId, AssemblyDefinition>();
  let nextId = 1;
  const buildNode = (currentDepth: number, nodeId: AssemblyId): void => {
    const placements: Placement[] = [];
    if (currentDepth === 0) {
      for (let i = 0; i < partsPerLeaf; i++) {
        placements.push({
          kind: "part",
          partId: (i % partCount) + 1,
          transform: translation(i * 0.01, 0, 0),
        });
      }
    } else {
      for (let i = 0; i < fanout; i++) {
        const childId = nextId;
        nextId += 1;
        placements.push({ kind: "assembly", assemblyId: childId, transform: translation(i, 0, 0) });
        buildNode(currentDepth - 1, childId);
      }
    }
    assemblies.set(nodeId, { id: nodeId, placements });
  };
  const rootId = nextId;
  nextId += 1;
  buildNode(depth, rootId);
  return {
    rootAssemblyId: rootId,
    parts,
    assemblies,
    visiblePartIds: new Set(parts.keys()),
    visibleAssemblyIds: new Set(assemblies.keys()),
  };
}

/** Body-heavy indexed mesh shared by metadata and renderer-preparation benchmarks. */
export function makeBodyGeometry() {
  return createPlanarGridGeometry(BENCH_BODY_GRID_CELLS, {
    elementFamily: "quad",
    bodyCount: BENCH_BODY_COUNT,
    withFaces: true,
  });
}

/** Returns deterministic round-robin body memberships for a dense element-id range. */
export function makeBodies(elementCount: number, bodyCount: number): readonly GeometryBody[] {
  const memberships = Array.from({ length: bodyCount }, () => [] as number[]);
  for (let elementId = 1; elementId <= elementCount; elementId += 1) {
    memberships[(elementId - 1) % bodyCount]?.push(elementId);
  }
  return memberships.map((elementIds, index) => ({ id: index + 1, elementIds }));
}
