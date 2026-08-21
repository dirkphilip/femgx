import { transformPoint } from "../math/mat4";
import type { Vec3 } from "../math/vec3";
import { getPartSemanticIndex, type PartSemanticIndex } from "../geometry/part-semantic-index";
import type { Geometry, Part } from "../geometry/part";
import type { GeometryFaces } from "../geometry/semantic/geometry-semantic-capabilities";
import type { PartId } from "../geometry/part";
import type { PartOccurrence } from "../scene/types";
import type {
  EdgePickHit,
  FacePickHit,
  NodePickHit,
  PickAssemblyPathEntry,
  PickHit,
} from "./types";

/** The inputs every pick resolution needs: the drawn instances and their parts. */
export interface PickContext {
  readonly instances: readonly (PartOccurrence | undefined)[];
  readonly parts: ReadonlyMap<PartId, Part>;
  /** Resolves the root-to-direct-owner assembly path for one instance slot. */
  readonly assemblyPath?: (instanceSlot: number) => readonly PickAssemblyPathEntry[];
}

/** The pick ids decoded from a GPU pick pixel (all 1-based, `0` = no hit). */
export interface ResolvedPickIds {
  readonly instancePickId: number;
  readonly elementPickId: number;
  readonly facePickId: number;
  readonly nodePickId: number;
}

/** Resolves a 0-based instance slot back to the instance it was drawn from. */
export function resolvePick(
  instances: readonly (PartOccurrence | undefined)[],
  pickId: number,
): PartOccurrence | undefined {
  if (pickId < 0 || pickId >= instances.length) {
    return undefined;
  }
  return instances[pickId];
}

/**
 * Resolves GPU pick ids to the deepest physical hit supported by the pick
 * attachments. `worldPosition` is reconstructed from the same depth readback
 * and is therefore the displayed point under the pointer, not a face centroid.
 */
export function resolvePickHit(
  context: PickContext,
  ids: ResolvedPickIds,
  worldPosition: Vec3,
): PickHit | undefined {
  const instance = resolvePick(context.instances, ids.instancePickId - 1);
  if (instance === undefined) {
    return undefined;
  }
  const part = context.parts.get(instance.partId);
  return deepestHit(
    instance,
    part,
    ids,
    worldPosition,
    context.assemblyPath?.(ids.instancePickId - 1) ?? [],
  );
}

/** Resolves one private edge id after the optional authored-edge pick pass. */
export function resolveEdgePickHit(
  context: PickContext,
  instancePickId: number,
  edgeKey: string,
  worldPosition: Vec3,
): EdgePickHit | undefined {
  const instance = resolvePick(context.instances, instancePickId - 1);
  const part = instance === undefined ? undefined : context.parts.get(instance.partId);
  const semantic = part === undefined ? undefined : getPartSemanticIndex(part);
  const edge = semantic?.edge(edgeKey);
  if (instance === undefined || edge === undefined) return undefined;
  const first = edge.nodeIds[0];
  const last = edge.nodeIds[edge.nodeIds.length - 1];
  const firstPoint =
    first === undefined
      ? ([0, 0, 0] as const)
      : transformNode(instance, part?.nodePositions, first);
  const lastPoint =
    last === undefined ? ([1, 0, 0] as const) : transformNode(instance, part?.nodePositions, last);
  const delta: Vec3 = [
    lastPoint[0] - firstPoint[0],
    lastPoint[1] - firstPoint[1],
    lastPoint[2] - firstPoint[2],
  ];
  const length = Math.hypot(delta[0], delta[1], delta[2]);
  return {
    kind: "edge",
    ...pathFields(context.assemblyPath?.(instancePickId - 1) ?? []),
    partId: instance.partId,
    partOccurrenceId: instance.partOccurrenceId,
    key: edge.key,
    nodeIds: edge.nodeIds,
    incidentElementIds: edge.incidentElementIds,
    faceRefs: edge.faceRefs,
    worldPosition,
    tangent: length === 0 ? [1, 0, 0] : [delta[0] / length, delta[1] / length, delta[2] / length],
  };
}

function transformNode(
  instance: PartOccurrence,
  positions: Float32Array | undefined,
  nodeId: number,
): Vec3 {
  const offset = nodeId * 3;
  return transformPoint(
    instance.worldTransform,
    positions?.[offset] ?? 0,
    positions?.[offset + 1] ?? 0,
    positions?.[offset + 2] ?? 0,
  );
}

