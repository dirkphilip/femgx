import type { PartId } from "../../geometry/part";
import { destroyDeformationBuffer } from "../frame/deformation";
import { destroyOrientationGlyphPart } from "../orientation-glyphs/orientation-glyph";
import { destroyPartResource, type DrawResources } from "../resources/draw-resources";
import { rollbackStagedInstanceStorage, type InstanceStorage } from "../resources/instance-storage";
import { destroyResultColorBuffer } from "../resources/result-colors";
import { rollbackStagedHighlight } from "../selection/highlight-storage";
import { destroyDetachedVisibilitySkinCache } from "../visibility/skins";

const STAGED_SIDECARS = [
  "transparent",
  "selection",
  "nodeSelection",
  "nodeSelectionCompact",
  "edge",
  "node",
] as const;

/** Releases every detached resource owned by an uncommitted definition revision. */
export function discardStagedPartResources(
  draw: DrawResources,
  live: DrawResources,
  partIds: ReadonlySet<PartId>,
): void {
  for (const partId of partIds) {
    destroyStagedGeometry(draw, partId);
    destroyDeformationBuffer(draw.deformations, partId, draw.cost);
    destroyResultColorBuffer(draw, partId);
    destroyOrientationGlyphPart(draw.orientationGlyphs, partId);
    destroyStagedStorage(draw.storages.get(partId), live.storages.get(partId));
    const skins = draw.visibilitySkins.get(partId);
    if (skins !== undefined) destroyDetachedVisibilitySkinCache(draw, skins);
  }
  if (draw.orientationGlyphs.paramsBuffer !== live.orientationGlyphs.paramsBuffer) {
    draw.orientationGlyphs.paramsBuffer?.destroy();
  }
}

/** Rolls back journals and destroys storage buffers detached from the live owner. */
export function destroyStagedStorage(
  storage: InstanceStorage | undefined,
  live: InstanceStorage | undefined,
): void {
  if (storage === undefined || live === undefined) return;
  rollbackStagedInstanceStorage(storage);
  rollbackStagedHighlight(storage.highlight);
  const buffers = new Set<GPUBuffer>();
  if (storage.buffer !== live.buffer) buffers.add(storage.buffer);
  if (storage.orderBuffer !== live.orderBuffer) buffers.add(storage.orderBuffer);
  for (const kind of STAGED_SIDECARS) {
    const sidecar = storage.sidecars[kind];
    if (sidecar !== undefined && sidecar.buffer !== live.sidecars[kind]?.buffer)
      buffers.add(sidecar.buffer);
  }
  if (storage.highlightOwned && storage.highlight.buffer !== live.highlight.buffer)
    buffers.add(storage.highlight.buffer);
  for (const buffer of buffers) buffer.destroy();
}

/** Destroys geometry resources owned only by an uncommitted staging draw. */
export function destroyStagedGeometry(draw: DrawResources, partId: PartId): void {
  const primitives = draw.primitiveParts.get(partId);
  if (primitives !== undefined) {
    for (const resource of primitives.values()) destroyPartResource(resource);
    return;
  }
  const resource = draw.parts.get(partId);
  if (resource !== undefined) destroyPartResource(resource);
  const nodes = draw.nodeParts.get(partId);
  if (nodes !== undefined) destroyPartResource(nodes);
}
