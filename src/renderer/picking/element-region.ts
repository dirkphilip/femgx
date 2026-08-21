import type { ElementRegionSelection } from "../../interaction/element-region-selection";
import type { PartOccurrenceId } from "../../scene/types";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import { sortIndexRows } from "../../math/index-merge-sort";
import type { PickContext } from "../../picking/pick";
import { resolvePick } from "../../picking/pick";
import { decodePickId } from "./pick-format";
import type { PickRegionProbe } from "./region-probe";

const RADIX_BUCKETS = 1 << 16;

/** Reusable private typed storage for one visible element-region query. */
export interface ElementPickScratch {
  readonly inUse: boolean;
  readonly instancePickIds: Uint32Array;
  readonly elementPickIds: Uint32Array;
  readonly sortedInstancePickIds: Uint32Array;
  readonly sortedElementPickIds: Uint32Array;
  readonly radixCounts: Uint32Array;
  readonly count: number;
}

interface MutableElementPickScratch extends ElementPickScratch {
  inUse: boolean;
  instancePickIds: Uint32Array;
  elementPickIds: Uint32Array;
  sortedInstancePickIds: Uint32Array;
  sortedElementPickIds: Uint32Array;
  radixCounts: Uint32Array;
  count: number;
}

interface ElementTile {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly bytesPerRow: number;
  readonly scratch: ElementPickScratch;
  readonly probe?: PickRegionProbe | undefined;
}

interface RadixPassState {
  readonly column: Uint32Array;
  readonly shift: number;
  readonly instances: Uint32Array;
  readonly elements: Uint32Array;
  readonly targetInstances: Uint32Array;
  readonly targetElements: Uint32Array;
  readonly scratch: MutableElementPickScratch;
}

/** Creates private scratch columns. The renderer leases these for sequential region reads. */
export function createElementPickScratch(): ElementPickScratch {
  return {
    inUse: false,
    instancePickIds: new Uint32Array(0),
    elementPickIds: new Uint32Array(0),
    sortedInstancePickIds: new Uint32Array(0),
    sortedElementPickIds: new Uint32Array(0),
    radixCounts: new Uint32Array(0),
    count: 0,
  };
}

/** Leases renderer-owned scratch or creates isolated storage for an overlapping query. */
export function acquireElementPickScratch(
  reusable: ElementPickScratch | undefined,
): ElementPickScratch {
  const scratch = reusable?.inUse === false ? reusable : createElementPickScratch();
  (scratch as MutableElementPickScratch).inUse = true;
  return scratch;
}

/** Releases a completed query without retaining any host-facing result data. */
export function releaseElementPickScratch(scratch: ElementPickScratch): void {
  const mutable = scratch as MutableElementPickScratch;
  mutable.count = 0;
  mutable.inUse = false;
}

/** Decodes one two-attachment tile into typed dense identity columns. */
export function decodeElementRegion(tile: ElementTile): void {
  const { bytes, width, height, bytesPerRow, scratch, probe } = tile;
  if (probe !== undefined) probe.elementDecodedPixels += width * height;
  const elementOffset = bytesPerRow * height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = bytesPerRow * y + x * 4;
      const instance = decodePickId(bytes, offset);
      const element = decodePickId(bytes, elementOffset + offset);
      if (instance !== 0 && element !== 0) appendPair(scratch, instance, element, probe);
    }
  }
}

/** Resolves typed dense pairs into the public occurrence-grouped CSR batch. */
export function resolveElementRegion(
  scratch: ElementPickScratch,
  context: PickContext,
  probe?: PickRegionProbe,
): ElementRegionSelection {
  const mutable = scratch as MutableElementPickScratch;
  sortAndDeduplicate(mutable);
  const count = resolveStableIds(mutable, context);
  const selection = packSelection(mutable, count, context);
  if (probe !== undefined) {
    probe.elementPickIds = count;
    probe.elementPickGroups = selection.partOccurrenceIds.length;
    probe.elementScratchBytes = scratchBytes(mutable);
    probe.elementOutputBytes = selection.offsets.byteLength + selection.elementIds.byteLength;
  }
  return selection;
}

