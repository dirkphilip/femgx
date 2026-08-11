import type { Vec3 } from "../camera/camera";
import { bodyIdForElement, type Geometry, type Part } from "../geometry/part";
import type { FacePickTarget, Instance, NodePickTarget, PartId, PickTarget } from "../scene/types";

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

/** The granularity levels a pick target can be reported at. */
export type PickGranularity = "part" | "instance" | "element" | "face" | "node";

/** Deeper levels are more specific; used to compare granularity. */
const GRANULARITY_DEPTH: Record<PickGranularity, number> = {
  part: 0,
  instance: 1,
  element: 2,
  face: 3,
  node: 4,
};

/** Resolves a 0-based instance slot back to the instance it was drawn from. */
export function resolvePick(instances: readonly Instance[], pickId: number): Instance | undefined {
  if (pickId < 0 || pickId >= instances.length) {
    return undefined;
  }
  return instances[pickId];
}

/**
 * Resolves GPU pick ids to a pick target. By default the most specific level
 * the hit supports (`node` > `face` > `element` > `instance` > `part`) is
 * returned. Passing a `granularity` narrows or promotes the hit to that level:
 * requesting a deeper level than the hit supports falls back to the deepest
 * available, requesting a shallower level returns that level derived from the
 * same hit.
 */
export function resolvePickTarget(
  context: PickContext,
  ids: ResolvedPickIds,
  granularity: PickGranularity = "node",
): PickTarget | undefined {
  const instance = resolvePick(context.instances, ids.instancePickId - 1);
  if (instance === undefined) {
    return undefined;
  }
  const geometry = context.parts.get(instance.partId)?.geometry;
  const deepest = deepestTarget(instance, geometry, ids);
  if (deepest === undefined) {
    return undefined;
  }
  if (GRANULARITY_DEPTH[deepest.kind] <= GRANULARITY_DEPTH[granularity]) {
    return deepest;
  }
  return targetAtGranularity(instance, geometry, ids, granularity);
}

/**
 * Maps a resolved instance to a pick target. When a part has multiple
 * instances the caller may prefer the part-level target.
 */
export function instanceToTarget(instance: Instance, preferPart: boolean): PickTarget {
  return preferPart
    ? { kind: "part", partId: instance.partId }
    : { kind: "instance", instanceId: instance.instanceId };
}

/** Returns the most specific target a hit supports. */
function deepestTarget(
  instance: Instance,
  geometry: Geometry | undefined,
  ids: ResolvedPickIds,
): PickTarget | undefined {
  if (geometry !== undefined && ids.nodePickId > 0) {
    return nodeTarget(instance, geometry, ids);
  }
  if (geometry !== undefined && ids.facePickId > 0) {
    return faceTarget(instance, geometry, ids);
  }
  if (ids.elementPickId > 0) {
    const elementId = ids.elementPickId - 1;
    return {
      kind: "element",
      partId: instance.partId,
      instanceId: instance.instanceId,
      elementId,
      ...bodyFields(geometry, elementId),
    };
  }
  return { kind: "instance", instanceId: instance.instanceId };
}

/** Returns the target at an explicit granularity, when the hit supports it. */
function targetAtGranularity(
  instance: Instance,
  geometry: Geometry | undefined,
  ids: ResolvedPickIds,
  granularity: PickGranularity,
): PickTarget | undefined {
  switch (granularity) {
    case "part":
      return { kind: "part", partId: instance.partId };
    case "instance":
      return { kind: "instance", instanceId: instance.instanceId };
    case "element": {
      if (ids.elementPickId <= 0) return undefined;
      const elementId = ids.elementPickId - 1;
      return {
        kind: "element",
        partId: instance.partId,
        instanceId: instance.instanceId,
        elementId,
        ...bodyFields(geometry, elementId),
      };
    }
    case "face":
      if (geometry === undefined || ids.facePickId <= 0) return undefined;
      return faceTarget(instance, geometry, ids);
    case "node":
      if (geometry === undefined || ids.nodePickId <= 0) return undefined;
      return nodeTarget(instance, geometry, ids);
  }
}

function nodeTarget(instance: Instance, geometry: Geometry, ids: ResolvedPickIds): NodePickTarget {
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
    worldPosition: transformPosition(instance, localPosition),
    neighborElementIds: adjacency.neighborElementIds,
    neighborNodeIds: adjacency.neighborNodeIds,
  };
}

function faceTarget(instance: Instance, geometry: Geometry, ids: ResolvedPickIds): FacePickTarget {
  const faceId = ids.facePickId - 1;
  const face = geometry.faces?.[faceId];
  if (face === undefined) {
    throw new Error(`Part ${instance.partId} has no face descriptor ${faceId}`);
  }
  const worldPoints = face.nodeIds.map((nodeId) =>
    transformPosition(instance, nodePosition(geometry, nodeId)),
  );
  return {
    kind: "face",
    partId: instance.partId,
    instanceId: instance.instanceId,
    elementId: face.elementId,
    ...bodyFields(geometry, face.elementId, face.bodyId),
    faceId: face.id,
    faceIndex: face.faceIndex,
    key: face.key,
    nodeIds: face.nodeIds,
    neighborElementIds: face.neighborElementIds,
    hitPosition: average(worldPoints),
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

function transformPosition(instance: Instance, point: Vec3): Vec3 {
  const [x, y, z] = point;
  const transform = instance.worldTransform;
  const w =
    (transform[3] ?? 0) * x +
    (transform[7] ?? 0) * y +
    (transform[11] ?? 0) * z +
    (transform[15] ?? 0);
  const divisor = w === 0 ? 1 : w;
  return [
    ((transform[0] ?? 0) * x +
      (transform[4] ?? 0) * y +
      (transform[8] ?? 0) * z +
      (transform[12] ?? 0)) /
      divisor,
    ((transform[1] ?? 0) * x +
      (transform[5] ?? 0) * y +
      (transform[9] ?? 0) * z +
      (transform[13] ?? 0)) /
      divisor,
    ((transform[2] ?? 0) * x +
      (transform[6] ?? 0) * y +
      (transform[10] ?? 0) * z +
      (transform[14] ?? 0)) /
      divisor,
  ];
}

function average(points: readonly Vec3[]): Vec3 {
  if (points.length === 0) return [0, 0, 0];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
    z += point[2];
  }
  return [x / points.length, y / points.length, z / points.length];
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
