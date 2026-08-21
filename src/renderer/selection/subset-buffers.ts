import { createTopologyBuffer } from "../picking/topology-buffer";
import { createBuffer } from "../resources/foundation";
import { emptyMeshEdgeData } from "../resources/geometry-buffers";
import type { UploadVertexData } from "../resources/triangle-upload";

/** GPU buffers for one compact triangle vertex/topology view. */
export interface SubsetBuffers {
  readonly subsetIndexBuffer?: GPUBuffer;
  readonly subsetVertexBuffer?: GPUBuffer;
  readonly subsetNodePickIdsBuffer?: GPUBuffer;
  readonly subsetMinimalIndexBuffer?: GPUBuffer;
  readonly subsetMinimalIndexOffset?: number;
  readonly subsetTopologyBuffer?: GPUBuffer;
}

/** Uploads a compact triangle view and rolls back every partial allocation on failure. */
export function createSubsetBuffers(
  device: GPUDevice,
  vertexData: UploadVertexData | undefined,
  faceBodyPickIds: Uint32Array,
  elementOrdinals: Uint32Array,
  neighborElementOrdinals?: Uint32Array,
): SubsetBuffers {
  if (vertexData === undefined) return {};
  const allocated: GPUBuffer[] = [];
  try {
    const subsetVertexBuffer = track(
      allocated,
      createBuffer(device, vertexData.positions, GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE),
    );
    const topology = createTopologyBuffer(device, faceBodyPickIds, emptyMeshEdgeData(), {
      elementOrdinals,
      ...(neighborElementOrdinals === undefined ? {} : { neighborElementOrdinals }),
      primitiveIds: vertexData.primitiveIds,
      edgeIds: [],
      ...(vertexData.cornerIndices === undefined
        ? {}
        : { cornerIndices: vertexData.cornerIndices }),
    });
    track(allocated, topology.buffer);
    const subsetIndexBuffer = track(allocated, createIndexBuffer(device, vertexData.indices));
    const subsetNodePickIdsBuffer = track(
      allocated,
      createBuffer(device, vertexData.nodePickIds, GPUBufferUsage.STORAGE),
    );
    return {
      subsetIndexBuffer,
      subsetVertexBuffer,
      subsetNodePickIdsBuffer,
      subsetTopologyBuffer: topology.buffer,
      ...(topology.cornerIndexOffset === undefined
        ? {}
        : {
            subsetMinimalIndexBuffer: topology.buffer,
            subsetMinimalIndexOffset: topology.cornerIndexOffset,
          }),
    };
  } catch (error) {
    for (const buffer of allocated) buffer.destroy();
    throw error;
  }
}

function track(buffers: GPUBuffer[], buffer: GPUBuffer): GPUBuffer {
  buffers.push(buffer);
  return buffer;
}

function createIndexBuffer(device: GPUDevice, indices: Uint32Array): GPUBuffer {
  return createBuffer(
    device,
    indices.length > 0 ? indices : new Uint32Array(1),
    GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE,
  );
}