function appendPair(
  scratch: MutableElementPickScratch,
  instance: number,
  element: number,
  probe: PickRegionProbe | undefined,
): void {
  ensurePairCapacity(scratch, scratch.count + 1, probe);
  scratch.instancePickIds[scratch.count] = instance;
  scratch.elementPickIds[scratch.count] = element;
  scratch.count += 1;
}

function ensurePairCapacity(
  scratch: MutableElementPickScratch,
  required: number,
  probe: PickRegionProbe | undefined,
): void {
  if (required <= scratch.instancePickIds.length) return;
  if (probe !== undefined) probe.elementScratchGrowths += 1;
  const capacity = Math.max(required, Math.max(16, scratch.instancePickIds.length * 2));
  scratch.instancePickIds = grownColumn(scratch.instancePickIds, capacity);
  scratch.elementPickIds = grownColumn(scratch.elementPickIds, capacity);
  scratch.sortedInstancePickIds = grownColumn(scratch.sortedInstancePickIds, capacity);
  scratch.sortedElementPickIds = grownColumn(scratch.sortedElementPickIds, capacity);
}

function grownColumn(current: Uint32Array, capacity: number): Uint32Array {
  const next = new Uint32Array(capacity);
  next.set(current);
  return next;
}

function sortAndDeduplicate(scratch: MutableElementPickScratch): void {
  if (scratch.count < 2) return;
  radixSortPairs(scratch);
  let output = 1;
  for (let input = 1; input < scratch.count; input += 1) {
    const instance = scratch.instancePickIds[input] ?? 0;
    const element = scratch.elementPickIds[input] ?? 0;
    if (
      instance === (scratch.instancePickIds[output - 1] ?? 0) &&
      element === (scratch.elementPickIds[output - 1] ?? 0)
    )
      continue;
    scratch.instancePickIds[output] = instance;
    scratch.elementPickIds[output] = element;
    output += 1;
  }
  scratch.count = output;
}

// Four fixed radix passes avoid comparator calls and row objects at million-row scale.
function radixSortPairs(scratch: MutableElementPickScratch): void {
  ensureRadixCounts(scratch);
  let instances = scratch.instancePickIds;
  let elements = scratch.elementPickIds;
  let targetInstances = scratch.sortedInstancePickIds;
  let targetElements = scratch.sortedElementPickIds;
  for (let pass = 0; pass < 4; pass += 1) {
    const column = pass < 2 ? elements : instances;
    const shift = (pass & 1) * 16;
    radixPass({ column, shift, instances, elements, targetInstances, targetElements, scratch });
    [instances, targetInstances] = [targetInstances, instances];
    [elements, targetElements] = [targetElements, elements];
  }
  if (instances !== scratch.instancePickIds) {
    scratch.instancePickIds.set(instances.subarray(0, scratch.count));
    scratch.elementPickIds.set(elements.subarray(0, scratch.count));
  }
}

function ensureRadixCounts(scratch: MutableElementPickScratch): void {
  if (scratch.radixCounts.length === RADIX_BUCKETS) return;
  scratch.radixCounts = new Uint32Array(RADIX_BUCKETS);
}

