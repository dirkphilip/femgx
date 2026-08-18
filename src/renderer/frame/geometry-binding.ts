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
    readonly bindVertexBuffer: boolean;
    readonly visibilitySkin: DrawCall["visibilitySkin"];
  },
): number | undefined {
  const { geometry, overlay, subset, edgePick, bindVertexBuffer, visibilitySkin } = options;
  if (!overlay && !subset && !edgePick && visibilitySkin !== undefined) {
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
  const indexBuffer = edgePick
    ? geometry.edgePick?.indexBuffer
    : overlay
      ? geometry.edge?.edgeIndexBuffer
      : subset
        ? (geometry.subsetIndexBuffer ?? geometry.indexBuffer)
        : (geometry.fullIndexBuffer ?? geometry.indexBuffer);
  const count = edgePick
    ? geometry.edgePick?.indexCount
    : overlay
      ? geometry.edge?.edgeIndexCount
      : subset
        ? geometry.subsetIndexCount
        : (geometry.fullIndexCount ?? geometry.indexCount);
  if (indexBuffer === undefined || vertexBuffer === undefined || count === undefined)
    return undefined;
  if (bindVertexBuffer) pass.setVertexBuffer(0, vertexBuffer);
  pass.setIndexBuffer(indexBuffer, "uint32");
  return count;
}
