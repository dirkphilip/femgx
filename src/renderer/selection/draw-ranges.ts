import { logicalPrimitiveCount, type Part, type PartId, type Primitive } from "../../geometry/part";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import type { InteractionState } from "../../interaction/interaction";
import { readInteractionState } from "../../interaction/state";
import type { InstanceId } from "../../scene/types";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { DrawCall, SelectionDrawRange } from "../resources/draw-resources";
import type { InstanceLayout } from "../runtime-state";

/** Maximum number of GPU range draws before the instanced fallback wins. */
const MAX_RANGED_SELECTION_DRAWS = 1024;
const PRIMITIVE_ORDER: Readonly<Record<Primitive, number>> = {
  triangles: 0,
  lines: 1,
  points: 2,
};

/**
 * Builds selection calls that reuse the cached geometry index buffer for
 * element/face-only selections. `undefined` retains the ordinary full-part
 * selection draw for targets whose ownership is not a contiguous range.
 */
export function buildSelectionDrawCalls(options: {
  readonly layout: InstanceLayout;
  readonly runtime: PackedSceneRuntime;
  readonly partId: PartId;
  readonly interaction: InteractionState;
  readonly part: Part;
  readonly order: Uint32Array;
}): readonly DrawCall[] | undefined {
  const { layout, runtime, partId, interaction, part, order } = options;
  if (order.length === 0) return [];
  const data = readInteractionState(interaction);
  const slots = layout.partSlots.get(partId);
  if (slots === undefined) return undefined;
  const calls: DrawCall[] = [];
  let rangedDrawCount = 0;
  let groupStart = 0;
  let groupRanges: readonly SelectionDrawRange[] | undefined;
  for (let orderIndex = 0; orderIndex <= order.length; orderIndex += 1) {
    let ranges: readonly SelectionDrawRange[] | undefined;
    if (orderIndex < order.length) {
      const local = order[orderIndex];
      if (local === undefined) return undefined;
      const globalSlot = slots[local];
      const instanceId = globalSlot === undefined ? undefined : runtime.getInstanceId(globalSlot);
      if (instanceId === undefined) return undefined;
      ranges = rangesForInstance(data, instanceId, part);
      if (ranges === undefined || ranges.length === 0) return undefined;
    }
    if (groupRanges !== undefined && !sameRanges(groupRanges, ranges)) {
      // A grouped call is instanced, so its GPU cost is one draw per range,
      // independent of how many selected occurrences share that range set.
      if (rangedDrawCount + groupRanges.length > MAX_RANGED_SELECTION_DRAWS) return undefined;
      calls.push({
        partId,
        instanceCount: orderIndex - groupStart,
        firstInstance: groupStart,
        selectionRanges: groupRanges,
      });
      rangedDrawCount += groupRanges.length;
      groupRanges = undefined;
      groupStart = orderIndex;
    }
    if (ranges !== undefined) groupRanges ??= ranges;
  }
  return calls;
}

function rangesForInstance(
  data: ReturnType<typeof readInteractionState>,
  instanceId: InstanceId,
  part: Part,
): readonly SelectionDrawRange[] | undefined {
  if (
    data.selectedPartIds.has(part.id) ||
    data.selectedInstanceIds.has(instanceId) ||
    (data.selectedBodyIds.get(instanceId)?.size ?? 0) > 0 ||
    (data.selectedBlockIds.get(instanceId)?.size ?? 0) > 0
  ) {
    return undefined;
  }
  // Point parts represent selected nodes with their primary glyph. They need
  // the existing full-part path because node ids are per uploaded corner.
  if ((data.selectedNodeIds.get(instanceId)?.size ?? 0) > 0) return undefined;
  const selectedElements = data.selectedElementIds.get(instanceId);
  const selectedFaces = data.selectedFaces.get(instanceId);
  if ((selectedElements?.size ?? 0) === 0 && (selectedFaces?.size ?? 0) === 0) {
    return undefined;
  }
  const metadata = getPartSemanticIndex(part);
  if ((selectedElements?.size ?? 0) >= metadata.elements.size) return undefined;
  const byPrimitive = new Map<Primitive, number[]>();
  let rangeCount = 0;
  for (const elementId of selectedElements ?? []) {
    const element = metadata.elements.get(elementId);
    if (element === undefined) return undefined;
    for (const range of element.primitiveRanges) {
      const nextRangeCount = addPrimitiveRange(
        byPrimitive,
        rangeCount,
        range.primitive,
        range.primitiveStart,
        range.primitiveCount,
      );
      if (nextRangeCount === undefined) return undefined;
      rangeCount = nextRangeCount;
    }
  }
  for (const [key] of selectedFaces ?? []) {
    const face = metadata.faces.get(key)?.face;
    if (face === undefined) return undefined;
    const nextRangeCount = addPrimitiveRange(
      byPrimitive,
      rangeCount,
      "triangles",
      face.primitiveStart,
      face.primitiveCount,
    );
    if (nextRangeCount === undefined) return undefined;
    rangeCount = nextRangeCount;
  }
  const ranges = materializeRanges(byPrimitive);
  const rangedIndexCount = ranges.reduce((count, range) => count + range.indexCount, 0);
  const fullIndexCount = part.geometries.reduce((count, geometry) => {
    const indicesPerPrimitive = geometry.primitive === "triangles" ? 3 : 6;
    return count + logicalPrimitiveCount(geometry) * indicesPerPrimitive;
  }, 0);
  return rangedIndexCount * 2 < fullIndexCount ? ranges : undefined;
}

