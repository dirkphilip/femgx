import { transformPoint } from "../math/mat4";
import type { Vec3 } from "../math/vec3";
import { bodyIdForElement, type Geometry, type Part } from "../geometry/part";
import type { PartId } from "../geometry/part";
import type { Instance } from "../scene/types";
import type { EdgePickHit, FacePickHit, NodePickHit, PickHit } from "./types";

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
  const part = context.parts.get(instance.partId);
  return deepestHit(instance, part, ids, worldPosition);
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
  const edge = part?.geometries
    .flatMap((geometry) => geometry.edges ?? [])
    .find((candidate) => candidate.key === edgeKey);
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
    partId: instance.partId,
    instanceId: instance.instanceId,
    key: edge.key,
    nodeIds: edge.nodeIds,
    incidentElementIds: edge.incidentElementIds,
    faceRefs: edge.faceRefs,
    worldPosition,
    tangent: length === 0 ? [1, 0, 0] : [delta[0] / length, delta[1] / length, delta[2] / length],
  };
}

function transformNode(
  instance: Instance,
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
  instance: Instance,
  part: Part | undefined,
  ids: ResolvedPickIds,
  worldPosition: Vec3,
): PickHit {
  const geometry = part === undefined ? undefined : geometryForHit(part, ids);
  if (part !== undefined && ids.nodePickId > 0) {
    if (!validNodeId(part, ids.nodePickId - 1)) return instanceHit(instance, worldPosition);
    return nodeHit(instance, part, ids, worldPosition);
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
      ...bodyFields(part, elementId),
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

function validNodeId(part: Part, nodeId: number): boolean {
  const nodeCount = (part.nodePositions?.length ?? 0) / 3;
  return Number.isInteger(nodeId) && nodeId >= 0 && nodeId < nodeCount;
}

function nodeHit(
  instance: Instance,
  part: Part,
  ids: ResolvedPickIds,
  worldPosition: Vec3,
): NodePickHit {
  const nodeId = ids.nodePickId - 1;
  const localPosition = nodePosition(part.nodePositions, nodeId);
  const elementId = elementIdFromPick(part, ids.elementPickId);
  const adjacency = partAdjacency(part, nodeId);
  return {
    kind: "node",
    partId: instance.partId,
    instanceId: instance.instanceId,
    ...(elementId === undefined ? {} : { elementId }),
    nodeId,
    ...(elementId === undefined ? {} : bodyFields(part, elementId)),
    localPosition,
    worldPosition,
    neighborElementIds: adjacency.neighborElementIds,
    neighborNodeIds: adjacency.neighborNodeIds,
  };
}

function elementIdFromPick(part: Part, elementPickId: number): number | undefined {
  if (elementPickId <= 0) return undefined;
  const elementId = elementPickId - 1;
  return part.elements?.some((element) => element.id === elementId) ? elementId : undefined;
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
    transformPoint(instance.worldTransform, ...nodePosition(geometry.nodePositions, nodeId)),
  );
  return {
    kind: "face",
    partId: instance.partId,
    instanceId: instance.instanceId,
    elementId: face.elementId,
    ...bodyFields(geometry, face.elementId, face.bodyId, face.blockId),
    faceIndex: face.faceIndex,
    key: face.key,
    nodeIds: face.nodeIds,
    neighborElementIds: face.neighborElementIds,
    worldPosition,
    normal: polygonNormal(worldPoints),
  };
}

function bodyFields(
  source: Part | Geometry | undefined,
  elementId: number,
  explicitBodyId?: number,
  explicitBlockId?: number,
): { readonly bodyId?: number; readonly blockId?: number } {
  const geometries =
    source === undefined ? [] : "geometries" in source ? source.geometries : [source];
  const element = geometries
    .flatMap((geometry) => geometry.elements ?? [])
    .find((candidate) => candidate.id === elementId);
  const bodyId =
    explicitBodyId ??
    (source === undefined
      ? undefined
      : "geometries" in source
        ? (source.elements?.find((candidate) => candidate.id === elementId)?.bodyId ??
          source.bodies?.find((body) => body.elementIds.includes(elementId))?.id)
        : bodyIdForElement(source, elementId));
  const blockId =
    explicitBlockId ??
    element?.blockId ??
    geometries
      .flatMap((geometry) => geometry.blocks ?? [])
      .find((block) => block.elementIds.includes(elementId))?.id;
  return {
    ...(bodyId === undefined ? {} : { bodyId }),
    ...(blockId === undefined ? {} : { blockId }),
  };
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

function geometryForHit(part: Part, ids: ResolvedPickIds): Geometry | undefined {
  if (ids.nodePickId > 0) {
    const nodeGeometry = part.geometries.find((geometry) =>
      geometry.nodePickIds?.some((pickId) => pickId === ids.nodePickId),
    );
    if (nodeGeometry !== undefined) return nodeGeometry;
  }
  if (ids.facePickId > 0) {
    const triangle = part.geometries.find((geometry) => geometry.primitive === "triangles");
    if (triangle !== undefined) return triangle;
  }
  const elementId = ids.elementPickId - 1;
  return part.geometries.find((geometry) =>
    geometry.elements?.some((element) => element.id === elementId),
  );
}

function partAdjacency(
  part: Part,
  nodeId: number,
): { readonly neighborElementIds: readonly number[]; readonly neighborNodeIds: readonly number[] } {
  const elementIds = new Set<number>();
  const nodeIds = new Set<number>();
  for (const geometry of part.geometries) {
    if (geometry.primitive === "triangles") {
      const adjacency = geometryAdjacency(geometry, nodeId);
      for (const elementId of adjacency.neighborElementIds) elementIds.add(elementId);
      for (const neighborNodeId of adjacency.neighborNodeIds) nodeIds.add(neighborNodeId);
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
    const current = points[index] as Vec3;
    const next = points[(index + 1) % points.length] as Vec3;
    x += (current[1] - next[1]) * (current[2] + next[2]);
    y += (current[2] - next[2]) * (current[0] + next[0]);
    z += (current[0] - next[0]) * (current[1] + next[1]);
  }
  const length = Math.hypot(x, y, z);
  return length === 0 ? [0, 0, 1] : [x / length, y / length, z / length];
}
