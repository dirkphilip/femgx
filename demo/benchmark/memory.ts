import { logicalPrimitiveCount, type Part } from "../../src/geometry/part";
import { DEFORMATION_UNIFORM_SIZE } from "../../src/renderer/gpu-deform";
import { CAMERA_UNIFORM_SIZE } from "../../src/renderer/gpu-pipelines";
import type { Scene } from "../../src/scene/scene";

export interface BenchmarkMemoryEstimate {
  readonly geometryBytes: number;
  /** Result-color tails appended to each main and edge position buffer. */
  readonly resultColorBytes: number;
  readonly pickMetadataBytes: number;
  readonly edgeIndexBytes: number;
  /** Optional face-subset buffers; zero when no part declares a subset. */
  readonly subsetBytes: number;
  /** One empty deformation storage buffer is bound for each rendered part. */
  readonly deformationBytes: number;
  readonly instanceBytes: number;
  readonly highlightBytes: number;
  readonly fixedBufferBytes: number;
  /** Pooled map-read buffer retained after the first pick. */
  readonly pickReadbackBytes: number;
  readonly totalBufferBytes: number;
  /** Typed arrays retained by the authoritative benchmark scene. */
  readonly cpuSceneTypedArrayBytes: number;
  /** Upper-bound renderer upload staging bytes during the cold attachment. */
  readonly uploadStagingBytes: number;
  /** Retained GPU buffers; excludes textures, CPU arrays, and driver memory. */
  readonly retainedBufferBytes: number;
  /** Retained buffers plus the upload-staging upper bound. */
  readonly peakRendererBytes: number;
  readonly visibleColorBytes: number;
  readonly visibleDepthBytes: number;
  readonly pickIdTargetBytes: number;
  readonly pickDepthBytes: number;
  readonly totalRenderTargetBytes: number;
}

/** Estimates renderer-owned resources and separately scoped CPU/staging bytes. */
export function estimateBenchmarkMemory(
  scene: Scene,
  instanceCount: number,
  width: number,
  height: number,
): BenchmarkMemoryEstimate {
  let geometryBytes = 0;
  let resultColorBytes = 0;
  let pickMetadataBytes = 0;
  let edgeIndexBytes = 0;
  let subsetBytes = 0;
  let cpuSceneTypedArrayBytes = 0;
  for (const part of scene.parts.values()) {
    const { geometry } = part;
    const primitiveCount = logicalPrimitiveCount(geometry);
    const expandedVertexCount = expandedVertexCountFor(geometry);
    const edgeEndpointUpperBound = edgeEndpointUpperBoundFor(geometry, primitiveCount);
    const resultColorTailBytes = resultColorTailBytesFor(geometry);
    const mainPositionBytes = expandedVertexCount * 3 * Float32Array.BYTES_PER_ELEMENT;
    const mainIndexBytes = expandedIndexCountFor(geometry) * Uint32Array.BYTES_PER_ELEMENT;
    const edgePositionBytes =
      Math.max(1, edgeEndpointUpperBound) * 3 * Float32Array.BYTES_PER_ELEMENT;
    geometryBytes +=
      gpuBufferBytes(mainPositionBytes) +
      gpuBufferBytes(mainIndexBytes) +
      gpuBufferBytes(edgePositionBytes);
    resultColorBytes += resultColorTailBytes * 2;
    const topologyUpperBound = topologyBytesUpperBound(
      primitiveCount,
      expandedVertexCount,
      edgeEndpointUpperBound,
    );
    pickMetadataBytes +=
      gpuBufferBytes(primitiveCount * Uint32Array.BYTES_PER_ELEMENT) +
      gpuBufferBytes(expandedVertexCount * Uint32Array.BYTES_PER_ELEMENT) +
      gpuBufferBytes(edgeEndpointUpperBound * Uint32Array.BYTES_PER_ELEMENT) +
      topologyUpperBound;
    edgeIndexBytes += gpuBufferBytes(edgeEndpointUpperBound * Uint32Array.BYTES_PER_ELEMENT);
    const subset = subsetEstimate(geometry, resultColorTailBytes);
    subsetBytes += subset.bufferBytes;
    resultColorBytes += subset.resultColorBytes;
    cpuSceneTypedArrayBytes += scenePartTypedArrayBytes(part);
  }
  for (const assembly of scene.assemblies.values()) {
    for (const placement of assembly.placements) {
      cpuSceneTypedArrayBytes += placement.transform.byteLength;
    }
  }
  const instanceBytes = instanceCount * (96 + 6 * Uint32Array.BYTES_PER_ELEMENT);
  const highlightBytes = scene.parts.size * (16 + 128 * 48);
  const deformationBytes = scene.parts.size * 4;
  const fixedBufferBytes = CAMERA_UNIFORM_SIZE + DEFORMATION_UNIFORM_SIZE + 32 + 64 + 48 + 16;
  const pickReadbackBytes = 256 * 5;
  const totalBufferBytes =
    geometryBytes +
    resultColorBytes +
    pickMetadataBytes +
    edgeIndexBytes +
    subsetBytes +
    deformationBytes +
    instanceBytes +
    highlightBytes +
    fixedBufferBytes +
    pickReadbackBytes;
  const uploadStagingBytes =
    geometryBytes + resultColorBytes + pickMetadataBytes + edgeIndexBytes + subsetBytes;
  const pixels = width * height;
  const visibleColorBytes = pixels * (16 + 4 + 32 + 8 + 16 + 4);
  const visibleDepthBytes = pixels * 16;
  const pickIdTargetBytes = pixels * 4 * 4;
  const pickDepthBytes = pixels * 4;
  return {
    geometryBytes,
    resultColorBytes,
    pickMetadataBytes,
    edgeIndexBytes,
    subsetBytes,
    deformationBytes,
    instanceBytes,
    highlightBytes,
    fixedBufferBytes,
    pickReadbackBytes,
    totalBufferBytes,
    cpuSceneTypedArrayBytes,
    uploadStagingBytes,
    retainedBufferBytes: totalBufferBytes,
    peakRendererBytes: totalBufferBytes + uploadStagingBytes,
    visibleColorBytes,
    visibleDepthBytes,
    pickIdTargetBytes,
    pickDepthBytes,
    totalRenderTargetBytes:
      visibleColorBytes + visibleDepthBytes + pickIdTargetBytes + pickDepthBytes,
  };
}

