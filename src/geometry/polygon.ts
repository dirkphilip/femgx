import type { ElementId, NodeId } from "../elements/element";
import type { FaceKey } from "../elements/faces";
import { canonicalKey } from "../elements/keys";
import type { PartId } from "./part";
import {
  createPart,
  validateBodies,
  validateElements,
  validatePickIds,
  type Body,
  type ElementTessellation,
  type FaceTessellation,
  type Part,
  type TriangleGeometry,
} from "./part";
import { TriangleMeshAssembler, type MeshVertex } from "./mesh-builder";
import {
  PolygonGeometryError,
  triangulatePolygon,
  type PolygonValidationCode,
} from "./polygon-triangulation";

/** One ordered polygon loop and the element identity that owns its face. */
export interface PolygonFaceInput {
  readonly nodeIds: readonly NodeId[];
  readonly elementId: ElementId;
  /** Optional element-local face index; defaults to deterministic input order. */
  readonly faceIndex?: number;
  /** Optional source face key; defaults to the sorted node-id key. */
  readonly key?: FaceKey;
  /** Optional source adjacency metadata, copied into the face descriptor. */
  readonly neighborElementIds?: readonly ElementId[];
}

/** Geometry-owned input for deterministic polygon-to-triangle tessellation. */
export interface PolygonGeometryInput {
  /** Flat xyz coordinates indexed by the node ids in `faces`. */
  readonly positions: ArrayLike<number>;
  /** Ordered, simple, planar polygon faces. An empty list is valid no-draw input. */
  readonly faces: readonly PolygonFaceInput[];
  /** Optional reusable-part body metadata keyed by the owning element ids. */
  readonly bodies?: readonly Body[];
}

export { PolygonGeometryError };
export type { PolygonValidationCode };

interface PolygonRecord {
  readonly id: number;
  readonly input: PolygonFaceInput;
  readonly triangles: readonly (readonly [NodeId, NodeId, NodeId])[];
  readonly faceIndex: number;
  readonly key: FaceKey;
}

interface PrimitiveRange {
  readonly primitiveStart: number;
  readonly primitiveCount: number;
}

interface ElementGroup {
  readonly elementId: ElementId;
  readonly faces: PolygonRecord[];
}

/** Builds reusable indexed triangle geometry from authored polygon loops. */
export function polygonGeometry(input: PolygonGeometryInput): TriangleGeometry {
  const positions = copyPositions(input.positions);
  const nextFaceIndices = new Map<ElementId, number>();
  const records = input.faces.map((face, index) => {
    const nextFaceIndex = nextFaceIndices.get(face.elementId) ?? 0;
    const record = createRecord(face, index, positions, nextFaceIndex);
    const following = Math.max(nextFaceIndex + 1, record.faceIndex + 1);
    nextFaceIndices.set(face.elementId, following);
    return record;
  });
  validateFaceIndices(records);
  const groups = groupByElement(records);
  const bodyIds = bodyAssignments(groups, input.bodies);
  const mesh = new TriangleMeshAssembler();
  const elements: ElementTessellation[] = [];
  const ranges = new Map<number, PrimitiveRange>();
  for (const group of groups) {
    const primitiveStart = mesh.triangleCount;
    for (const record of group.faces) {
      const faceStart = mesh.triangleCount;
      for (const triangle of record.triangles) {
        mesh.append(triangleVertices(triangle, positions));
      }
      ranges.set(record.id, {
        primitiveStart: faceStart,
        primitiveCount: mesh.triangleCount - faceStart,
      });
    }
    const primitiveCount = mesh.triangleCount - primitiveStart;
    const bodyId = bodyIds.get(group.elementId);
    const tessellation: ElementTessellation = {
      id: group.elementId,
      primitiveStart,
      primitiveCount,
    };
    elements.push(bodyId === undefined ? tessellation : { ...tessellation, bodyId });
  }
  const faces = records.map((record) =>
    faceTessellation(record, bodyIds.get(record.input.elementId), ranges),
  );
  const geometry = mesh.build("triangles", elements, faces, positions, input.bodies);
  const result: TriangleGeometry = { ...geometry, nodePositions: positions };
  validateElements(result);
  validatePickIds(result);
  return result;
}

/** Builds a reusable part from polygon input, including finite bounds. */
export function polygonPart(partId: PartId, input: PolygonGeometryInput): Part {
  const geometry = polygonGeometry(input);
  return createPart(partId, geometry);
}

function copyPositions(input: ArrayLike<number>): Float32Array {
  if (input.length % 3 !== 0) {
    throw new PolygonGeometryError(
      "invalid-positions",
      `Polygon positions length must be a multiple of 3 but got ${input.length}`,
    );
  }
  const positions = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const value = input[index];
    if (value === undefined || !Number.isFinite(value)) {
      throw new PolygonGeometryError(
        "invalid-positions",
        `Polygon position ${index} must be finite, got ${String(value)}`,
      );
    }
    positions[index] = value;
  }
  return positions;
}

