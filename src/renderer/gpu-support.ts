import type { ResolvedStyle } from "../interaction/interaction";

interface PartEdgeResource {
  readonly edgeNodePickIdsBuffer: GPUBuffer;
  readonly edgeVertexBuffer: GPUBuffer;
  readonly edgeIndexBuffer: GPUBuffer;
  readonly edgeTopologyBuffer: GPUBuffer;
  readonly edgeIndexCount: number;
  readonly resultColorBinding: { readonly buffer: GPUBuffer; readonly offset: number };
}

export interface PartResource {
  readonly vertexBuffer: GPUBuffer;
  readonly indexBuffer: GPUBuffer;
  /** Geometry-position buffers carrying the appended per-node result table. */
  resultColorBuffers: readonly { readonly buffer: GPUBuffer; readonly offset: number }[];
  readonly resultColorNodeCount: number;
  resultColorsSource: Float32Array | undefined;
  resultColorsActive: boolean;
  /** Per-triangle element pick ids (`elementId + 1`, 0 = none). */
  readonly elementPickIdsBuffer: GPUBuffer;
  /** Interleaved per-triangle face/owner/neighbor body ids. */
  readonly facePickIdsBuffer: GPUBuffer;
  /** Per-vertex node pick ids (`nodeId + 1`, 0 = vertex without a node). */
  readonly nodePickIdsBuffer: GPUBuffer;
  /** Edge geometry, topology, and result binding, materialized on first edge use. */
  edge: PartEdgeResource | undefined;
  readonly indexCount: number;
  /** Optional compact index orders for a validated face subset. */
  readonly subsetIndexBuffer?: GPUBuffer;
  readonly subsetVertexBuffer?: GPUBuffer;
  readonly subsetNodePickIdsBuffer?: GPUBuffer;
  /** Optional topology buffer with subset-local primitive remapping. */
  readonly subsetTopologyBuffer?: GPUBuffer;
  readonly subsetIndexCount: number;
}

export const defaultStyle: ResolvedStyle = {
  color: { r: 0.23, g: 0.51, b: 0.96, a: 1 },
  emissive: 0,
  opacity: 1,
  lineWidthPixels: 2,
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
