import type { PartId } from "../../geometry/part";
import type { GpuBundle } from "../recovery";
import type { InstanceLayout } from "../runtime-state";

/** Mirrors edge-emphasis admission into the global instance-order state. */
export function syncEdgeEmphasisFlags(
  layout: InstanceLayout,
  bundle: GpuBundle,
  affectedParts: ReadonlySet<PartId>,
  flags: boolean[],
): ReadonlySet<PartId> {
  const changed = new Set<PartId>();
  for (const partId of affectedParts) {
    const slots = layout.partSlots.get(partId);
    const storage = bundle.draw.storages.get(partId);
    if (slots === undefined || storage === undefined) continue;
    for (const globalSlot of slots) {
      const localSlot = layout.slotPartLocal[globalSlot] ?? -1;
      const next = storage.edgeEmphasisSlots.has(localSlot);
      if (flags[globalSlot] !== next) {
        flags[globalSlot] = next;
        changed.add(partId);
      }
    }
  }
  return changed;
}