function gpuBufferBytes(bytes: number): number {
  return Math.max(4, bytes);
}

function expandedVertexCountFor(geometry: Part["geometry"]): number {
  if (geometry.primitive === "points") return geometry.indices.length * 4;
  if (geometry.primitive === "lines") return Math.floor(geometry.indices.length / 2) * 4;
  return geometry.indices.length;
}

function expandedIndexCountFor(geometry: Part["geometry"]): number {
  if (geometry.primitive === "points") return geometry.indices.length * 6;
  if (geometry.primitive === "lines") return Math.floor(geometry.indices.length / 2) * 6;
  return geometry.indices.length;
}

function edgeEndpointUpperBoundFor(geometry: Part["geometry"], primitiveCount: number): number {
  return geometry.primitive === "triangles" ? primitiveCount * 6 : 1;
}

function resultColorTailBytesFor(geometry: Part["geometry"]): number {
  let maxNodePickId = 0;
  for (const pickId of geometry.nodePickIds ?? []) maxNodePickId = Math.max(maxNodePickId, pickId);
  return (maxNodePickId + 2) * 4 * Float32Array.BYTES_PER_ELEMENT;
}

function topologyBytesUpperBound(
  primitiveCount: number,
  expandedVertexCount: number,
  edgeEndpointUpperBound: number,
): number {
  const words =
    3 +
    primitiveCount * 5 +
    edgeEndpointUpperBound * 2 +
    edgeEndpointUpperBound * 4 +
    1 +
    expandedVertexCount +
    edgeEndpointUpperBound;
  return gpuBufferBytes(words * Uint32Array.BYTES_PER_ELEMENT);
}

function subsetEstimate(
  geometry: Part["geometry"],
  resultColorTailBytes: number,
): { readonly bufferBytes: number; readonly resultColorBytes: number } {
  if (geometry.primitive !== "triangles" || geometry.faceSubset === undefined) {
    return { bufferBytes: 0, resultColorBytes: 0 };
  }
  let primitiveCount = 0;
  for (const faceId of geometry.faceSubset.faceIds) {
    const face = geometry.faces?.find(
      (candidate) =>
        candidate.elementId === faceId.elementId && candidate.faceIndex === faceId.faceIndex,
    );
    primitiveCount += face?.primitiveCount ?? 0;
  }
  const vertexCount = primitiveCount * 3;
  const edgeEndpointUpperBound = primitiveCount * 6;
  const bufferBytes =
    gpuBufferBytes(vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT) +
    gpuBufferBytes(vertexCount * Uint32Array.BYTES_PER_ELEMENT) +
    gpuBufferBytes(vertexCount * Uint32Array.BYTES_PER_ELEMENT) +
    topologyBytesUpperBound(logicalPrimitiveCount(geometry), vertexCount, edgeEndpointUpperBound) +
    gpuBufferBytes(edgeEndpointUpperBound * 3 * Float32Array.BYTES_PER_ELEMENT) +
    gpuBufferBytes(edgeEndpointUpperBound * Uint32Array.BYTES_PER_ELEMENT);
  return { bufferBytes, resultColorBytes: resultColorTailBytes * 2 };
}

function scenePartTypedArrayBytes(part: Part): number {
  const { geometry } = part;
  return (
    geometry.positions.byteLength +
    geometry.indices.byteLength +
    (geometry.nodePickIds?.byteLength ?? 0) +
    (geometry.nodePositions?.byteLength ?? 0)
  );
}
