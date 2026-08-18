import type { GpuCostAccumulator } from "../diagnostics/cost";
import {
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
  INITIAL_ELEMENT_HIGHLIGHTS,
} from "./highlight-layout";
import {
  highlightByteLength,
  type HighlightPayloadCapacity,
  type HighlightStorage,
} from "./highlight-selection-storage";

/** The capacity inputs for one sparse-plus-dense highlight allocation. */
export interface HighlightCapacityOptions {
  readonly minimumRecords: number;
  readonly selectionSlotCapacity: number;
  readonly selectionRecordCapacity: number;
  readonly selectionWordCapacity: number;
  readonly nodeSelectionSlotCapacity: number;
  readonly nodeSelectionRecordCapacity: number;
  readonly nodeSelectionWordCapacity: number;
  readonly cost: GpuCostAccumulator | undefined;
}

/** The mutable fields changed when an optional highlight allocation is grown. */
export interface HighlightAllocationTarget {
  highlight: HighlightStorage;
  highlightOwned: boolean;
  bindGroup: GPUBindGroup | undefined;
  nodeBindGroup: GPUBindGroup | undefined;
  edgeBindGroup: GPUBindGroup | undefined;
  transparentBindGroup: GPUBindGroup | undefined;
  selectionBindGroup: GPUBindGroup | undefined;
  subsetSelectionBindGroup: GPUBindGroup | undefined;
  nodeSelectionBindGroup: GPUBindGroup | undefined;
  subsetBindGroup?: GPUBindGroup | undefined;
  subsetTransparentBindGroup?: GPUBindGroup | undefined;
}

