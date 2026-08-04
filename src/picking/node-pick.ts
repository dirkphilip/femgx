import { projectPoint } from "../camera/camera";
import type { ElementId, NodeId } from "../elements/element";
import { transformPoint } from "../math/mat4";
import type { InstanceId } from "../scene/types";
import type { PickRequest, PickScene } from "./pick-scene";
import type { Vec3 } from "./ray";

/**
 * CPU screen-space node picking: the model nodes nearest the pointer within a
 * fixed screen radius. Node IDs and adjacency come from the per-part element
 * models, so they stay stable across visibility changes and renderer switches.
 */

/** A stable node hit: the node nearest the pointer, in world space. */
export interface NodePick {
  readonly kind: "node";
  readonly slot: number;
  readonly instanceId: InstanceId;
  readonly partId: number;
  readonly nodeId: NodeId;
  readonly position: Vec3;
  readonly adjacentElementIds: readonly ElementId[];
  readonly adjacentNodeIds: readonly NodeId[];
}

/** Returns the node nearest the pointer within a screen radius, or `undefined`. */
export function pickNode(
  scene: PickScene,
  request: PickRequest,
  radius: number,
): NodePick | undefined {
  const visibleSlots = request.runtime.getDrawList();
  let nearest:
    | {
        readonly slot: number;
        readonly partId: number;
        readonly nodeId: NodeId;
        readonly depth: number;
        readonly distance: number;
      }
    | undefined;
  for (const slot of visibleSlots) {
    const partId = request.runtime.instancePartIds[slot];
    if (partId === undefined) continue;
    const model = scene.elementModels.get(partId);
    if (model === undefined) continue;
    const transform = request.runtime.instanceWorldTransforms.subarray(slot * 16, slot * 16 + 16);
    const candidate = nearestScreenNode(model, transform, request, radius);
    if (
      candidate !== undefined &&
      (nearest === undefined ||
        candidate.depth < nearest.depth ||
        (candidate.depth === nearest.depth && candidate.distance < nearest.distance))
    ) {
      nearest = {
        slot,
        partId,
        nodeId: candidate.nodeId,
        depth: candidate.depth,
        distance: candidate.distance,
      };
    }
  }
  if (nearest === undefined) return undefined;
  const inspection = scene.inspections.get(nearest.partId);
  const model = scene.elementModels.get(nearest.partId);
  const world = transformPoint(
    request.runtime.instanceWorldTransforms.subarray(nearest.slot * 16, nearest.slot * 16 + 16),
    model?.nodes[nearest.nodeId * 3] ?? 0,
    model?.nodes[nearest.nodeId * 3 + 1] ?? 0,
    model?.nodes[nearest.nodeId * 3 + 2] ?? 0,
  );
  return {
    kind: "node",
    slot: nearest.slot,
    instanceId: request.runtime.getInstanceId(nearest.slot) ?? String(nearest.slot),
    partId: nearest.partId,
    nodeId: nearest.nodeId,
    position: world,
    adjacentElementIds: inspection?.elementsByNode.get(nearest.nodeId) ?? [],
    adjacentNodeIds: inspection?.neighborNodes.get(nearest.nodeId) ?? [],
  };
}

function nearestScreenNode(
  model: { readonly nodes: Float32Array },
  transform: Float32Array,
  request: PickRequest,
  radius: number,
): { readonly nodeId: NodeId; readonly depth: number; readonly distance: number } | undefined {
  let nearest: { nodeId: NodeId; depth: number; distance: number } | undefined;
  for (let nodeId = 0; nodeId < model.nodes.length / 3; nodeId++) {
    const world = transformPoint(
      transform,
      model.nodes[nodeId * 3] ?? 0,
      model.nodes[nodeId * 3 + 1] ?? 0,
      model.nodes[nodeId * 3 + 2] ?? 0,
    );
    const screen = projectPoint(request.camera, world);
    if (screen === undefined) continue;
    const distance = Math.hypot(screen[0] - request.x, screen[1] - request.y);
    if (distance > radius) continue;
    if (nearest === undefined || screen[2] < nearest.depth) {
      nearest = { nodeId, depth: screen[2], distance };
    }
  }
  return nearest;
}