function addPrimitiveRange(
  byPrimitive: Map<Primitive, number[]>,
  rangeCount: number,
  primitive: Primitive,
  primitiveStart: number,
  primitiveCount: number,
): number | undefined {
  const indicesPerPrimitive = primitive === "triangles" ? 3 : 6;
  const firstIndex = primitiveStart * indicesPerPrimitive;
  const endIndex = (primitiveStart + primitiveCount) * indicesPerPrimitive;
  const ranges = byPrimitive.get(primitive) ?? [];
  let insertion = 0;
  while (insertion < ranges.length && (ranges[insertion + 1] ?? Infinity) < firstIndex) {
    insertion += 2;
  }
  let mergeEnd = insertion;
  let mergedStart = firstIndex;
  let mergedEnd = endIndex;
  while (mergeEnd < ranges.length && (ranges[mergeEnd] ?? Infinity) <= mergedEnd) {
    mergedStart = Math.min(mergedStart, ranges[mergeEnd] ?? mergedStart);
    mergedEnd = Math.max(mergedEnd, ranges[mergeEnd + 1] ?? mergedEnd);
    mergeEnd += 2;
  }
  const removedCount = (mergeEnd - insertion) / 2;
  const nextRangeCount = rangeCount - removedCount + 1;
  if (nextRangeCount > MAX_RANGED_SELECTION_DRAWS) return undefined;
  const shift = 2 - (mergeEnd - insertion);
  const previousLength = ranges.length;
  if (shift > 0) ranges.length += shift;
  if (shift !== 0) ranges.copyWithin(mergeEnd + shift, mergeEnd, previousLength);
  if (shift < 0) ranges.length += shift;
  ranges[insertion] = mergedStart;
  ranges[insertion + 1] = mergedEnd;
  byPrimitive.set(primitive, ranges);
  return nextRangeCount;
}

function materializeRanges(byPrimitive: Map<Primitive, number[]>): readonly SelectionDrawRange[] {
  const ranges: SelectionDrawRange[] = [];
  for (const [primitive, intervals] of byPrimitive) {
    for (let index = 0; index < intervals.length; index += 2) {
      const firstIndex = intervals[index] ?? 0;
      const endIndex = intervals[index + 1] ?? firstIndex;
      ranges.push({ primitive, firstIndex, indexCount: endIndex - firstIndex });
    }
  }
  return ranges.sort(
    (left, right) =>
      left.firstIndex - right.firstIndex ||
      PRIMITIVE_ORDER[left.primitive] - PRIMITIVE_ORDER[right.primitive],
  );
}

function sameRanges(
  previous: readonly SelectionDrawRange[],
  next: readonly SelectionDrawRange[] | undefined,
): boolean {
  if (next === undefined || previous.length !== next.length) return false;
  return previous.every((range, index) => {
    const candidate = next[index];
    return (
      candidate !== undefined &&
      range.primitive === candidate.primitive &&
      range.firstIndex === candidate.firstIndex &&
      range.indexCount === candidate.indexCount
    );
  });
}
