import { transformPoint } from "../math/mat4";
import type { Vec3 } from "../math/vec3";
import { bodyIdForElement, type Geometry, type Part } from "../geometry/part";
import type { PartId } from "../geometry/part";
import type { Instance } from "../scene/types";
import type { FacePickHit, NodePickHit, PickHit } from "./types";

/** The inputs every pick resolution needs: the drawn instances and their parts. */
export interface PickContext {
  readonly instances: readonly Instance[];
  readonly parts: ReadonlyMap<PartId, Part>;
}

/** The pick ids decoded from a GPU pick pixel (all 1-based, `0` = no hit). */
export interface ResolvedPickIds {
  readonly instancePickId: number;
  readonly elementPickId: number;
  readonly facePickId: number;
  readonly nodePickId: number;
}

/** Resolves a 0-based instance slot back to the instance it was drawn from. */
export function resolvePick(instances: readonly Instance[], pickId: number): Instance | undefined {
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
  const geometry = context.parts.get(instance.partId)?.geometry;
  return deepestHit(instance, geometry, ids, worldPosition);
}

/** Returns the most specific physical hit a pixel supports. */
function deepestHit(
  instance: Instance,
  geometry: Geometry | undefined,
  ids: ResolvedPickIds,
  worldPosition: Vec3,
): PickHit {
  if (geometry !== undefined && ids.nodePickId > 0) {
    if (!validNodeId(geometry, ids.nodePickId - 1)) return instanceHit(instance, worldPosition);
    return nodeHit(instance, geometry, ids, worldPosition);
  }
  if (geometry?.primitive === "triangles" && ids.facePickId > 0) {
    return faceHit(instance, geometry, ids, worldPosition);
  }
  if (ids.elementPickId > 0) {
    const elementId = ids.elementPickId - 1;
    if (!geometry?.elements?.some((element) => element.id === elementId)) {
      return instanceHit(instance, worldPosition);
    }
    return {
      kind: "element",
      partId: instance.partId,
      instanceId: instance.instanceId,
      elementId,
      ...bodyFields(geometry, elementId),
      worldPosition,
    };
  }
  return {
    ...instanceHit(instance, worldPosition),
  };
}

function instanceHit(instance: Instance, worldPosition: Vec3): PickHit {
  return {
    kind: "instance",
    partId: instance.partId,
    instanceId: instance.instanceId,
    worldPosition,
  };
}

function validNodeId(geometry: Geometry, nodeId: number): boolean {
  const nodeCount = (geometry.nodePositions?.length ?? 0) / 3;
  return Number.isInteger(nodeId) && nodeId >= 0 && nodeId < nodeCount;
}

function nodeHit(
  instance: Instance,
  geometry: Geometry,
  ids: ResolvedPickIds,
  worldPosition: Vec3,
): NodePickHit {
  const nodeId = ids.nodePickId - 1;
  const localPosition = nodePosition(geometry, nodeId);
  const elementId =
    ids.elementPickId > 0 ? ids.elementPickId - 1 : (geometry.elements?.[0]?.id ?? 0);
  const adjacency = geometryAdjacency(geometry, nodeId);
  return {
    kind: "node",
    partId: instance.partId,
    instanceId: instance.instanceId,
    elementId,
    nodeId,
    ...bodyFields(geometry, elementId),
    localPosition,
    worldPosition,
    neighborElementIds: adjacency.neighborElementIds,
    neighborNodeIds: adjacency.neighborNodeIds,
  };
}

function faceHit(
  instance: Instance,
  geometry: Extract<Geometry, { primitive: "triangles" }>,
  ids: ResolvedPickIds,
  worldPosition: Vec3,
): FacePickHit {
  const faceId = ids.facePickId - 1;
  const face = geometry.faces?.[faceId];
  if (face === undefined) {
    throw new Error(`Part ${instance.partId} has no face descriptor ${faceId}`);
  }
  const worldPoints = face.nodeIds.map((nodeId) =>
    transformPoint(instance.worldTransform, ...nodePosition(geometry, nodeId)),
  );
  return {
    kind: "face",
    partId: instance.partId,
    instanceId: instance.instanceId,
    elementId: face.elementId,
    ...bodyFields(geometry, face.elementId, face.bodyId),
    faceIndex: face.faceIndex,
    key: face.key,
    nodeIds: face.nodeIds,
    neighborElementIds: face.neighborElementIds,
    worldPosition,
    normal: polygonNormal(worldPoints),
  };
}

function bodyFields(
  geometry: Geometry | undefined,
  elementId: number,
  explicitBodyId?: number,
): { readonly bodyId: number } | Record<never, never> {
  const bodyId =
    explicitBodyId ?? (geometry === undefined ? undefined : bodyIdForElement(geometry, elementId));
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
  for (const face of geometry.faces ?? []) {
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

/** Returns the local position of a model node, or the origin when unknown. */
function nodePosition(geometry: Geometry, nodeId: number): Vec3 {
  const offset = nodeId * 3;
  const positions = geometry.nodePositions;
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
    const current = points[index] as Vec3;
    const next = points[(index + 1) % points.length] as Vec3;
    x += (current[1] - next[1]) * (current[2] + next[2]);
    y += (current[2] - next[2]) * (current[0] + next[0]);
    z += (current[0] - next[0]) * (current[1] + next[1]);
  }
  const length = Math.hypot(x, y, z);
  return length === 0 ? [0, 0, 1] : [x / length, y / length, z / length];
}
