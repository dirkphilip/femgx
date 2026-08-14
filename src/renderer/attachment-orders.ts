import type { PartId } from "../geometry/part";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import { buildEdgeOrder, buildTransparentOrder, type InstanceLayout } from "./runtime-state";
import { writeEdgeOrder, writeTransparentOrder, type DrawResources } from "./gpu-draw";

/** Rebuilds transparent instance orders for the affected reusable parts. */
export function rebuildTransparentOrders(
  runtime: PackedSceneRuntime,
  layout: InstanceLayout,
  parts: ReadonlySet<PartId>,
  flags: readonly boolean[],
  draw: DrawResources,
): void {
  for (const partId of parts) {
    draw.cost.cpu("order-rebuild", 1);
    const order = buildTransparentOrder(layout, runtime, partId, flags);
    writeTransparentOrder(draw, partId, order);
    layout.partTransparentCounts.set(partId, order.length);
  }
}

/** Rebuilds edge instance orders for the affected reusable parts. */
export function rebuildEdgeOrders(
  runtime: PackedSceneRuntime,
  layout: InstanceLayout,
  parts: ReadonlySet<PartId>,
  flags: readonly boolean[],
  draw: DrawResources,
): void {
  for (const partId of parts) {
    draw.cost.cpu("order-rebuild", 1);
    const order = buildEdgeOrder(layout, runtime, partId, flags);
    writeEdgeOrder(draw, partId, order);
    layout.partEdgeCounts.set(partId, order.length);
  }
}
