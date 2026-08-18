import type { DrawCall } from "../resources/draw-resources";
import type { PartResource } from "../resources/foundation";

/** Binds the canonical, exterior-subset, or compact visibility index order. */
export function bindDrawGeometry(
  pass: GPURenderPassEncoder,
  options: {
    readonly geometry: PartResource;
    readonly overlay: boolean;
    readonly subset: boolean;
    readonly edgePick: boolean;
    readonly minimal?: boolean;
    readonly featureTriangles?: boolean;
    readonly bindVertexBuffer: boolean;
    readonly visibilitySkin: DrawCall["visibilitySkin"];
  },
): number | undefined {
  const {
    geometry,
    overlay,
    subset,
    edgePick,
    minimal = false,
    featureTriangles = false,
    bindVertexBuffer,
    visibilitySkin,
  } = options;
  if (!overlay && !subset && !edgePick && visibilitySkin !== undefined) {
    if (!featureTriangles)
      pass.setVertexBuffer(0, geometry.fullVertexBuffer ?? geometry.vertexBuffer);
    pass.setIndexBuffer(visibilitySkin.indexBuffer, "uint32");
    return visibilitySkin.indexCount;
  }
  const vertexBuffer = edgePick
    ? geometry.edgePick?.vertexBuffer
    : overlay
      ? geometry.edge?.edgeVertexBuffer
      : subset
        ? (geometry.subsetVertexBuffer ?? geometry.vertexBuffer)
        : (geometry.fullVertexBuffer ?? geometry.vertexBuffer);
  const { buffer: indexBuffer, offset: indexOffset } = drawIndexBinding({
    geometry,
    edgePick,
    overlay,
    subset,
    minimal,
  });
  const count = edgePick
    ? geometry.edgePick?.indexCount
    : overlay
      ? geometry.edge?.edgeIndexCount
      : subset
        ? geometry.subsetIndexCount
        : (geometry.fullIndexCount ?? geometry.indexCount);
  if (indexBuffer === undefined || vertexBuffer === undefined || count === undefined)
    return undefined;
  if (bindVertexBuffer && !featureTriangles) pass.setVertexBuffer(0, vertexBuffer);
  pass.setIndexBuffer(indexBuffer, "uint32", indexOffset);
  return count;
}

function drawIndexBinding(options: {
  readonly geometry: PartResource;
  readonly edgePick: boolean;
  readonly overlay: boolean;
  readonly subset: boolean;
  readonly minimal: boolean;
}): { readonly buffer: GPUBuffer | undefined; readonly offset: number } {
  const { geometry, edgePick, overlay, subset, minimal } = options;
  const buffer = edgePick
    ? geometry.edgePick?.indexBuffer
    : overlay
      ? geometry.edge?.edgeIndexBuffer
      : minimal
        ? subset
          ? (geometry.subsetMinimalIndexBuffer ??
            geometry.subsetIndexBuffer ??
            geometry.indexBuffer)
          : (geometry.fullMinimalIndexBuffer ?? geometry.minimalIndexBuffer ?? geometry.indexBuffer)
        : subset
          ? (geometry.subsetIndexBuffer ?? geometry.indexBuffer)
          : (geometry.fullIndexBuffer ?? geometry.indexBuffer);
  const offset =
    edgePick || overlay || !minimal
      ? 0
      : subset
        ? (geometry.subsetMinimalIndexOffset ?? 0)
        : (geometry.fullMinimalIndexOffset ?? geometry.minimalIndexOffset ?? 0);
  return { buffer, offset };
}
