import { logicalPrimitiveCount, type Part } from "../../src/geometry/part";
import { getPartSemanticIndex } from "../../src/geometry/part-semantic-index";
import { geometrySemanticGraph } from "../../src/geometry/semantic/part-semantic-graph";
import { DEFORMATION_UNIFORM_SIZE } from "../../src/renderer/frame/deformation";
import { CAMERA_UNIFORM_SIZE } from "../../src/renderer/frame/pipelines";
import {
  ELEMENT_RECORD_STRIDE,
  HIGHLIGHT_HEADER,
} from "../../src/renderer/resources/element-resources";
import type { Scene } from "../../src/scene/scene";

const EMPTY_RESULT_COLOR_BUFFER_BYTES = 16;

export interface BenchmarkMemoryEstimate {
  /** Retained full geometry for parts without an exterior subset. */
  readonly geometryBytes: number;
  readonly pickMetadataBytes: number;
  /** Canonical optional edge index buffers; subset edge indices are in subsetBytes. */
  readonly edgeIndexBytes: number;
  /** Exterior-subset buffers retained as the ordinary surface path. */
  readonly subsetBytes: number;
  /** One device-scoped empty deformation storage buffer. */
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
  /** Weighted visible color targets for the default triad-enabled path. */
  readonly visibleColorBytes: number;
  readonly visibleDepthBytes: number;
  readonly pickIdTargetBytes: number;
  readonly pickDepthBytes: number;
  readonly totalRenderTargetBytes: number;
}

export interface BenchmarkMemoryOptions {
  /** Part ids whose optional edge resources have already been materialized. */
  readonly materializedEdgePartIds?: ReadonlySet<number>;
}

export interface DenseEdgeTypedMemoryEstimate {
  readonly edgeConstructionTypedArrayBytes: number;
  readonly edgeFinalTypedArrayBytes: number;
  readonly edgeGuaranteedTypedArrayOverlapBytes: number;
  readonly edgeNoIntermediateGcTypedArrayUpperBoundBytes: number;
}

/** Returns exact dense edge-builder allocation facts for the validated triangle-grid path. */
export function denseEdgeTypedMemory(options: {
  readonly scene: Scene;
  readonly gridCells: number;
  readonly elementFamily: string;
}): DenseEdgeTypedMemoryEstimate | undefined {
  if (options.elementFamily !== "triangle") return undefined;
  const entries = [...options.scene.parts.values()].flatMap((part) =>
    part.geometries
      .filter((geometry) => geometry.primitive === "triangles")
      .map((geometry) => ({ part, geometry })),
  );
  const entry = entries.length === 1 ? entries[0] : undefined;
  if (
    entry?.geometry.primitive !== "triangles" ||
    (entry.part.bodies?.count ?? 0) !== 0 ||
    entry.geometry.faces !== undefined ||
    entry.geometry.edges !== undefined ||
    entry.geometry.faceSubset !== undefined
  ) {
    return undefined;
  }
  const cells = options.gridCells;
  const triangleCount = cells * cells * 2;
  if (entry.geometry.indices.length !== triangleCount * 3) return undefined;
  const occurrenceCount = entry.geometry.indices.length;
  const edgeCount = 3 * cells * cells + 2 * cells;
  return denseEdgeTypedMemoryCounts(triangleCount, occurrenceCount, edgeCount);
}

function denseEdgeTypedMemoryCounts(
  triangleCount: number,
  occurrenceCount: number,
  edgeCount: number,
): DenseEdgeTypedMemoryEstimate {
  let tableCapacity = 1;
  while (tableCapacity < Math.ceil(occurrenceCount / 0.75)) tableCapacity *= 2;
  const wordBytes = Uint32Array.BYTES_PER_ELEMENT;
  const builderStateBytes = occurrenceCount * 6 * wordBytes;
  const primitiveElementPickIdBytes = triangleCount * wordBytes;
  const edgeConstructionTypedArrayBytes =
    builderStateBytes + tableCapacity * 3 * wordBytes + primitiveElementPickIdBytes;
  const edgeFinalTypedArrayBytes = edgeCount * 2 * 7 * wordBytes + occurrenceCount * 4 * wordBytes;
  return {
    edgeConstructionTypedArrayBytes,
    edgeFinalTypedArrayBytes,
    edgeGuaranteedTypedArrayOverlapBytes:
      builderStateBytes + primitiveElementPickIdBytes + edgeFinalTypedArrayBytes,
    edgeNoIntermediateGcTypedArrayUpperBoundBytes:
      edgeConstructionTypedArrayBytes + edgeFinalTypedArrayBytes,
  };
}

