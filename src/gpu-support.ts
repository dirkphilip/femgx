import type { InteractionState, ResolvedStyle } from "./interaction";

export interface PartResource {
  readonly vertexBuffer: GPUBuffer;
  readonly indexBuffer: GPUBuffer;
  readonly indexCount: number;
}

export interface BatchResource {
  readonly buffer: GPUBuffer;
  readonly capacity: number;
  data: ArrayBuffer;
  initialized: boolean;
}

export const defaultStyle: ResolvedStyle = {
  color: { r: 0.23, g: 0.51, b: 0.96, a: 1 },
  emissive: 0,
  opacity: 1,
};

export const vertexLayout: GPUVertexBufferLayout = {
  arrayStride: 12,
  attributes: [{ shaderLocation: 0, format: "float32x3", offset: 0 }],
};

/** Creates and uploads a GPU buffer from typed-array data. */
export function createBuffer(
  device: GPUDevice,
  data: ArrayBufferView,
  usage: GPUBufferUsageFlags,
): GPUBuffer {
  const buffer = device.createBuffer({
    size: Math.max(4, data.byteLength),
    usage: usage | GPUBufferUsage.COPY_DST,
  });
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  device.queue.writeBuffer(buffer, 0, bytes);
  return buffer;
}

/** Writes only contiguous byte ranges that changed since the previous frame. */
export function writeChangedBuffer(
  device: GPUDevice,
  resource: BatchResource,
  nextData: ArrayBuffer,
  byteLength: number,
): void {
  const next = new Uint8Array(nextData, 0, byteLength);
  if (!resource.initialized) {
    device.queue.writeBuffer(resource.buffer, 0, next);
    resource.initialized = true;
    resource.data = nextData;
    return;
  }
  const previous = new Uint8Array(resource.data);
  let rangeStart = -1;
  for (let index = 0; index < byteLength; index += 1) {
    const changed = next[index] !== previous[index];
    if (changed && rangeStart < 0) rangeStart = index;
    if ((!changed || index === byteLength - 1) && rangeStart >= 0) {
      const rangeEnd = changed && index === byteLength - 1 ? index + 1 : index;
      device.queue.writeBuffer(resource.buffer, rangeStart, next.subarray(rangeStart, rangeEnd));
      rangeStart = -1;
    }
  }
  resource.data = nextData;
}

/** Creates the empty interaction state used when no overrides are supplied. */
export function createDefaultInteraction(): InteractionState {
  return {
    highlightedPartIds: new Set(),
    highlightedInstanceIds: new Set(),
    selectedPartIds: new Set(),
    selectedInstanceIds: new Set(),
    partOverrides: new Map(),
    instanceOverrides: new Map(),
    theme: { highlighted: {}, selected: {}, hovered: {} },
  };
}

/** Begins the integer render pass used for asynchronous picking. */
export function beginPickPass(
  encoder: GPUCommandEncoder,
  pickTexture: GPUTexture,
  pickDepthTexture: GPUTexture,
): GPURenderPassEncoder {
  return encoder.beginRenderPass({
    colorAttachments: [
      {
        view: pickTexture.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
    depthStencilAttachment: {
      view: pickDepthTexture.createView(),
      depthClearValue: 1,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  });
}
