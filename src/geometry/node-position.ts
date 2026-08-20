import type { NodeId } from "../elements/element";
import { elementModelNodeOrdinal, type ElementModel } from "../elements/model";
import type { Vec3 } from "../math/vec3";

/** Reads one validated element-model node position for geometry construction. */
export function elementNodePosition(model: ElementModel, nodeId: NodeId): Vec3 {
  const ordinal = elementModelNodeOrdinal(model, nodeId);
  if (ordinal === undefined) throw new Error(`Model has no position for node ${nodeId}`);
  const offset = ordinal * 3;
  const x = model.nodes[offset];
  if (x === undefined) throw new Error(`Model has no position for node ${nodeId}`);
  return [x, model.nodes[offset + 1] ?? 0, model.nodes[offset + 2] ?? 0];
}