/** Estimates renderer-owned resources and separately scoped CPU/staging bytes. */
export function estimateBenchmarkMemory(
  scene: Scene,
  instanceCount: number,
  width: number,
  height: number,
  options: BenchmarkMemoryOptions = {},
): BenchmarkMemoryEstimate {
  let geometryBytes = 0;
  let pickMetadataBytes = 0;
  let edgeIndexBytes = 0;
  let subsetBytes = 0;
  let cpuSceneTypedArrayBytes = 0;
  for (const part of scene.parts.values()) {
    for (const geometry of part.geometries) {
      const primitiveCount = logicalPrimitiveCount(geometry);
      const expandedVertexCount = expandedVertexCountFor(geometry);
      const sourceVertexCount = sourceVertexCountFor(geometry);
      const edgeMaterialized = options.materializedEdgePartIds?.has(part.id) ?? false;
      const canonicalEdge =
        edgeMaterialized && geometry.primitive === "triangles" && geometry.faceSubset === undefined
          ? edgeEndpointUpperBoundFor(geometry, primitiveCount)
          : 0;
      const mainPositionBytes = sourceVertexCount * 3 * Float32Array.BYTES_PER_ELEMENT;
      const mainIndexBytes = expandedIndexCountFor(geometry) * Uint32Array.BYTES_PER_ELEMENT;
      const topologyUpperBound = topologyBytesUpperBound(
        primitiveCount,
        expandedVertexCount,
        canonicalEdge,
        geometry.primitive === "triangles" ? expandedIndexCountFor(geometry) : 0,
      );
      const subset = subsetEstimate(geometry, edgeMaterialized);
      const retainsFullGeometry = getPartSemanticIndex(part).hasBoundaryFaceSubset;
      if (subset.bufferBytes > 0) {
        subsetBytes += subset.bufferBytes;
      }
      if (subset.bufferBytes === 0 || retainsFullGeometry) {
        geometryBytes +=
          gpuBufferBytes(mainPositionBytes) +
          gpuBufferBytes(mainIndexBytes) +
          (canonicalEdge === 0
            ? 0
            : gpuBufferBytes(canonicalEdge * 3 * Float32Array.BYTES_PER_ELEMENT));
        pickMetadataBytes +=
          gpuBufferBytes(primitiveCount * Uint32Array.BYTES_PER_ELEMENT) +
          gpuBufferBytes(sourceVertexCount * Uint32Array.BYTES_PER_ELEMENT) +
          (canonicalEdge === 0
            ? 0
            : gpuBufferBytes(canonicalEdge * Uint32Array.BYTES_PER_ELEMENT)) +
          topologyUpperBound;
        edgeIndexBytes +=
          canonicalEdge === 0 ? 0 : gpuBufferBytes(canonicalEdge * Uint32Array.BYTES_PER_ELEMENT);
      }
    }
    cpuSceneTypedArrayBytes += scenePartTypedArrayBytes(part);
  }
  for (const assembly of scene.assemblies.values()) {
    for (const placement of assembly.placements) {
      cpuSceneTypedArrayBytes += placement.transform.byteLength;
    }
  }
  // The per-part core retains only instance records and the ordinary visible
  // order. Optional orders and highlight tables are admitted by state and are
  // absent from this empty-scene estimate.
  const instanceBytes = instanceCount * (96 + Uint32Array.BYTES_PER_ELEMENT);
  const highlightBytes = HIGHLIGHT_HEADER + ELEMENT_RECORD_STRIDE;
  const deformationBytes = 4;
  // Includes the shared 16-byte empty result-color binding plus empty order;
  // highlight and deformation sentinels are reported in their dedicated fields above.
  const fixedBufferBytes =
    CAMERA_UNIFORM_SIZE +
    DEFORMATION_UNIFORM_SIZE +
    32 +
    64 +
    48 +
    16 +
    EMPTY_RESULT_COLOR_BUFFER_BYTES +
    4;
  const pickReadbackBytes = 256 * 5;
  const totalBufferBytes =
    geometryBytes +
    pickMetadataBytes +
    edgeIndexBytes +
    subsetBytes +
    deformationBytes +
    instanceBytes +
    highlightBytes +
    fixedBufferBytes +
    pickReadbackBytes;
  const uploadStagingBytes = geometryBytes + pickMetadataBytes + edgeIndexBytes + subsetBytes;
  const pixels = width * height;
  const visibleColorBytes = pixels * (16 + 4 + 32 + 8 + 4 + 1);
  const visibleDepthBytes = pixels * 16;
  const pickIdTargetBytes = pixels * 4 * 4;
  const pickDepthBytes = pixels * 4;
  return {
    geometryBytes,
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

function expandedVertexCountFor(geometry: Part["geometries"][number]): number {
  if (geometry.primitive === "points") return geometry.indices.length * 4;
  if (geometry.primitive === "lines") return Math.floor(geometry.indices.length / 2) * 4;
  return geometry.indices.length;
}

function sourceVertexCountFor(geometry: Part["geometries"][number]): number {
  return geometry.primitive === "triangles"
    ? Math.floor(geometry.positions.length / 3)
    : expandedVertexCountFor(geometry);
}

function expandedIndexCountFor(geometry: Part["geometries"][number]): number {
  if (geometry.primitive === "points") return geometry.indices.length * 6;
  if (geometry.primitive === "lines") return Math.floor(geometry.indices.length / 2) * 6;
  return geometry.indices.length;
}

function edgeEndpointUpperBoundFor(
  geometry: Part["geometries"][number],
  primitiveCount: number,
): number {
  return geometry.primitive === "triangles" ? primitiveCount * 6 : 1;
}

function topologyBytesUpperBound(
  primitiveCount: number,
  expandedVertexCount: number,
  edgeEndpointUpperBound: number,
  cornerIndexCount: number,
): number {
  const words =
    3 +
    primitiveCount * 5 +
    edgeEndpointUpperBound * 2 +
    edgeEndpointUpperBound * 4 +
    1 +
    expandedVertexCount +
    edgeEndpointUpperBound +
    cornerIndexCount;
  return gpuBufferBytes(words * Uint32Array.BYTES_PER_ELEMENT);
}

function subsetEstimate(
  geometry: Part["geometries"][number],
  edgeMaterialized: boolean,
): { readonly bufferBytes: number } {
  if (geometry.primitive !== "triangles" || geometry.faceSubset === undefined) {
    return { bufferBytes: 0 };
  }
  let primitiveCount = 0;
  const semantic = geometrySemanticGraph(geometry);
  if (semantic !== undefined) {
    const { graph, geometryOrdinal } = semantic;
    const first = graph.faceSubsetOffsets[geometryOrdinal] ?? 0;
    const last = graph.faceSubsetOffsets[geometryOrdinal + 1] ?? first;
    for (let row = first; row < last; row += 1) {
      const faceOrdinal = graph.faceSubsetOrdinals[row] ?? 0;
      primitiveCount += graph.facePrimitiveCounts[faceOrdinal] ?? 0;
    }
  } else {
    for (const faceId of geometry.faceSubset) {
      const face = geometry.faces?.get(faceId.elementId, faceId.faceIndex);
      primitiveCount += face?.primitiveCount ?? 0;
    }
  }
  if (primitiveCount === 0) return { bufferBytes: 0 };
  const vertexCount = primitiveCount * 3;
  const sourceVertexCount = Math.min(vertexCount, Math.floor(geometry.positions.length / 3));
  const edgeEndpointUpperBound = edgeMaterialized ? primitiveCount * 6 : 0;
  const surfaceBufferBytes =
    gpuBufferBytes(sourceVertexCount * 3 * Float32Array.BYTES_PER_ELEMENT) +
    gpuBufferBytes(vertexCount * Uint32Array.BYTES_PER_ELEMENT) +
    gpuBufferBytes(sourceVertexCount * Uint32Array.BYTES_PER_ELEMENT) +
    topologyBytesUpperBound(logicalPrimitiveCount(geometry), vertexCount, 0, vertexCount);
  const edgeBufferBytes =
    edgeEndpointUpperBound === 0
      ? 0
      : gpuBufferBytes(edgeEndpointUpperBound * 3 * Float32Array.BYTES_PER_ELEMENT) +
        gpuBufferBytes(edgeEndpointUpperBound * Uint32Array.BYTES_PER_ELEMENT) +
        gpuBufferBytes(edgeEndpointUpperBound * Uint32Array.BYTES_PER_ELEMENT) +
        topologyBytesUpperBound(logicalPrimitiveCount(geometry), 0, edgeEndpointUpperBound, 0);
  return {
    bufferBytes: surfaceBufferBytes + edgeBufferBytes,
  };
}

function scenePartTypedArrayBytes(part: Part): number {
  return part.geometries.reduce(
    (total, geometry) =>
      total +
      geometry.positions.byteLength +
      geometry.indices.byteLength +
      (geometry.nodePickIds?.byteLength ?? 0),
    part.nodePositions?.byteLength ?? 0,
  );
}
