import type { ResolvedStyle } from "../../interaction/interaction";

interface PartEdgeResource {
  readonly edgeNodePickIdsBuffer: GPUBuffer;
  readonly edgeVertexBuffer: GPUBuffer;
  readonly edgeIndexBuffer: GPUBuffer;
  readonly edgeTopologyBuffer: GPUBuffer;
  readonly edgeIndexCount: number;
  readonly edgeKeys: readonly string[] | undefined;
  readonly edgeNodeIds: readonly (readonly number[])[] | undefined;
}

/** Lazy resources used only by the authored-edge pick pass. */
export interface PartEdgePickResource {
  readonly vertexBuffer: GPUBuffer;
  readonly indexBuffer: GPUBuffer;
  readonly nodePickIdsBuffer: GPUBuffer;
  readonly topologyBuffer: GPUBuffer;
  readonly indexCount: number;
  readonly edgeKeys: readonly string[];
}

export interface PartResource {
  readonly vertexBuffer: GPUBuffer;
  readonly indexBuffer: GPUBuffer;
  /** Minimal triangle index order into the shared source vertex table. */
  readonly minimalIndexBuffer?: GPUBuffer;
  readonly minimalIndexOffset?: number;
  /** Interleaved per-triangle face/owner/neighbor body ids. */
  readonly facePickIdsBuffer: GPUBuffer;
  /** Per-vertex node pick ids (`nodeId + 1`, 0 = vertex without a node). */
  readonly nodePickIdsBuffer: GPUBuffer;
  /** Optional per-triangle display colors encoded like elemental result colors. */
  readonly primitiveColorBuffer?: GPUBuffer;
  /** Full interior geometry, materialized only when a full-surface draw needs it. */
  fullVertexBuffer?: GPUBuffer;
  fullIndexBuffer?: GPUBuffer;
  fullMinimalIndexBuffer?: GPUBuffer;
  fullMinimalIndexOffset?: number;
  fullFacePickIdsBuffer?: GPUBuffer;
  fullNodePickIdsBuffer?: GPUBuffer;
  fullIndexCount?: number;
  /** Edge geometry and topology, materialized on first edge use. */
  edge: PartEdgeResource | undefined;
  edgePick: PartEdgePickResource | undefined;
  readonly indexCount: number;
  /** Optional compact index orders for a validated face subset. */
  readonly subsetIndexBuffer?: GPUBuffer;
  readonly subsetMinimalIndexBuffer?: GPUBuffer;
  readonly subsetMinimalIndexOffset?: number;
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

/** Multisample count for the visible surface and weighted-transparency path. */
export const COLOR_SAMPLE_COUNT = 4;

/** Creates and uploads a GPU buffer from typed-array data. */
export function createBuffer(
  device: GPUDevice,
  data: ArrayBufferView,
  usage: GPUBufferUsageFlags,
  label = "femgx uploaded buffer",
): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: Math.max(4, data.byteLength),
    usage: usage | GPUBufferUsage.COPY_DST,
  });
  // queue.writeBuffer copies the source before returning; an intermediate
  // Uint8Array copy needlessly doubles JavaScript staging for large geometry.
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}
