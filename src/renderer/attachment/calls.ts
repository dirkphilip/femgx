import type { PartId } from "../../geometry/part";
import type { GpuCostAccumulator } from "../diagnostics/cost";
import type { DrawCall } from "../resources/draw-resources";
import {
  appendPartDrawCalls,
  buildDrawCalls,
  emptyDrawCallLists,
  type DrawCallLists,
  type InstanceLayout,
} from "../runtime-state";

export type AttachmentCallLists = {
  readonly [List in keyof DrawCallLists]: readonly DrawCall[];
};

/** Rebuilds the compact per-pass call lists, including the empty attachment state. */
export function rebuildAttachmentCalls(
  layout: InstanceLayout | undefined,
  cost: GpuCostAccumulator,
): DrawCallLists {
  if (layout === undefined) return emptyDrawCallLists();
  cost.cpu("call-rebuild", 1);
  return buildDrawCalls(layout);
}

/** Revises exact changed-part calls while retaining untouched call objects. */
export function reviseAttachmentCalls(
  layout: InstanceLayout,
  previous: AttachmentCallLists,
  changed: ReadonlySet<PartId>,
  cost: GpuCostAccumulator,
): DrawCallLists {
  if (changed.size === 0) {
    return {
      calls: previous.calls.slice(),
      transparentCalls: previous.transparentCalls.slice(),
      edgeCalls: previous.edgeCalls.slice(),
      nodeCalls: previous.nodeCalls.slice(),
      selectionCalls: previous.selectionCalls.slice(),
      selectedNodeCalls: previous.selectedNodeCalls.slice(),
    };
  }
  cost.cpu("call-rebuild", 1);
  const replacements = changedPartCalls(layout, changed);
  return {
    calls: mergeCalls(previous.calls, replacements.calls, changed),
    transparentCalls: mergeCalls(previous.transparentCalls, replacements.transparentCalls, changed),
    edgeCalls: mergeCalls(previous.edgeCalls, replacements.edgeCalls, changed),
    nodeCalls: mergeCalls(previous.nodeCalls, replacements.nodeCalls, changed),
    selectionCalls: mergeCalls(previous.selectionCalls, replacements.selectionCalls, changed),
    selectedNodeCalls: mergeCalls(
      previous.selectedNodeCalls,
      replacements.selectedNodeCalls,
      changed,
    ),
  };
}

function changedPartCalls(layout: InstanceLayout, changed: ReadonlySet<PartId>): DrawCallLists {
  const result = emptyDrawCallLists();
  const partIds = [...changed].sort((left, right) => left - right);
  for (const partId of partIds) appendPartDrawCalls(result, layout, partId);
  return result;
}

function mergeCalls(
  previous: readonly DrawCall[],
  replacements: readonly DrawCall[],
  changed: ReadonlySet<PartId>,
): DrawCall[] {
  const next: DrawCall[] = [];
  let replacement = 0;
  for (const call of previous) {
    if (changed.has(call.partId)) continue;
    while ((replacements[replacement]?.partId ?? Infinity) < call.partId) {
      const nextCall = replacements[replacement++];
      if (nextCall === undefined) throw new Error("Replacement call list is sparse");
      next.push(nextCall);
    }
    next.push(call);
  }
  while (replacement < replacements.length) {
    const nextCall = replacements[replacement++];
    if (nextCall === undefined) throw new Error("Replacement call list is sparse");
    next.push(nextCall);
  }
  return next;
}