/** Returns the most specific physical hit a pixel supports. */
function deepestHit(
  instance: PartOccurrence,
  part: Part | undefined,
  ids: ResolvedPickIds,
  worldPosition: Vec3,
  assemblyPath: readonly PickAssemblyPathEntry[],
): PickHit {
  const semantic = part === undefined ? undefined : getPartSemanticIndex(part);
  const triangleGeometry = part?.geometries.find((geometry) => geometry.primitive === "triangles");
  if (part !== undefined && semantic !== undefined && ids.nodePickId > 0) {
    if (!validNodeId(semantic, ids.nodePickId - 1)) {
      const elementId = elementIdFromPick(semantic, ids.elementPickId);
      if (elementId !== undefined) {
        return {
          kind: "element",
          ...pathFields(assemblyPath),
          partId: instance.partId,
          partOccurrenceId: instance.partOccurrenceId,
          elementId,
          ...bodyFields(semantic, elementId),
          worldPosition,
        };
      }
      return instanceHit(instance, worldPosition, assemblyPath);
    }
    return nodeHit({ instance, part, semantic, ids, worldPosition, assemblyPath });
  }
  if (part !== undefined && triangleGeometry?.primitive === "triangles" && ids.facePickId > 0) {
    return faceHit({
      instance,
      part,
      geometry: triangleGeometry,
      ids,
      worldPosition,
      assemblyPath,
    });
  }
  if (ids.elementPickId > 0) {
    const elementId = elementIdFromPick(semantic, ids.elementPickId);
    if (elementId === undefined) {
      return instanceHit(instance, worldPosition, assemblyPath);
    }
    return {
      kind: "element",
      ...pathFields(assemblyPath),
      partId: instance.partId,
      partOccurrenceId: instance.partOccurrenceId,
      elementId,
      ...bodyFields(semantic, elementId),
      worldPosition,
    };
  }
  return {
    ...instanceHit(instance, worldPosition, assemblyPath),
  };
}

function instanceHit(
  instance: PartOccurrence,
  worldPosition: Vec3,
  assemblyPath: readonly PickAssemblyPathEntry[],
): PickHit {
  return {
    kind: "partOccurrence",
    ...pathFields(assemblyPath),
    partId: instance.partId,
    partOccurrenceId: instance.partOccurrenceId,
    worldPosition,
  };
}

function validNodeId(semantic: PartSemanticIndex, nodeId: number): boolean {
  return Number.isInteger(nodeId) && nodeId >= 0 && nodeId < semantic.nodeCount;
}

function nodeHit(input: {
  readonly instance: PartOccurrence;
  readonly part: Part;
  readonly semantic: PartSemanticIndex;
  readonly ids: ResolvedPickIds;
  readonly worldPosition: Vec3;
  readonly assemblyPath: readonly PickAssemblyPathEntry[];
}): NodePickHit {
  const { instance, part, semantic, ids, worldPosition, assemblyPath } = input;
  const nodeId = ids.nodePickId - 1;
  const localPosition = nodePosition(part.nodePositions, nodeId);
  const elementId = elementIdFromPick(semantic, ids.elementPickId);
  const triangles = part.geometries.find((geometry) => geometry.primitive === "triangles");
  const faces = triangles?.primitive === "triangles" ? triangles.faces : undefined;
  const adjacency = indexedPartAdjacency(semantic, faces, nodeId);
  return {
    kind: "node",
    ...pathFields(assemblyPath),
    partId: instance.partId,
    partOccurrenceId: instance.partOccurrenceId,
    ...(elementId === undefined ? {} : { elementId }),
    nodeId,
    ...(elementId === undefined ? {} : bodyFields(semantic, elementId)),
    localPosition,
    worldPosition,
    neighborElementIds: adjacency.neighborElementIds,
    neighborNodeIds: adjacency.neighborNodeIds,
  };
}

function elementIdFromPick(
  semantic: PartSemanticIndex | undefined,
  elementPickId: number,
): number | undefined {
  if (elementPickId <= 0) return undefined;
  const elementId = elementPickId - 1;
  return semantic?.hasElement(elementId) === true ? elementId : undefined;
}