function radixPass(state: RadixPassState): void {
  const { column, shift, instances, elements, targetInstances, targetElements, scratch } = state;
  const counts = scratch.radixCounts;
  counts.fill(0);
  for (let index = 0; index < scratch.count; index += 1) {
    const bucket = ((column[index] ?? 0) >>> shift) & 0xffff;
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  let offset = 0;
  for (let bucket = 0; bucket < counts.length; bucket += 1) {
    const count = counts[bucket] ?? 0;
    counts[bucket] = offset;
    offset += count;
  }
  for (let index = 0; index < scratch.count; index += 1) {
    const bucket = ((column[index] ?? 0) >>> shift) & 0xffff;
    const output = counts[bucket] ?? 0;
    targetInstances[output] = instances[index] ?? 0;
    targetElements[output] = elements[index] ?? 0;
    counts[bucket] = output + 1;
  }
}

function resolveStableIds(scratch: MutableElementPickScratch, context: PickContext): number {
  let output = 0;
  for (let input = 0; input < scratch.count; input += 1) {
    const instance = resolvePick(context.instances, (scratch.instancePickIds[input] ?? 0) - 1);
    const element = (scratch.elementPickIds[input] ?? 0) - 1;
    const part = instance === undefined ? undefined : context.parts.get(instance.partId);
    if (
      instance === undefined ||
      part === undefined ||
      !getPartSemanticIndex(part).hasElement(element)
    )
      continue;
    scratch.instancePickIds[output] = scratch.instancePickIds[input] ?? 0;
    scratch.elementPickIds[output] = element;
    output += 1;
  }
  scratch.count = output;
  return output;
}

function packSelection(
  scratch: MutableElementPickScratch,
  count: number,
  context: PickContext,
): ElementRegionSelection {
  if (count === 0) return emptyElementRegion();
  const starts = groupStarts(scratch.instancePickIds, count);
  const occurrenceIds = groupOccurrenceIds(starts, scratch.instancePickIds, context);
  const order = sortIndexRows(starts.length, (left, right) => {
    const first = occurrenceIds[left] ?? "";
    const second = occurrenceIds[right] ?? "";
    return first < second ? -1 : first > second ? 1 : 0;
  });
  const partOccurrenceIds = new Array<PartOccurrenceId>(starts.length);
  const offsets = new Uint32Array(starts.length + 1);
  const elementIds = new Uint32Array(count);
  let cursor = 0;
  for (let output = 0; output < order.length; output += 1) {
    const group = order[output] ?? 0;
    const start = starts[group] ?? 0;
    const end = starts[group + 1] ?? count;
    partOccurrenceIds[output] = occurrenceIds[group] ?? "";
    offsets[output] = cursor;
    elementIds.set(scratch.elementPickIds.subarray(start, end), cursor);
    cursor += end - start;
  }
  offsets[partOccurrenceIds.length] = cursor;
  return { kind: "element", count, partOccurrenceIds, offsets, elementIds };
}

function groupStarts(instancePickIds: Uint32Array, count: number): Uint32Array {
  let groups = 1;
  for (let index = 1; index < count; index += 1)
    if (instancePickIds[index] !== instancePickIds[index - 1]) groups += 1;
  const starts = new Uint32Array(groups);
  let group = 0;
  starts[group++] = 0;
  for (let index = 1; index < count; index += 1)
    if (instancePickIds[index] !== instancePickIds[index - 1]) starts[group++] = index;
  return starts;
}

function groupOccurrenceIds(
  starts: Uint32Array,
  instancePickIds: Uint32Array,
  context: PickContext,
): PartOccurrenceId[] {
  const ids = new Array<PartOccurrenceId>(starts.length);
  for (let group = 0; group < starts.length; group += 1) {
    const start = starts[group] ?? 0;
    ids[group] =
      resolvePick(context.instances, (instancePickIds[start] ?? 0) - 1)?.partOccurrenceId ?? "";
  }
  return ids;
}

function emptyElementRegion(): ElementRegionSelection {
  return {
    kind: "element",
    count: 0,
    partOccurrenceIds: [],
    offsets: new Uint32Array([0]),
    elementIds: new Uint32Array(),
  };
}

function scratchBytes(scratch: ElementPickScratch): number {
  return (
    scratch.instancePickIds.byteLength +
    scratch.elementPickIds.byteLength +
    scratch.sortedInstancePickIds.byteLength +
    scratch.sortedElementPickIds.byteLength +
    scratch.radixCounts.byteLength
  );
}
