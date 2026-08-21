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
import { invalidateBindGroups } from "./instance-storage";
import { destroyVisibilitySkinCache, destroyVisibilitySkinCaches } from "../visibility/skins";
import { destroyResultColorBuffer, destroyResultColorBuffers } from "./result-colors";

/** Releases one uploaded part geometry resource, including optional overlays. */
export function destroyPartResource(resource: PartResource): void {
  const buffers = [
    resource.vertexBuffer,
    resource.indexBuffer,
    resource.minimalIndexBuffer,
    resource.facePickIdsBuffer,
    resource.nodePickIdsBuffer,
    resource.primitiveColorBuffer,
    resource.fullVertexBuffer,
    resource.fullIndexBuffer,
    resource.fullMinimalIndexBuffer,
    resource.fullFacePickIdsBuffer,
    resource.fullNodePickIdsBuffer,
    resource.edge?.edgeNodePickIdsBuffer,
    resource.edge?.edgeVertexBuffer,
    resource.edge?.edgeIndexBuffer,
    resource.edge?.edgeTopologyBuffer,
    resource.edgePick?.vertexBuffer,
    resource.edgePick?.indexBuffer,
    resource.edgePick?.nodePickIdsBuffer,
    resource.edgePick?.topologyBuffer,
    resource.subsetIndexBuffer,
    resource.subsetMinimalIndexBuffer,
    resource.subsetVertexBuffer,
    resource.subsetNodePickIdsBuffer,
    resource.subsetTopologyBuffer,
  ];
  const uniqueBuffers = new Set(
    buffers.filter((candidate): candidate is GPUBuffer => candidate !== undefined),
  );
  for (const buffer of uniqueBuffers) {
    buffer.destroy();
  }
}

/** Releases compact selected-primitive replays for one part. */
export function clearSelectionReplay(draw: DrawResources, partId: PartId): void {
  const replays = draw.selectionReplays.get(partId);
  if (replays === undefined) return;
  for (const primitiveReplays of replays.values()) {
    for (const resource of primitiveReplays.values()) destroyPartResource(resource);
  }
  draw.selectionReplays.delete(partId);
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
  for (const partId of [...draw.selectionReplays.keys()]) clearSelectionReplay(draw, partId);
  draw.admissionCache.clear();
  for (const resource of draw.nodeParts.values()) destroyPartResource(resource);
  draw.parts.clear();
  draw.nodeParts.clear();
  destroyVisibilitySkinCaches(draw);
  destroyInstanceResources(draw);
  destroyDeformationBuffers(draw.deformations, draw.cost);
  draw.deformations.clear();
  destroyResultColorBuffers(draw);
  draw.cost.releaseBuffer(draw.emptyOrderBuffer.size);
  draw.cost.releaseBuffer(draw.emptyHighlight.buffer.size);
  draw.cost.releaseBuffer(draw.emptyDeformationBuffer.size);
  draw.cost.releaseBuffer(draw.emptyResultColorBuffer.size);
  draw.emptyOrderBuffer.destroy();
  draw.emptyHighlight.buffer.destroy();
  draw.emptyDeformationBuffer.destroy();
  draw.emptyResultColorBuffer.destroy();
  destroyOrientationGlyphDrawResources(draw.orientationGlyphs);
  destroyColorTargets(draw.targets);
}

/** Releases geometry and visibility resources for one changed immutable definition. */
function destroyPartGeometryResources(draw: DrawResources, partId: PartId): void {
  destroyVisibilitySkinCache(draw, partId);
  clearSelectionReplay(draw, partId);
  const resources = draw.primitiveParts.get(partId);
  if (resources !== undefined) {
    for (const resource of resources.values()) destroyPartResource(resource);
    draw.primitiveParts.delete(partId);
  } else {
    const resource = draw.parts.get(partId);
    if (resource !== undefined) destroyPartResource(resource);
  }
  draw.parts.delete(partId);
  draw.admissionCache.delete(partId);
  const nodeResource = draw.nodeParts.get(partId);
  if (nodeResource !== undefined) {
    destroyPartResource(nodeResource);
    draw.nodeParts.delete(partId);
  }
}

/** Releases all cached resources derived from one changed part definition. */
export function destroyPartResources(draw: DrawResources, partId: PartId): void {
  const storage = draw.storages.get(partId);
  if (storage !== undefined) invalidateBindGroups(storage, draw.cost);
  destroyPartGeometryResources(draw, partId);
  destroyDeformationBuffer(draw.deformations, partId, draw.cost);
  destroyResultColorBuffer(draw, partId);
  destroyOrientationGlyphPart(draw.orientationGlyphs, partId);
}