function faceHit(input: {
  readonly instance: PartOccurrence;
  readonly part: Part;
  readonly geometry: Extract<Geometry, { primitive: "triangles" }>;
  readonly ids: ResolvedPickIds;
  readonly worldPosition: Vec3;
  readonly assemblyPath: readonly PickAssemblyPathEntry[];
}): FacePickHit {
  const { instance, part, geometry, ids, worldPosition, assemblyPath } = input;
  const faceId = ids.facePickId - 1;
  const face = geometry.faces?.at(faceId);
  if (face === undefined) {
    throw new Error(`Part ${instance.partId} has no face descriptor ${faceId}`);
  }
  const semantic = getPartSemanticIndex(part);
  const worldPoints = face.nodeIds.map((nodeId) =>
    transformPoint(instance.worldTransform, ...nodePosition(part.nodePositions, nodeId)),
  );
  return {
    kind: "face",
    ...pathFields(assemblyPath),
    partId: instance.partId,
    partOccurrenceId: instance.partOccurrenceId,
    elementId: face.elementId,
    ...bodyFields(semantic, face.elementId, face.bodyId),
    faceIndex: face.faceIndex,
    key: face.key,
    nodeIds: face.nodeIds,
    neighborElementIds: face.neighborElementId === undefined ? [] : [face.neighborElementId],
    worldPosition,
    normal: polygonNormal(worldPoints),
  };
}

function pathFields(assemblyPath: readonly PickAssemblyPathEntry[]): {
  readonly assemblyPath?: readonly PickAssemblyPathEntry[];
} {
  return assemblyPath.length === 0 ? {} : { assemblyPath };
}

function bodyFields(
  semantic: PartSemanticIndex | undefined,
  elementId: number,
  explicitBodyId?: number,
): { readonly bodyId?: number } {
  const bodyId = explicitBodyId ?? semantic?.bodyForElement(elementId);
  return bodyId === undefined ? {} : { bodyId };
}

/**
 * Derives the adjacency of a node from the part's face descriptors: the
 * elements whose faces reference the node and the other nodes of those faces.
 */
export function geometryAdjacency(
  geometry: Geometry,
  nodeId: number,
): { readonly neighborElementIds: readonly number[]; readonly neighborNodeIds: readonly number[] } {
  if (geometry.primitive !== "triangles") {
    return { neighborElementIds: [], neighborNodeIds: [] };
  }
  const elementIds = new Set<number>();
  const nodeIds = new Set<number>();
  const faces = geometry.faces;
  if (faces === undefined) return { neighborElementIds: [], neighborNodeIds: [] };
  for (const face of faces) {
    if (!face.nodeIds.includes(nodeId)) continue;
    elementIds.add(face.elementId);
    for (const other of face.nodeIds) {
      if (other !== nodeId) nodeIds.add(other);
    }
  }
  return {
    neighborElementIds: Array.from(elementIds).sort((a, b) => a - b),
    neighborNodeIds: Array.from(nodeIds).sort((a, b) => a - b),
  };
}

function indexedPartAdjacency(
  semantic: PartSemanticIndex,
  faces: GeometryFaces | undefined,
  nodeId: number,
): { readonly neighborElementIds: readonly number[]; readonly neighborNodeIds: readonly number[] } {
  if (faces === undefined) {
    return { neighborElementIds: [], neighborNodeIds: [] };
  }
  const elementIds = new Set<number>();
  const nodeIds = new Set<number>();
  const start = semantic.nodeTriangleFaceOffsets[nodeId] ?? 0;
  const end = semantic.nodeTriangleFaceOffsets[nodeId + 1] ?? start;
  for (let index = start; index < end; index += 1) {
    const face = faces.at(semantic.nodeTriangleFaceIds[index] ?? 0);
    if (face === undefined) continue;
    elementIds.add(face.elementId);
    for (const other of face.nodeIds) {
      if (other !== nodeId) nodeIds.add(other);
    }
  }
  return {
    neighborElementIds: Array.from(elementIds).sort((a, b) => a - b),
    neighborNodeIds: Array.from(nodeIds).sort((a, b) => a - b),
  };
}

/** Returns the local position of a model node, or the origin when unknown. */
function nodePosition(positions: Float32Array | undefined, nodeId: number): Vec3 {
  const offset = nodeId * 3;
  if (positions === undefined) {
    return [0, 0, 0];
  }
  return [positions[offset] ?? 0, positions[offset + 1] ?? 0, positions[offset + 2] ?? 0];
}

/** Newell's polygon normal, oriented by the vertex loop winding. */
function polygonNormal(points: readonly Vec3[]): Vec3 {
  if (points.length < 3) return [0, 0, 1];
  let x = 0;
  let y = 0;
  let z = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) continue;
    x += (current[1] - next[1]) * (current[2] + next[2]);
    y += (current[2] - next[2]) * (current[0] + next[0]);
    z += (current[0] - next[0]) * (current[1] + next[1]);
  }
  const length = Math.hypot(x, y, z);
  return length === 0 ? [0, 0, 1] : [x / length, y / length, z / length];
}
