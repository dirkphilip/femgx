import { createElement, type Element, type NodeId } from "../../src/elements/element";
import { createElementModel, type ElementModel } from "../../src/elements/model";
import { HEX8_SHAPE } from "../../src/elements/shapes";
import { elementPart, type ElementRenderMode } from "../../src/geometry/element-mesh";
import type { Bounds, Part } from "../../src/geometry/part";
import { identity } from "../../src/math/mat4";
import { flattenAssembly } from "../../src/runtime/flatten";
import { createScene, type Scene } from "../../src/scene/scene";
import type { AssemblyId, PartId } from "../../src/scene/types";

/** Stable part identifiers produced by the portal-frame fixture. */
export interface FrameFixtureParts {
  readonly solid: PartId;
  readonly surface: PartId;
  readonly edges: PartId;
}

/**
 * A deterministic, CPU-only structural FE fixture: a portal frame built from
 * hex elements with real shared-node topology. Two columns and a beam rest on a
 * foundation slab; every brick shares nodes at the joints, so the model is
 * conforming and interior faces are shared between adjacent elements.
 */
export interface FrameFixture {
  readonly scene: Scene;
  readonly partIds: FrameFixtureParts;
  /** The element model each part was tessellated from (all three parts). */
  readonly elementModels: ReadonlyMap<PartId, ElementModel>;
  readonly modePartIds: ReadonlyMap<ElementRenderMode, readonly PartId[]>;
  /** The volume mode visible by default. */
  readonly defaultMode: ElementRenderMode;
  /** Number of part placements (one per reusable part). */
  readonly instanceCount: number;
  /** Overall model bounds. */
  readonly bounds: Bounds;
}

const SOLID_PART_ID: PartId = 1;
const SURFACE_PART_ID: PartId = 2;
const EDGES_PART_ID: PartId = 3;
const ROOT_ASSEMBLY_ID: AssemblyId = 1;

/** Shared-node hex brick builder keyed by integer grid coordinates. */
class FrameNodeBuilder {
  readonly positions: number[] = [];
  private readonly byKey = new Map<string, NodeId>();

  node(x: number, y: number, z: number): NodeId {
    const key = `${x},${y},${z}`;
    const existing = this.byKey.get(key);
    if (existing !== undefined) return existing;
    const id = this.positions.length / 3;
    this.byKey.set(key, id);
    this.positions.push(x, y, z);
    return id;
  }
}

/** One axis-aligned brick region of the frame, in integer grid cells. */
interface FrameBrick {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly cellsX: number;
  readonly cellsY: number;
  readonly cellsZ: number;
}

/** The frame: two columns, a beam, and a foundation slab, all conforming. */
const FRAME_BRICKS: readonly FrameBrick[] = [
  { minX: 0, minY: 0, minZ: 0, cellsX: 1, cellsY: 5, cellsZ: 1 },
  { minX: 6, minY: 0, minZ: 0, cellsX: 1, cellsY: 5, cellsZ: 1 },
  { minX: 0, minY: 5, minZ: 0, cellsX: 7, cellsY: 1, cellsZ: 1 },
  { minX: 0, minY: -1, minZ: -1, cellsX: 7, cellsY: 1, cellsZ: 3 },
];

/** Builds the conforming hex mesh of the whole portal frame. */
export function buildFrameModel(): ElementModel {
  const builder = new FrameNodeBuilder();
  const elements: Element[] = [];
  let id = 1;
  for (const brick of FRAME_BRICKS) {
    for (let k = 0; k < brick.cellsZ; k += 1) {
      for (let j = 0; j < brick.cellsY; j += 1) {
        for (let i = 0; i < brick.cellsX; i += 1) {
          const x = brick.minX + i;
          const y = brick.minY + j;
          const z = brick.minZ + k;
          elements.push(
            createElement(id, HEX8_SHAPE, [
              builder.node(x, y, z),
              builder.node(x + 1, y, z),
              builder.node(x + 1, y + 1, z),
              builder.node(x, y + 1, z),
              builder.node(x, y, z + 1),
              builder.node(x + 1, y, z + 1),
              builder.node(x + 1, y + 1, z + 1),
              builder.node(x, y + 1, z + 1),
            ]),
          );
          id += 1;
        }
      }
    }
  }
  return createElementModel(builder.positions, elements);
}

/** Builds the portal-frame scene with solid, surface, and edge parts. */
export function createFrameFixture(): FrameFixture {
  const model = buildFrameModel();
  const parts: readonly Part[] = [
    elementPart(SOLID_PART_ID, model, "hex", "solid"),
    elementPart(SURFACE_PART_ID, model, "hex", "surface"),
    elementPart(EDGES_PART_ID, model, "hex", "edges"),
  ];
  const partIds: FrameFixtureParts = {
    solid: SOLID_PART_ID,
    surface: SURFACE_PART_ID,
    edges: EDGES_PART_ID,
  };
  let builder = createScene();
  for (const part of parts) {
    builder = builder.addPart(part);
  }
  const root = {
    id: ROOT_ASSEMBLY_ID,
    name: "root",
    placements: parts.map((part) => ({
      kind: "part" as const,
      partId: part.id,
      transform: identity(),
    })),
  };
  const scene = builder.addAssembly(root).withRoot(root.id).build();
  return {
    scene,
    partIds,
    elementModels: new Map<PartId, ElementModel>([
      [SOLID_PART_ID, model],
      [SURFACE_PART_ID, model],
      [EDGES_PART_ID, model],
    ]),
    modePartIds: new Map<ElementRenderMode, readonly PartId[]>([
      ["solid", [SOLID_PART_ID]],
      ["surface", [SURFACE_PART_ID]],
      ["edges", [EDGES_PART_ID]],
    ]),
    defaultMode: "solid",
    instanceCount: parts.length,
    bounds: sceneBounds(scene),
  };
}

/** Merges the world bounds of every placed part into one model bounds. */
function sceneBounds(scene: Scene): Bounds {
  const instances = flattenAssembly({
    assemblyId: scene.rootAssemblyId,
    assemblies: scene.assemblies,
    visibleAssemblyIds: scene.visibleAssemblyIds,
    visiblePartIds: scene.visiblePartIds,
  });
  let result: Bounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  for (const instance of instances) {
    const part = scene.parts.get(instance.partId);
    if (part === undefined) continue;
    const b = part.bounds;
    result = {
      minX: Math.min(result.minX, b.minX),
      minY: Math.min(result.minY, b.minY),
      minZ: Math.min(result.minZ, b.minZ),
      maxX: Math.max(result.maxX, b.maxX),
      maxY: Math.max(result.maxY, b.maxY),
      maxZ: Math.max(result.maxZ, b.maxZ),
    };
  }
  return result;
}
