import type { PartId } from "../../geometry/part";
import { destroyDeformationBuffer, destroyDeformationBuffers } from "../frame/deformation";
import {
  destroyOrientationGlyphDrawResources,
  destroyOrientationGlyphPart,
} from "../orientation-glyphs/orientation-glyph";
import type { DrawResources } from "./draw-types";
import { destroyColorTargets } from "./color-targets";
import type { PartResource } from "./foundation";
import { destroyInstanceResources } from "./instance-lifecycle";

/** Releases one uploaded part geometry resource, including optional overlays. */
export function destroyPartResource(resource: PartResource): void {
  resource.vertexBuffer.destroy();
  resource.indexBuffer.destroy();
  resource.elementOrdinalsBuffer.destroy();
  resource.facePickIdsBuffer.destroy();
  resource.nodePickIdsBuffer.destroy();
  resource.edge?.edgeNodePickIdsBuffer.destroy();
  resource.edge?.edgeVertexBuffer.destroy();
  resource.edge?.edgeIndexBuffer.destroy();
  resource.edge?.edgeTopologyBuffer.destroy();
  resource.edgePick?.vertexBuffer.destroy();
  resource.edgePick?.indexBuffer.destroy();
  resource.edgePick?.nodePickIdsBuffer.destroy();
  resource.edgePick?.topologyBuffer.destroy();
  resource.subsetIndexBuffer?.destroy();
  resource.subsetVertexBuffer?.destroy();
  resource.subsetNodePickIdsBuffer?.destroy();
  resource.subsetTopologyBuffer?.destroy();
}

/** Releases every resource owned by the draw path. */
export function destroyDrawResources(draw: DrawResources): void {
  if (draw.destroyed) return;
  draw.destroyed = true;
  const destroyed = new Set<PartResource>();
  for (const resources of draw.primitiveParts.values()) {
    for (const resource of resources.values()) {
      destroyPartResource(resource);
      destroyed.add(resource);
    }
  }
  for (const resource of draw.parts.values()) {
    if (!destroyed.has(resource)) destroyPartResource(resource);
  }
  draw.primitiveParts.clear();
  for (const resource of draw.nodeParts.values()) destroyPartResource(resource);
  draw.parts.clear();
  draw.nodeParts.clear();
  destroyInstanceResources(draw);
  destroyDeformationBuffers(draw.deformations, draw.cost);
  draw.deformations.clear();
  draw.cost.releaseBuffer(draw.emptyOrderBuffer.size);
  draw.cost.releaseBuffer(draw.emptyHighlight.buffer.size);
  draw.cost.releaseBuffer(draw.emptyDeformationBuffer.size);
  draw.emptyOrderBuffer.destroy();
  draw.emptyHighlight.buffer.destroy();
  draw.emptyDeformationBuffer.destroy();
  destroyOrientationGlyphDrawResources(draw.orientationGlyphs);
  destroyColorTargets(draw.targets);
}

/** Releases all cached resources derived from one changed part definition. */
export function destroyPartResources(draw: DrawResources, partId: PartId): void {
  const resources = draw.primitiveParts.get(partId);
  if (resources !== undefined) {
    for (const resource of resources.values()) destroyPartResource(resource);
    draw.primitiveParts.delete(partId);
  } else {
    const resource = draw.parts.get(partId);
    if (resource !== undefined) destroyPartResource(resource);
  }
  draw.parts.delete(partId);
  const nodeResource = draw.nodeParts.get(partId);
  if (nodeResource !== undefined) {
    destroyPartResource(nodeResource);
    draw.nodeParts.delete(partId);
  }
  destroyDeformationBuffer(draw.deformations, partId, draw.cost);
  destroyOrientationGlyphPart(draw.orientationGlyphs, partId);
}
