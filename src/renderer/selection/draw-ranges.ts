import { logicalPrimitiveCount, type Part, type PartId, type Primitive } from "../../geometry/part";
import { getPartSemanticIndex, type PartSemanticIndex } from "../../geometry/part-semantic-index";
import type { InteractionState } from "../../interaction/interaction";
import { readInteractionState } from "../../interaction/state";
import type { PartOccurrenceId } from "../../scene/types";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { DrawCall, SelectionDrawRange } from "../resources/draw-resources";
import type { InstanceLayout } from "../runtime-state";
import {
  denseOccurrenceAtSlot,
  type DenseElementSelection,
  type DenseElementSelections,
} from "./element-selection";
import { hasValidNodeSelection } from "./node-selection";

/** Maximum number of GPU range draws before the instanced fallback wins. */
const MAX_RANGED_SELECTION_DRAWS = 1024;
const PRIMITIVE_ORDER: Readonly<Record<Primitive, number>> = {
  triangles: 0,
  lines: 1,
  points: 2,
};
interface SelectionSkin {
  readonly kind: "skin";
  readonly interfaceRanges: readonly SelectionDrawRange[];
}

type SelectionGeometry = readonly SelectionDrawRange[] | SelectionSkin;

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
  readonly denseSelections: DenseElementSelections;
}): readonly DrawCall[] | undefined {
  const { layout, runtime, partId, interaction, part, order } = options;
  if (order.length === 0) return [];
  const denseSelections = options.denseSelections;
  const data = readInteractionState(interaction);
  const slots = layout.partLocalSlots.get(partId);
  if (slots === undefined) return undefined;
  const calls: DrawCall[] = [];
  let rangedDrawCount = 0;
  let groupStart = 0;
  let groupGeometry: SelectionGeometry | undefined;
  for (let orderIndex = 0; orderIndex <= order.length; orderIndex += 1) {
    let geometry: SelectionGeometry | undefined;
    if (orderIndex < order.length) {
      const local = order[orderIndex];
      if (local === undefined) return undefined;
      const globalSlot = slots[local];
      const instanceId =
        globalSlot === undefined || globalSlot < 0 ? undefined : runtime.getInstanceId(globalSlot);
      if (instanceId === undefined) return undefined;
      geometry = selectionGeometryForInstance(data, instanceId, local, part, denseSelections);
      if (geometry === undefined || (isSelectionRanges(geometry) && geometry.length === 0))
        return undefined;
    }
    if (groupGeometry !== undefined && !sameSelectionGeometry(groupGeometry, geometry)) {
      // A grouped call is instanced, so its GPU cost is one draw per range,
      // independent of how many selected occurrences share that range set.
      const rangeCount = isSelectionRanges(groupGeometry)
        ? groupGeometry.length
        : groupGeometry.interfaceRanges.length;
      if (rangedDrawCount + rangeCount > MAX_RANGED_SELECTION_DRAWS) return undefined;
      appendSelectionCalls(calls, groupGeometry, {
        partId,
        instanceCount: orderIndex - groupStart,
        firstInstance: groupStart,
      });
      rangedDrawCount += rangeCount;
      groupGeometry = undefined;
      groupStart = orderIndex;
    }
    if (geometry !== undefined) groupGeometry ??= geometry;
  }
  return calls;
}

