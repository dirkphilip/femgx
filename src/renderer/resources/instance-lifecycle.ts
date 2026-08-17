import type { PartId } from "../../geometry/part";
import type { DrawResources } from "./draw-types";

/** Releases all per-placement instance and highlight buffers while retaining geometry. */
export function destroyInstanceResources(draw: DrawResources): void {
  for (const partId of [...draw.storages.keys()]) destroyInstancePartResources(draw, partId);
}

/** Releases one part's placement and highlight buffers while retaining geometry. */
export function destroyInstancePartResources(draw: DrawResources, partId: PartId): void {
  const storage = draw.storages.get(partId);
  if (storage === undefined) return;
  draw.cost.releaseBuffer(storage.buffer.size);
  draw.cost.releaseBuffer(storage.orderBuffer.size);
  storage.buffer.destroy();
  storage.orderBuffer.destroy();
  for (const sidecar of [
    storage.sidecars.transparent,
    storage.sidecars.selection,
    storage.sidecars.nodeSelection,
    storage.sidecars.edge,
    storage.sidecars.node,
  ]) {
    if (sidecar === undefined) continue;
    draw.cost.releaseBuffer(sidecar.buffer.size);
    sidecar.buffer.destroy();
  }
  if (storage.highlightOwned) {
    draw.cost.releaseBuffer(storage.highlight.buffer.size);
    storage.highlight.buffer.destroy();
  }
  draw.storages.delete(partId);
}