/** Creates a highlight buffer sized for sparse and dense emphasis payloads. */
export function createHighlightStorage(
  device: GPUDevice,
  sparseCapacity = INITIAL_ELEMENT_HIGHLIGHTS,
  denseCapacity: Partial<Omit<HighlightPayloadCapacity, "sparseCapacity">> = {},
): HighlightStorage {
  const capacity = {
    selectionSlotCapacity: 0,
    selectionRecordCapacity: 0,
    selectionWordCapacity: 0,
    nodeSelectionSlotCapacity: 0,
    nodeSelectionRecordCapacity: 0,
    nodeSelectionWordCapacity: 0,
    ...denseCapacity,
  };
  const size = highlightByteLength({ sparseCapacity, ...capacity });
  return {
    buffer: device.createBuffer({
      label: "femgx element highlight storage",
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    data: new Uint8Array(size),
    sparseCapacity,
    ...capacity,
    denseSelection: undefined,
    denseNodeSelection: undefined,
  };
}

/** Ensures the current highlight allocation can hold the requested payload. */
export function ensureHighlightStorage(
  device: GPUDevice,
  storage: HighlightAllocationTarget,
  options: HighlightCapacityOptions,
): boolean {
  const current = storage.highlight;
  const next = nextCapacity(current, options);
  if (!storage.highlightOwned) {
    storage.highlight = createHighlightStorage(device, next.sparseCapacity, next);
    storage.highlightOwned = true;
    options.cost?.allocateBuffer(storage.highlight.buffer.size);
    invalidateHighlightBindGroups(storage, options.cost);
    return true;
  }
  if (
    next.sparseCapacity === current.sparseCapacity &&
    next.selectionSlotCapacity === current.selectionSlotCapacity &&
    next.selectionRecordCapacity === current.selectionRecordCapacity &&
    next.selectionWordCapacity === current.selectionWordCapacity &&
    next.nodeSelectionSlotCapacity === current.nodeSelectionSlotCapacity &&
    next.nodeSelectionRecordCapacity === current.nodeSelectionRecordCapacity &&
    next.nodeSelectionWordCapacity === current.nodeSelectionWordCapacity
  ) {
    return false;
  }
  const grown = createHighlightStorage(device, next.sparseCapacity, next);
  preserveDenseSelection(current, grown);
  options.cost?.releaseBuffer(current.buffer.size);
  current.buffer.destroy();
  options.cost?.allocateBuffer(grown.buffer.size);
  storage.highlight = grown;
  storage.highlightOwned = true;
  invalidateHighlightBindGroups(storage, options.cost);
  return true;
}

/** Invalidates bind groups whose highlight binding may have changed. */
export function invalidateHighlightBindGroups(
  storage: HighlightAllocationTarget,
  cost?: GpuCostAccumulator,
): void {
  cost?.invalidateBindGroups();
  storage.bindGroup = undefined;
  storage.nodeBindGroup = undefined;
  storage.edgeBindGroup = undefined;
  storage.transparentBindGroup = undefined;
  storage.selectionBindGroup = undefined;
  storage.subsetSelectionBindGroup = undefined;
  storage.nodeSelectionBindGroup = undefined;
  storage.subsetBindGroup = undefined;
  storage.subsetTransparentBindGroup = undefined;
}

function nextCapacity(
  current: HighlightStorage,
  options: HighlightCapacityOptions,
): HighlightPayloadCapacity {
  const releasesSelection =
    options.selectionSlotCapacity === 0 &&
    options.selectionRecordCapacity === 0 &&
    options.selectionWordCapacity === 0 &&
    options.nodeSelectionSlotCapacity === 0 &&
    options.nodeSelectionRecordCapacity === 0 &&
    options.nodeSelectionWordCapacity === 0;
  return {
    sparseCapacity:
      options.minimumRecords <= current.sparseCapacity
        ? current.sparseCapacity
        : Math.max(options.minimumRecords, current.sparseCapacity * 2),
    selectionSlotCapacity: releasesSelection
      ? 0
      : Math.max(current.selectionSlotCapacity, options.selectionSlotCapacity),
    selectionRecordCapacity: releasesSelection
      ? 0
      : Math.max(current.selectionRecordCapacity, options.selectionRecordCapacity),
    selectionWordCapacity: releasesSelection
      ? 0
      : Math.max(current.selectionWordCapacity, options.selectionWordCapacity),
    nodeSelectionSlotCapacity: releasesSelection
      ? 0
      : Math.max(current.nodeSelectionSlotCapacity, options.nodeSelectionSlotCapacity),
    nodeSelectionRecordCapacity: releasesSelection
      ? 0
      : Math.max(current.nodeSelectionRecordCapacity, options.nodeSelectionRecordCapacity),
    nodeSelectionWordCapacity: releasesSelection
      ? 0
      : Math.max(current.nodeSelectionWordCapacity, options.nodeSelectionWordCapacity),
  };
}

/** Preserves dense payloads when sparse table growth changes their offsets. */
function preserveDenseSelection(current: HighlightStorage, next: HighlightStorage): void {
  if (
    current.selectionSlotCapacity !== next.selectionSlotCapacity ||
    current.selectionRecordCapacity !== next.selectionRecordCapacity ||
    current.selectionWordCapacity !== next.selectionWordCapacity ||
    current.nodeSelectionSlotCapacity !== next.nodeSelectionSlotCapacity ||
    current.nodeSelectionRecordCapacity !== next.nodeSelectionRecordCapacity ||
    current.nodeSelectionWordCapacity !== next.nodeSelectionWordCapacity
  ) {
    return;
  }
  copyDenseSelectionSection(current, next, "element");
  copyDenseSelectionSection(current, next, "node");
  next.denseSelection = current.denseSelection;
  next.denseNodeSelection = current.denseNodeSelection;
}

function copyDenseSelectionSection(
  current: HighlightStorage,
  next: HighlightStorage,
  kind: "element" | "node",
): void {
  const currentOffsets = denseSectionOffsets(current, kind);
  const nextOffsets = denseSectionOffsets(next, kind);
  const slotCapacity =
    kind === "element" ? current.selectionSlotCapacity : current.nodeSelectionSlotCapacity;
  const recordCapacity =
    kind === "element" ? current.selectionRecordCapacity : current.nodeSelectionRecordCapacity;
  const wordCapacity =
    kind === "element" ? current.selectionWordCapacity : current.nodeSelectionWordCapacity;
  const slotBytes = slotCapacity * Uint32Array.BYTES_PER_ELEMENT;
  const bitBytes = recordCapacity * wordCapacity * Uint32Array.BYTES_PER_ELEMENT;
  next.data.set(
    current.data.subarray(currentOffsets.offset, currentOffsets.offset + slotBytes),
    nextOffsets.offset,
  );
  next.data.set(
    current.data.subarray(currentOffsets.bits, currentOffsets.bits + bitBytes),
    nextOffsets.bits,
  );
}

function denseSectionOffsets(
  storage: HighlightStorage,
  kind: "element" | "node",
): { readonly offset: number; readonly bits: number } {
  const sparseBytes = storage.sparseCapacity * ELEMENT_RECORD_STRIDE;
  const elementOffset = HIGHLIGHT_HEADER + sparseBytes;
  const elementBits = elementOffset + storage.selectionSlotCapacity * Uint32Array.BYTES_PER_ELEMENT;
  const nodeOffset =
    elementBits +
    storage.selectionRecordCapacity * storage.selectionWordCapacity * Uint32Array.BYTES_PER_ELEMENT;
  const nodeBits = nodeOffset + storage.nodeSelectionSlotCapacity * Uint32Array.BYTES_PER_ELEMENT;
  return kind === "element"
    ? { offset: elementOffset, bits: elementBits }
    : { offset: nodeOffset, bits: nodeBits };
}
