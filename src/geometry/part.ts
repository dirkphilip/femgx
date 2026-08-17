import { validateBodies, validateElements, validatePickIds } from "./part-validation";
import { validatePartId } from "./id-validation";
import type { Bounds, ElementTessellation, Geometry, GeometryBody } from "./types";

export type {
  Bounds,
  ElementPrimitiveRange,
  ElementTessellation,
  FaceSubset,
  FaceTessellation,
  GeometryBody,
  GeometryEdge,
  Geometry,
  LineGeometry,
  PointGeometry,
  Primitive,
  TriangleGeometry,
} from "./types";
export type { BodyId } from "../elements/model";

/**
 * A globally stable identifier for a reusable part within a scene.
 * @category Scene and geometry
 */
export type PartId = number;

export { MAX_PART_ID, validatePartId } from "./id-validation";

/**
 * Reusable, immutable drawable geometry.
 *
 * A part is a local definition, not a placed object: it owns geometry and
 * optional FE identity tables, while {@link root.PartPlacement} owns the transform
 * that places it. Register one part in a {@link root.Scene} and reference it from
 * multiple placements to preserve instancing. The renderer compiles the
 * definition into shared GPU geometry; it never becomes the source of truth.
 *
 * A raw part with only `geometries` is valid display geometry. The metadata
 * capabilities are deliberately separate: part-level `elements` provide
 * elemental identity and elemental result mapping; node picking, nodal results,
 * and deformation require part-level `nodePositions` plus per-geometry
 * `nodePickIds`; authored edge interaction requires per-geometry `edges`.
 * {@link model.elementPart} supplies these FE mappings consistently.
 * @category Start here
 */
export interface Part {
  /** Internal nominal marker; parts are created by {@link createPart}. */
  readonly [partBrand]: true;
  /** Stable reusable-part identifier. */
  readonly id: PartId;
  /** Indexed geometry groups, one group per primitive topology. */
  readonly geometries: readonly Geometry[];
  /** Optional element-to-primitive ownership table. */
  readonly elements?: readonly ElementTessellation[];
  /** Optional dense part-local node coordinates for nodal results/deformation. */
  readonly nodePositions?: Float32Array;
  /** Optional semantic body table with direct element membership. */
  readonly bodies?: readonly GeometryBody[];
  /** Derived axis-aligned bounds in local part coordinates. */
  readonly bounds: Bounds;
}

const partBrand: unique symbol = Symbol("Part");

/**
 * Validates and constructs one immutable part boundary.
 *
 * `input.geometries` is the required plural collection: each primitive kind
 * (`triangles`, `lines`, or `points`) may occur at most once. Optional semantic
 * tables describe the same local geometry and are validated together, so an
 * element cannot point at a missing primitive group. Bounds are derived from
 * geometry and cannot be supplied separately or become stale.
 *
 * The function retains the supplied typed arrays without defensive copies and
 * takes ownership of them. Do not mutate or reuse those arrays after this call.
 * For typed FE authoring, prefer `elementPart(partId, model)`, which supplies
 * element tessellation, node positions, node-pick ids, and authored topology
 * consistently.
 * @example Create a display part, then place the definition in a scene.
 * ```ts
 * import { createPart, createScene, identity } from "femgx";
 *
 * const part = createPart(10, {
 *   geometries: [{
 *     primitive: "triangles",
 *     positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
 *     indices: new Uint32Array([0, 1, 2]),
 *   }],
 * });
 * const scene = createScene()
 *   .addPart(part)
 *   .addAssembly({
 *     id: 20,
 *     name: "root",
 *     placements: [{ kind: "part", partId: part.id, transform: identity() }],
 *   })
 *   .withRoot(20)
 *   .build();
 * ```
 * @category Start here
 */
export function createPart(
  id: PartId,
  input: {
    readonly geometries: readonly Geometry[];
    readonly elements?: readonly ElementTessellation[];
    readonly nodePositions?: Float32Array;
    readonly bodies?: readonly GeometryBody[];
  },
): Part {
  validatePartId(id);
  const groups = input.geometries;
  if (groups.length === 0) throw new Error("Part must contain at least one geometry group");
  validateNodePositions(input.nodePositions);
  const primitives = new Set<Geometry["primitive"]>();
  for (const geometry of groups) {
    if (primitives.has(geometry.primitive)) {
      throw new Error(`Part cannot contain duplicate ${geometry.primitive} geometry groups`);
    }
    primitives.add(geometry.primitive);
  }
  validateSemanticIds(input.elements ?? [], primitives);
  for (const geometry of groups) {
    validateGeometryArrays(geometry);
    validateElements(geometry, input.elements);
    validatePickIds(geometry, input.elements, input.nodePositions);
  }
  validateBodies({
    ...(input.elements === undefined ? {} : { elements: input.elements }),
    ...(input.bodies === undefined ? {} : { bodies: input.bodies }),
  });
  return {
    [partBrand]: true,
    id,
    geometries: groups,
    ...(input.elements === undefined ? {} : { elements: input.elements }),
    ...(input.nodePositions === undefined ? {} : { nodePositions: input.nodePositions }),
    ...(input.bodies === undefined ? {} : { bodies: input.bodies }),
    bounds: finitePartBounds(groups),
  };
}