function createRecord(
  input: PolygonFaceInput,
  id: number,
  positions: Float32Array,
  defaultFaceIndex: number,
): PolygonRecord {
  validateElementId(input.elementId, "owner");
  validateFaceMetadata(input);
  const triangles = triangulatePolygon(input.nodeIds, positions);
  const faceIndex = input.faceIndex ?? defaultFaceIndex;
  if (!Number.isInteger(faceIndex) || faceIndex < 0) {
    throw new PolygonGeometryError(
      "invalid-face-metadata",
      `Face ${id} has invalid faceIndex ${String(faceIndex)}`,
    );
  }
  return {
    id,
    input,
    triangles,
    faceIndex,
    key: input.key ?? canonicalKey(input.nodeIds),
  };
}

function validateElementId(id: ElementId, label: string): void {
  if (!Number.isInteger(id) || id < 0) {
    throw new PolygonGeometryError(
      "invalid-face-metadata",
      `Polygon ${label} element id must be a non-negative integer, got ${id}`,
    );
  }
}

function validateFaceMetadata(face: PolygonFaceInput): void {
  if (face.key !== undefined && face.key.length === 0) {
    throw new PolygonGeometryError("invalid-face-metadata", "Polygon face key must not be empty");
  }
  for (const neighbor of face.neighborElementIds ?? []) {
    validateElementId(neighbor, "neighbor");
  }
}

function groupByElement(records: readonly PolygonRecord[]): readonly ElementGroup[] {
  const groups: ElementGroup[] = [];
  const byId = new Map<ElementId, ElementGroup>();
  for (const record of records) {
    let group = byId.get(record.input.elementId);
    if (group === undefined) {
      group = { elementId: record.input.elementId, faces: [] };
      byId.set(group.elementId, group);
      groups.push(group);
    }
    group.faces.push(record);
  }
  return groups;
}

function bodyAssignments(
  groups: readonly ElementGroup[],
  bodies: readonly Body[] | undefined,
): ReadonlyMap<ElementId, number> {
  const assignments = new Map<ElementId, number>();
  for (const body of bodies ?? []) {
    for (const elementId of body.elementIds) {
      if (!assignments.has(elementId)) assignments.set(elementId, body.id);
    }
  }
  const provisional: ElementTessellation[] = [];
  for (const group of groups) {
    const bodyId = assignments.get(group.elementId);
    const element: ElementTessellation = {
      id: group.elementId,
      primitiveStart: 0,
      primitiveCount: 1,
    };
    provisional.push(bodyId === undefined ? element : { ...element, bodyId });
  }
  validateBodies({ elements: provisional, ...(bodies === undefined ? {} : { bodies }) });
  return assignments;
}

function validateFaceIndices(records: readonly PolygonRecord[]): void {
  const indices = new Map<ElementId, Set<number>>();
  for (const record of records) {
    let seen = indices.get(record.input.elementId);
    if (seen === undefined) {
      seen = new Set();
      indices.set(record.input.elementId, seen);
    }
    if (seen.has(record.faceIndex)) {
      throw new PolygonGeometryError(
        "invalid-face-metadata",
        `Element ${record.input.elementId} repeats faceIndex ${record.faceIndex}`,
      );
    }
    seen.add(record.faceIndex);
  }
}

function triangleVertices(
  triangle: readonly [NodeId, NodeId, NodeId],
  positions: Float32Array,
): readonly [MeshVertex, MeshVertex, MeshVertex] {
  return triangle.map((nodeId) => ({ point: nodePosition(positions, nodeId), nodeId })) as [
    MeshVertex,
    MeshVertex,
    MeshVertex,
  ];
}

function nodePosition(positions: Float32Array, nodeId: NodeId): readonly [number, number, number] {
  const offset = nodeId * 3;
  return [positions[offset] ?? 0, positions[offset + 1] ?? 0, positions[offset + 2] ?? 0];
}

function faceTessellation(
  record: PolygonRecord,
  bodyId: number | undefined,
  ranges: ReadonlyMap<number, PrimitiveRange>,
): FaceTessellation {
  const range = ranges.get(record.id);
  if (range === undefined) throw new Error(`Polygon face ${record.id} has no primitive range`);
  const face: FaceTessellation = {
    elementId: record.input.elementId,
    faceIndex: record.faceIndex,
    primitiveStart: range.primitiveStart,
    primitiveCount: range.primitiveCount,
    key: record.key,
    nodeIds: [...record.input.nodeIds],
    neighborElementIds: [...(record.input.neighborElementIds ?? [])],
  };
  return bodyId === undefined ? face : { ...face, bodyId };
}
