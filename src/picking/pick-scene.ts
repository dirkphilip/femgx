import type { Camera } from "../camera/camera";
import type { Element, ElementId, NodeId } from "../elements/element";
import type { FaceKey } from "../elements/faces";
import { classifyFaces } from "../elements/faces";
import type { ElementModel } from "../elements/model";
import { topologyFor } from "../elements/shapes";
import type { Geometry, Part } from "../geometry/part";
import type { SceneRuntime } from "../scene-runtime/runtime";
import type { PartId } from "../scene/types";
import { rayFromCamera, type Ray } from "./ray";

/**
 * The CPU-side inspection caches that back element/face/node picking. Built
 * once per preset from the parts and their element models, so per-move picking
 * never re-derives triangle→element maps, node adjacency, or face ownership.
 */

/** Inputs shared by every CPU pick: the runtime view and the pointer position. */
export interface PickRequest {
  readonly runtime: SceneRuntime;
  readonly camera: Camera;
  readonly x: number;
  readonly y: number;
}

/** Returns the world ray for a pick request. */
export function requestRay(request: PickRequest): Ray {
  return rayFromCamera(request.camera, request.x, request.y);
}

/** Per-part inspection caches built once per preset for CPU picking. */
export interface PickScene {
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly elementModels: ReadonlyMap<PartId, ElementModel>;
  readonly inspections: ReadonlyMap<PartId, PartInspection>;
}

interface PartInspection {
  /** Triangle → element id + 1 (`0` = no element). */
  readonly triangleElementIds: Uint32Array;
  readonly elementsByNode: ReadonlyMap<NodeId, readonly ElementId[]>;
  readonly neighborNodes: ReadonlyMap<NodeId, readonly NodeId[]>;
  readonly faceElements: ReadonlyMap<FaceKey, FaceOwnership>;
}

interface FaceOwnership {
  elementIds: ElementId[];
  readonly boundary: boolean;
}

/** Builds the pick caches for a preset's parts and element models. */
export function createPickScene(
  parts: ReadonlyMap<PartId, Part>,
  elementModels: ReadonlyMap<PartId, ElementModel>,
): PickScene {
  const inspections = new Map<PartId, PartInspection>();
  for (const part of parts.values()) {
    const model = elementModels.get(part.id);
    if (model === undefined) continue;
    inspections.set(part.id, inspectPart(part, model));
  }
  return { parts, elementModels, inspections };
}

function inspectPart(part: Part, model: ElementModel): PartInspection {
  const triangleElementIds = buildTriangleElementIds(part.geometry);
  const elementsByNode = new Map<NodeId, ElementId[]>();
  for (const element of model.elements) {
    for (const nodeId of element.nodeIds) {
      const list = elementsByNode.get(nodeId);
      if (list === undefined) elementsByNode.set(nodeId, [element.id]);
      else list.push(element.id);
    }
  }
  const neighborNodes = new Map<NodeId, NodeId[]>();
  for (const element of model.elements) {
    collectElementNeighbors(element, neighborNodes);
  }
  const faceElements = new Map<FaceKey, FaceOwnership>();
  for (const face of classifyFaces(model.elements)) {
    const current = faceElements.get(face.key);
    if (current === undefined) {
      faceElements.set(face.key, {
        elementIds: [face.elementId],
        boundary: face.boundary,
      });
    } else {
      current.elementIds.push(face.elementId);
    }
  }
  return { triangleElementIds, elementsByNode, neighborNodes, faceElements };
}

function buildTriangleElementIds(geometry: Geometry): Uint32Array {
  const triangleCount = Math.floor(geometry.indices.length / 3);
  const ids = new Uint32Array(triangleCount);
  for (const element of geometry.elements ?? []) {
    const end = element.triangleStart + element.triangleCount;
    for (let triangle = element.triangleStart; triangle < end; triangle++) {
      ids[triangle] = element.id + 1;
    }
  }
  return ids;
}

function collectElementNeighbors(element: Element, neighbors: Map<NodeId, NodeId[]>): void {
  const topology = topologyFor(element.shape);
  const nodeIds = element.nodeIds;
  topology.edges.forEach(([cornerA, cornerB], edgeIndex) => {
    const a = nodeIds[cornerA];
    const b = nodeIds[cornerB];
    if (a === undefined || b === undefined) return;
    if (topology.order >= 2) {
      const midIndex = topology.edgeNodes[edgeIndex];
      const mid = midIndex === undefined ? undefined : nodeIds[midIndex];
      if (mid !== undefined) {
        link(neighbors, a, mid);
        link(neighbors, mid, b);
      }
    }
    link(neighbors, a, b);
  });
}

function link(map: Map<NodeId, NodeId[]>, a: NodeId, b: NodeId): void {
  const list = map.get(a);
  if (list === undefined) map.set(a, [b]);
  else if (!list.includes(b)) list.push(b);
}

/** Which elements share a face and whether it is a mesh boundary. */
export interface FaceOwnershipResult {
  readonly adjacentElementIds: readonly ElementId[];
  readonly boundary: boolean;
}

/** Returns which elements share a face and whether it is a mesh boundary. */
export function faceOwnership(
  scene: PickScene,
  partId: PartId,
  faceKey: FaceKey,
): FaceOwnershipResult | undefined {
  const ownership = scene.inspections.get(partId)?.faceElements.get(faceKey);
  if (ownership === undefined) return undefined;
  return { adjacentElementIds: ownership.elementIds, boundary: ownership.boundary };
}
