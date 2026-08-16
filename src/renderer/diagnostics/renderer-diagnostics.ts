import type { PartId } from "../../geometry/part";
import type { GpuCostAccumulator } from "./cost";
import type { DrawResources } from "../resources/draw-resources";

/** Returns the part ids with materialized optional edge geometry. */
export function materializedEdgePartIds(draw: DrawResources): ReadonlySet<PartId> {
  return new Set(
    [...draw.primitiveParts].flatMap(([partId, resources]) =>
      resources.get("triangles")?.edge === undefined ? [] : [partId],
    ),
  );
}

/** Returns the current internal draw-cost snapshot. */
export function drawCostSnapshot(cost: GpuCostAccumulator) {
  return cost.snapshot();
}
