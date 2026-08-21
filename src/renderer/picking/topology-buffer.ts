import type { MeshEdgeData } from "../edges/mesh-edge";
import { createBuffer } from "../resources/foundation";
import { packTopologyData } from "../resources/geometry-buffers";

interface TopologyBufferMetadata {
  readonly elementOrdinals: ArrayLike<number>;
  readonly neighborElementOrdinals?: ArrayLike<number>;
  readonly conditionElementOrdinals?: ArrayLike<number>;
  readonly primitiveIds: ArrayLike<number>;
  readonly edgeIds: ArrayLike<number>;
  readonly cornerIndices?: ArrayLike<number>;
}

/** Packs and uploads one renderer-private topology storage buffer. */
export function createTopologyBuffer(
  device: GPUDevice,
  faceBodyPickIds: Uint32Array,
  edgeData: MeshEdgeData,
  metadata: TopologyBufferMetadata,
): { readonly buffer: GPUBuffer; readonly cornerIndexOffset?: number } {
  const data = packTopologyData(
    faceBodyPickIds,
    edgeData.bodyRanges,
    edgeData.bodyIds,
    edgeData.elementIds,
    metadata,
  );
  const cornerCount = metadata.cornerIndices?.length ?? 0;
  return {
    buffer: createBuffer(device, data, GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE),
    ...(cornerCount === 0
      ? {}
      : {
          cornerIndexOffset: (data.length - cornerCount) * Uint32Array.BYTES_PER_ELEMENT,
        }),
  };
}
