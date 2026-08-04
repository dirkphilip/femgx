import type { InteractionState } from "../interaction/interaction";
import { resolveInstanceStyle } from "../interaction/interaction";
import type { SceneRuntime } from "../scene-runtime/runtime";
import type { PartId } from "../scene/types";
import { encodeInstanceRecord, type InstanceUpdate } from "./gpu-draw";
import { defaultStyle } from "./gpu-support";
import { instanceAt, type InstanceLayout } from "./runtime-state";

/** Per-part record updates plus the parts whose edge overlay membership changed. */
export interface CollectedInstanceUpdates {
  readonly updates: ReadonlyMap<PartId, readonly InstanceUpdate[]>;
  readonly edgeChanged: ReadonlySet<PartId>;
}

/**
 * Encodes the changed instance slots into per-part record updates, patching the
 * given edge-flag mirror and collecting the parts whose resolved `edge` style
 * flipped so the renderer can rebuild their overlay orders.
 */
export function collectInstanceUpdates(
  runtime: SceneRuntime,
  layout: InstanceLayout,
  interaction: InteractionState,
  edgeFlags: boolean[],
  changedInstanceIds: readonly number[],
): CollectedInstanceUpdates {
  const updates = new Map<PartId, InstanceUpdate[]>();
  const edgeChanged = new Set<PartId>();
  for (const slot of changedInstanceIds) {
    if (slot < 0 || slot >= runtime.instanceCount) continue;
    const partId = runtime.instancePartIds[slot];
    const local = layout.slotPartLocal[slot];
    if (partId === undefined || local === undefined || local < 0) continue;
    const style = resolveInstanceStyle(
      instanceAt(runtime, slot, partId),
      defaultStyle,
      interaction,
    );
    if (edgeFlags[slot] !== style.edge) {
      edgeFlags[slot] = style.edge;
      edgeChanged.add(partId);
    }
    const update: InstanceUpdate = {
      slot: local,
      data: encodeInstanceRecord(
        runtime.instanceWorldTransforms.subarray(slot * 16, slot * 16 + 16),
        style,
        slot + 1,
      ),
    };
    const list = updates.get(partId);
    if (list === undefined) {
      updates.set(partId, [update]);
    } else {
      list.push(update);
    }
  }
  return { updates, edgeChanged };
}