function selectionGeometryForInstance(
  data: ReturnType<typeof readInteractionState>,
  instanceId: PartOccurrenceId,
  localSlot: number,
  part: Part,
  denseSelections: DenseElementSelections,
): SelectionGeometry | undefined {
  if (
    data.selectedPartIds.has(part.id) ||
    data.selectedPartOccurrenceIds.has(instanceId) ||
    (data.selectedBodyIds.get(instanceId)?.size ?? 0) > 0
  ) {
    return undefined;
  }
  const metadata = getPartSemanticIndex(part);
  // Point parts represent selected nodes with their primary glyph. They need
  // the existing full-part path because node ids are per uploaded corner.
  if (hasValidNodeSelection(data.selectedNodeIds.get(instanceId), metadata.nodeCount)) {
    return undefined;
  }
  const selectedElements = data.selectedElementIds.get(instanceId);
  const selectedFaces = data.selectedFaces.get(instanceId);
  if ((selectedElements?.size ?? 0) === 0 && (selectedFaces?.size ?? 0) === 0) {
    return undefined;
  }
  const skin =
    selectedFaces === undefined || selectedFaces.size === 0
      ? denseSelectionSkin(
          selectedElements,
          localSlot,
          part,
          metadata,
          denseSelections.get(part.id),
        )
      : undefined;
  if (skin !== undefined) return skin;
  return fallbackSelectionGeometry(selectedElements, selectedFaces, metadata, part);
}

function fallbackSelectionGeometry(
  selectedElements: ReadonlySet<number> | undefined,
  selectedFaces: ReadonlyMap<string, unknown> | undefined,
  metadata: PartSemanticIndex,
  part: Part,
): SelectionGeometry | undefined {
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

function denseSelectionSkin(
  selectedElements: ReadonlySet<number> | undefined,
  localSlot: number,
  part: Part,
  metadata: PartSemanticIndex,
  denseSelection: DenseElementSelection | undefined,
): SelectionSkin | undefined {
  const elementCount = metadata.elements.size;
  if (
    selectedElements === undefined ||
    selectedElements.size * 2 < elementCount ||
    denseSelection === undefined ||
    denseSelection.elementCount !== elementCount ||
    !metadata.hasBoundaryFaceSubset ||
    !metadata.hasCompleteNeighborTriangleIndex
  )
    return undefined;
  const occurrence = denseOccurrenceAtSlot(denseSelection, localSlot);
  if (occurrence === undefined || occurrence.selectedCount !== selectedElements.size)
    return undefined;
  if (hasSelectedNonTriangle(occurrence.words, metadata.nonTriangleElementOrdinals))
    return undefined;
  if (selectedElements.size === elementCount) return { kind: "skin", interfaceRanges: [] };
  const interfaceRanges = denseInterfaceRanges(part, metadata, occurrence.words);
  return interfaceRanges === undefined ? undefined : { kind: "skin", interfaceRanges };
}

function hasSelectedNonTriangle(words: Uint32Array, ordinals: Uint32Array): boolean {
  for (const ordinal of ordinals) {
    if (isSelectionBitSet(words, ordinal)) return true;
  }
  return false;
}

function denseInterfaceRanges(
  part: Part,
  metadata: PartSemanticIndex,
  words: Uint32Array,
): readonly SelectionDrawRange[] | undefined {
  const triangles = part.geometries.find((geometry) => geometry.primitive === "triangles");
  if (triangles?.primitive !== "triangles" || triangles.faces === undefined) return undefined;
  const offsets = metadata.neighborTriangleFaceOffsets;
  const faceIds = metadata.neighborTriangleFaceIds;
  const intervals: number[] = [];
  let rangeCount = 0;
  for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
    const firstOrdinal = wordIndex * 32 + 1;
    const validBits = Math.min(32, metadata.elements.size - wordIndex * 32);
    if (validBits <= 0) break;
    const mask = validBits === 32 ? 0xffffffff : (1 << validBits) - 1;
    let unselected = (~(words[wordIndex] ?? 0) & mask) >>> 0;
    while (unselected !== 0) {
      const bit = 31 - Math.clz32(unselected & -unselected);
      const ordinal = firstOrdinal + bit;
      const start = offsets[ordinal - 1] ?? 0;
      const end = offsets[ordinal] ?? start;
      for (let index = start; index < end; index += 1) {
        const faceId = faceIds[index];
        const face = faceId === undefined ? undefined : triangles.faces[faceId];
        if (face === undefined) return undefined;
        const ownerOrdinal = metadata.elementOrdinalById.get(face.elementId);
        if (ownerOrdinal === undefined) return undefined;
        if (!isSelectionBitSet(words, ownerOrdinal)) continue;
        const nextRangeCount = addPrimitiveRangeToIntervals(
          intervals,
          rangeCount,
          face.primitiveStart,
          face.primitiveCount,
        );
        if (nextRangeCount === undefined) return undefined;
        rangeCount = nextRangeCount;
      }
      unselected = (unselected & (unselected - 1)) >>> 0;
    }
  }
  return materializeTriangleRanges(intervals);
}

