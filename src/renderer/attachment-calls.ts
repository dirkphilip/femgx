import type { GpuCostAccumulator } from "./diagnostics/cost";
import { buildDrawCalls, type DrawCallLists, type InstanceLayout } from "./runtime-state";

/** Rebuilds the compact per-pass call lists, including the empty attachment state. */
export function rebuildAttachmentCalls(
  layout: InstanceLayout | undefined,
  cost: GpuCostAccumulator,
): DrawCallLists {
  if (layout === undefined) {
    return {
      calls: [],
      transparentCalls: [],
      edgeCalls: [],
      nodeCalls: [],
      selectionCalls: [],
      selectedNodeCalls: [],
    };
  }
  cost.cpu("call-rebuild", 1);
  return buildDrawCalls(layout);
}