function validateSemanticIds(
  elements: readonly ElementTessellation[],
  primitives: ReadonlySet<Geometry["primitive"]>,
): void {
  const seen = new Set<number>();
  for (const element of elements) {
    if (seen.has(element.id)) throw new Error(`Duplicate element id ${element.id}`);
    seen.add(element.id);
    if (element.primitiveRanges.length === 0) {
      throw new Error(`Element ${element.id} must declare at least one primitive range`);
    }
    for (const range of element.primitiveRanges) {
      if (!primitives.has(range.primitive)) {
        throw new Error(
          `Element ${element.id} references missing ${range.primitive} geometry group`,
        );
      }
    }
  }
}

function validateNodePositions(positions: Float32Array | undefined): void {
  if (positions === undefined) return;
  if (positions.length % 3 !== 0) throw new Error("nodePositions length must be a multiple of 3");
  for (const position of positions) {
    if (!Number.isFinite(position)) throw new Error("nodePositions must be finite");
  }
}

/** Computes the bounding box of a geometry's positions. */
export function computeBounds(geometry: Geometry): Bounds {
  return computePositionsBounds(geometry.positions);
}

/** Returns all eight corners of a bounds box in deterministic order. */
export function boundsCorners(bounds: Bounds): ReadonlyArray<readonly [number, number, number]> {
  return [
    [bounds.minX, bounds.minY, bounds.minZ],
    [bounds.minX, bounds.minY, bounds.maxZ],
    [bounds.minX, bounds.maxY, bounds.minZ],
    [bounds.minX, bounds.maxY, bounds.maxZ],
    [bounds.maxX, bounds.minY, bounds.minZ],
    [bounds.maxX, bounds.minY, bounds.maxZ],
    [bounds.maxX, bounds.maxY, bounds.minZ],
    [bounds.maxX, bounds.maxY, bounds.maxZ],
  ];
}

const EMPTY_PART_BOUNDS: Bounds = {
  minX: 0,
  minY: 0,
  minZ: 0,
  maxX: 0,
  maxY: 0,
  maxZ: 0,
};

function finitePartBounds(geometries: readonly Geometry[]): Bounds {
  let bounds: Bounds | undefined;
  for (const geometry of geometries) {
    if (geometry.positions.length === 0) continue;
    const next = computePositionsBounds(geometry.positions);
    bounds =
      bounds === undefined
        ? next
        : {
            minX: Math.min(bounds.minX, next.minX),
            minY: Math.min(bounds.minY, next.minY),
            minZ: Math.min(bounds.minZ, next.minZ),
            maxX: Math.max(bounds.maxX, next.maxX),
            maxY: Math.max(bounds.maxY, next.maxY),
            maxZ: Math.max(bounds.maxZ, next.maxZ),
          };
  }
  return bounds ?? EMPTY_PART_BOUNDS;
}

function validateGeometryArrays(geometry: Geometry): void {
  if (geometry.positions.length % 3 !== 0) {
    throw new Error("Geometry positions length must be a multiple of 3");
  }
  const vertexCount = geometry.positions.length / 3;
  for (const position of geometry.positions) {
    if (!Number.isFinite(position)) throw new Error("Geometry positions must be finite");
  }
  const indicesPerPrimitive =
    geometry.primitive === "triangles" ? 3 : geometry.primitive === "lines" ? 2 : 1;
  if (geometry.indices.length % indicesPerPrimitive !== 0) {
    throw new Error(
      `Geometry index count must be a multiple of ${indicesPerPrimitive} for ${geometry.primitive}`,
    );
  }
  for (const index of geometry.indices) {
    if (index >= vertexCount) throw new Error(`Geometry index ${index} is outside positions`);
  }
}

/** Returns whether every component of a bounding box is finite. */
export function isFiniteBounds(bounds: Bounds): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.minZ) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY) &&
    Number.isFinite(bounds.maxZ)
  );
}

/**
 * Computes the bounding box of raw positions in single or double precision.
 */
export function computePositionsBounds(positions: Float32Array | Float64Array): Bounds {
  const mins = { minX: Infinity, minY: Infinity, minZ: Infinity };
  const maxs = { maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    const z = positions[i + 2] ?? 0;
    if (x < mins.minX) mins.minX = x;
    if (y < mins.minY) mins.minY = y;
    if (z < mins.minZ) mins.minZ = z;
    if (x > maxs.maxX) maxs.maxX = x;
    if (y > maxs.maxY) maxs.maxY = y;
    if (z > maxs.maxZ) maxs.maxZ = z;
  }
  return { ...mins, ...maxs };
}

export {
  bodyIdForElement,
  GeometryValidationError,
  logicalPrimitiveCount,
  primitiveRangesForElement,
  validateBodies,
  validateElements,
  validateFaceSubset,
  faceForPrimitive,
  validatePickIds,
} from "./part-validation";
export type { GeometryValidationCode } from "./part-validation";
