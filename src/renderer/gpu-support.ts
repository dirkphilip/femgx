import type { ResolvedStyle } from "../interaction/interaction";

export interface PartResource {
  readonly vertexBuffer: GPUBuffer;
  readonly indexBuffer: GPUBuffer;
  /** Per-triangle element pick ids (`elementId + 1`, 0 = none). */
  readonly elementPickIdsBuffer: GPUBuffer;
  /** Interleaved per-triangle face/owner/neighbor body ids. */
  readonly facePickIdsBuffer: GPUBuffer;
  /** Per-vertex node pick ids (`nodeId + 1`, 0 = vertex without a node). */
  readonly nodePickIdsBuffer: GPUBuffer;
  /** Packed float position bits and expanded edge metadata for shader reads. */
  readonly geometryDataBuffer: GPUBuffer;
  /** Expanded endpoint positions for the wireframe pass. */
  readonly edgeVertexBuffer: GPUBuffer;
  /** Sequential line-list indices for the expanded wireframe endpoints. */
  readonly edgeIndexBuffer: GPUBuffer;
  readonly indexCount: number;
  readonly edgeIndexCount: number;
  /** Optional compact index orders for a validated face subset. */
  readonly subsetIndexBuffer?: GPUBuffer;
  readonly subsetEdgeVertexBuffer?: GPUBuffer;
  readonly subsetEdgeIndexBuffer?: GPUBuffer;
  readonly subsetIndexCount: number;
  readonly subsetEdgeIndexCount: number;
}

export const defaultStyle: ResolvedStyle = {
  color: { r: 0.23, g: 0.51, b: 0.96, a: 1 },
  emissive: 0,
  opacity: 1,
  edge: false,
  nodes: false,
};

export const vertexLayout: GPUVertexBufferLayout = {
  arrayStride: 12,
  attributes: [{ shaderLocation: 0, format: "float32x3", offset: 0 }],
};

/** Multisample count for the visible color path (edges, solids, overlays). */
export const COLOR_SAMPLE_COUNT = 4;

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
