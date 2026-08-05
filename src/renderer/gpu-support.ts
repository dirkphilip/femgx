import {
  createInteractionState,
  type InteractionState,
  type ResolvedStyle,
} from "../interaction/interaction";

export interface PartResource {
  readonly vertexBuffer: GPUBuffer;
  readonly indexBuffer: GPUBuffer;
  /** Per-triangle element pick ids (`elementId + 1`, 0 = none). */
  readonly elementPickIdsBuffer: GPUBuffer;
  /** Per-triangle face pick ids (`faceId + 1`, 0 = none). */
  readonly facePickIdsBuffer: GPUBuffer;
  /** Per-vertex node pick ids (`nodeId + 1`, 0 = interpolated vertex). */
  readonly nodePickIdsBuffer: GPUBuffer;
  /** Per-vertex corner positions read by the node-pick vertex stage. */
  readonly cornerPositionsBuffer: GPUBuffer;
  /** Line-list of the deduplicated mesh edges for the wireframe pass. */
  readonly edgeIndexBuffer: GPUBuffer;
  readonly indexCount: number;
  readonly edgeIndexCount: number;
}

export const defaultStyle: ResolvedStyle = {
  color: { r: 0.23, g: 0.51, b: 0.96, a: 1 },
  emissive: 0,
  opacity: 1,
  edge: false,
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

/** Creates the empty interaction state used when no overrides are supplied. */
export function createDefaultInteraction(): InteractionState {
  return createInteractionState();
}