function addPrimitiveRange(
  byPrimitive: Map<Primitive, number[]>,
  rangeCount: number,
  primitive: Primitive,
  primitiveStart: number,
  primitiveCount: number,
): number | undefined {
  const indicesPerPrimitive = primitive === "triangles" ? 3 : 6;
  const ranges = byPrimitive.get(primitive) ?? [];
  const nextRangeCount = addPrimitiveRangeToIntervals(
    ranges,
    rangeCount,
    primitiveStart,
    primitiveCount,
    indicesPerPrimitive,
  );
  if (nextRangeCount !== undefined) byPrimitive.set(primitive, ranges);
  return nextRangeCount;
}

function addPrimitiveRangeToIntervals(
  ranges: number[],
  rangeCount: number,
  primitiveStart: number,
  primitiveCount: number,
  indicesPerPrimitive = 3,
): number | undefined {
  const firstIndex = primitiveStart * indicesPerPrimitive;
  const endIndex = (primitiveStart + primitiveCount) * indicesPerPrimitive;
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
  return nextRangeCount;
}

function materializeTriangleRanges(intervals: readonly number[]): readonly SelectionDrawRange[] {
  const ranges: SelectionDrawRange[] = [];
  for (let index = 0; index < intervals.length; index += 2) {
    const firstIndex = intervals[index] ?? 0;
    const endIndex = intervals[index + 1] ?? firstIndex;
    ranges.push({ primitive: "triangles", firstIndex, indexCount: endIndex - firstIndex });
  }
  return ranges;
}

function isSelectionBitSet(words: Uint32Array, ordinal: number): boolean {
  const bit = ordinal - 1;
  return bit >= 0 && bit < words.length * 32 && ((words[bit >> 5] ?? 0) & (1 << (bit & 31))) !== 0;
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

function sameSelectionGeometry(
  previous: SelectionGeometry,
  next: SelectionGeometry | undefined,
): boolean {
  if (next === undefined || isSelectionRanges(previous) !== isSelectionRanges(next)) return false;
  const previousRanges = isSelectionRanges(previous) ? previous : previous.interfaceRanges;
  const nextRanges = isSelectionRanges(next) ? next : next.interfaceRanges;
  if (previousRanges.length !== nextRanges.length) return false;
  return previousRanges.every((range, index) => {
    const candidate = nextRanges[index];
    return (
      candidate !== undefined &&
      range.primitive === candidate.primitive &&
      range.firstIndex === candidate.firstIndex &&
      range.indexCount === candidate.indexCount
    );
  });
}

function isSelectionRanges(geometry: SelectionGeometry): geometry is readonly SelectionDrawRange[] {
  return Array.isArray(geometry);
}

function appendSelectionCalls(
  calls: DrawCall[],
  geometry: SelectionGeometry,
  group: Pick<DrawCall, "partId" | "instanceCount" | "firstInstance">,
): void {
  if (isSelectionRanges(geometry)) {
    calls.push({ ...group, selectionRanges: geometry });
    return;
  }
  calls.push({ ...group, surfaceSubset: true });
  if (geometry.interfaceRanges.length > 0) {
    calls.push({ ...group, surfaceSubset: true, selectionRanges: geometry.interfaceRanges });
  }
}
