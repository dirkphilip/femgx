import type { HighlightStorage } from "../../selection/highlight-storage";
import type {
  InstanceOrderStorage,
  InstanceSidecars,
  InstanceStorage,
  InstanceStorageOwner,
} from "../instance-storage";

/** Creates detached replacement storage so a fallible revision cannot disturb live buffers. */
export function cloneInstanceStorage(
  draw: InstanceStorageOwner,
  source: InstanceStorage,
): InstanceStorage {
  const allocated: GPUBuffer[] = [];
  try {
    const storage = createDetachedStorage(draw, source, allocated);
    writeDetachedStorage(draw, storage);
    return storage;
  } catch (error) {
    releaseDetachedBuffers(draw, allocated);
    throw error;
  }
}

/** Releases staged storage that was never installed in the live part map. */
export function destroyDetachedInstanceStorage(
  draw: InstanceStorageOwner,
  storage: InstanceStorage,
): void {
  const buffers = [storage.buffer, storage.orderBuffer, ...sidecarBuffers(storage.sidecars)];
  if (storage.highlightOwned) buffers.push(storage.highlight.buffer);
  releaseDetachedBuffers(draw, buffers);
}

function createDetachedStorage(
  draw: InstanceStorageOwner,
  source: InstanceStorage,
  allocated: GPUBuffer[],
): InstanceStorage {
  const sidecars = cloneSidecars(draw, source.sidecars, allocated);
  const highlight = source.highlightOwned
    ? cloneHighlight(draw, source.highlight, allocated)
    : draw.emptyHighlight;
  return {
    buffer: allocateDetachedBuffer(
      draw,
      source.buffer.size,
      "femgx staged instance storage",
      allocated,
    ),
    orderBuffer: allocateDetachedBuffer(
      draw,
      source.orderBuffer.size,
      "femgx staged instance order",
      allocated,
    ),
    emptyOrderBuffer: draw.emptyOrderBuffer,
    emptyHighlight: draw.emptyHighlight,
    sidecars,
    highlight,
    highlightOwned: source.highlightOwned,
    capacity: source.capacity,
    data: source.data.slice(0),
    emphasisSlots: new Set(source.emphasisSlots),
    edgeEmphasisSlots: new Set(source.edgeEmphasisSlots),
    orderData: source.orderData.slice(),
    orderLength: source.orderLength,
    bindGroup: undefined,
    minimalBindGroup: undefined,
    minimalTransparentBindGroup: undefined,
    nodeBindGroup: undefined,
    edgeBindGroup: undefined,
    transparentBindGroup: undefined,
    selectionBindGroup: undefined,
    subsetSelectionBindGroup: undefined,
    nodeSelectionBindGroup: undefined,
    subsetBindGroup: undefined,
    subsetTransparentBindGroup: undefined,
  };
}

function cloneSidecars(
  draw: InstanceStorageOwner,
  source: InstanceSidecars,
  allocated: GPUBuffer[],
): InstanceSidecars {
  return {
    transparent: cloneSidecar(draw, source.transparent, "transparent", allocated),
    selection: cloneSidecar(draw, source.selection, "selection", allocated),
    nodeSelection: cloneSidecar(draw, source.nodeSelection, "node selection", allocated),
    edge: cloneSidecar(draw, source.edge, "edge", allocated),
    node: cloneSidecar(draw, source.node, "node", allocated),
  };
}

function cloneSidecar(
  draw: InstanceStorageOwner,
  source: InstanceOrderStorage | undefined,
  label: string,
  allocated: GPUBuffer[],
): InstanceOrderStorage | undefined {
  if (source === undefined) return undefined;
  return {
    buffer: allocateDetachedBuffer(
      draw,
      source.buffer.size,
      `femgx staged ${label} order`,
      allocated,
    ),
    data: source.data.slice(),
    capacity: source.capacity,
    length: source.length,
  };
}

function cloneHighlight(
  draw: InstanceStorageOwner,
  source: HighlightStorage,
  allocated: GPUBuffer[],
): HighlightStorage {
  return {
    ...source,
    buffer: allocateDetachedBuffer(
      draw,
      source.buffer.size,
      "femgx staged element highlight storage",
      allocated,
    ),
    data: source.data.slice(),
  };
}

function allocateDetachedBuffer(
  draw: InstanceStorageOwner,
  size: number,
  label: string,
  allocated: GPUBuffer[],
): GPUBuffer {
  const buffer = draw.device.createBuffer({
    label,
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  allocated.push(buffer);
  draw.cost.allocateBuffer(buffer.size);
  return buffer;
}

function writeDetachedStorage(draw: InstanceStorageOwner, storage: InstanceStorage): void {
  writeDetachedBuffer(draw, storage.buffer, new Uint8Array(storage.data), "instance");
  writeDetachedOrder(draw, storage.orderBuffer, storage.orderData, storage.orderLength);
  for (const sidecar of sidecars(storage.sidecars)) {
    if (sidecar !== undefined)
      writeDetachedOrder(draw, sidecar.buffer, sidecar.data, sidecar.length);
  }
  if (storage.highlightOwned) {
    writeDetachedBuffer(draw, storage.highlight.buffer, storage.highlight.data, "highlight");
  }
}

function sidecars(sidecars: InstanceSidecars): readonly (InstanceOrderStorage | undefined)[] {
  return [
    sidecars.transparent,
    sidecars.selection,
    sidecars.nodeSelection,
    sidecars.edge,
    sidecars.node,
  ];
}

function sidecarBuffers(values: InstanceSidecars): GPUBuffer[] {
  return sidecars(values)
    .filter((sidecar): sidecar is InstanceOrderStorage => sidecar !== undefined)
    .map((sidecar) => sidecar.buffer);
}

function writeDetachedOrder(
  draw: InstanceStorageOwner,
  buffer: GPUBuffer,
  data: Uint32Array,
  length: number,
): void {
  if (length > 0) writeDetachedBuffer(draw, buffer, data.subarray(0, length), "order");
}

function writeDetachedBuffer(
  draw: InstanceStorageOwner,
  buffer: GPUBuffer,
  data: ArrayBufferView,
  category: "instance" | "order" | "highlight",
): void {
  if (data.byteLength === 0) return;
  draw.device.queue.writeBuffer(buffer, 0, data);
  draw.cost.write(category, data.byteLength);
}

function releaseDetachedBuffers(draw: InstanceStorageOwner, buffers: readonly GPUBuffer[]): void {
  for (const buffer of new Set(buffers)) {
    draw.cost.releaseBuffer(buffer.size);
    buffer.destroy();
  }
}
