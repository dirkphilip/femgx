import type { InteractionState } from "../interaction/interaction";
import { resolveInstanceStyle } from "../interaction/interaction";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { PartId } from "../geometry/part";
import { encodeInstanceRecord, type InstanceUpdate } from "./gpu-draw";
import { defaultStyle } from "./gpu-support";
import { instanceAt, type InstanceLayout } from "./runtime-state";

/** Per-part record updates plus the parts whose overlay membership changed. */
export interface CollectedInstanceUpdates {
  readonly updates: ReadonlyMap<PartId, readonly InstanceUpdate[]>;
  readonly edgeChanged: ReadonlySet<PartId>;
  readonly nodeChanged: ReadonlySet<PartId>;
  readonly transparentChanged: ReadonlySet<PartId>;
}

/** Mutable mirrors used to detect draw-list membership changes. */
export interface InstanceStyleFlags {
  readonly edgeFlags: boolean[];
  readonly nodeFlags: boolean[];
  readonly transparentFlags: boolean[];
}

/**
 * Encodes the changed instance slots into per-part record updates, patching the
 * given style-flag mirrors and collecting the parts whose resolved overlay
 * styles flipped so the renderer can rebuild their order lists.
 */
export function collectInstanceUpdates(
  runtime: PackedSceneRuntime,
  layout: InstanceLayout,
  interaction: InteractionState,
  flags: InstanceStyleFlags,
  changedInstanceIds: readonly number[],
): CollectedInstanceUpdates {
  const updates = new Map<PartId, InstanceUpdate[]>();
  const edgeChanged = new Set<PartId>();
  const nodeChanged = new Set<PartId>();
  const transparentChanged = new Set<PartId>();
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
    if (flags.edgeFlags[slot] !== style.edge) {
      flags.edgeFlags[slot] = style.edge;
      edgeChanged.add(partId);
    }
    if (flags.nodeFlags[slot] !== style.nodes) {
      flags.nodeFlags[slot] = style.nodes;
      nodeChanged.add(partId);
    }
    const transparent = style.color.a * style.opacity < 1;
    if (flags.transparentFlags[slot] !== transparent) {
      flags.transparentFlags[slot] = transparent;
      transparentChanged.add(partId);
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
  return { updates, edgeChanged, nodeChanged, transparentChanged };
}
