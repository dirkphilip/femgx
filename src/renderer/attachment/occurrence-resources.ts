import type { PartId } from "../../geometry/part";
import { destroyDeformationBuffer } from "../frame/deformation";
import { destroyOrientationGlyphPart } from "../orientation-glyphs/orientation-glyph";
import { destroyInstancePartResources, type DrawResources } from "../resources/draw-resources";
import { destroyResultColorBuffer } from "../resources/result-colors";
import { destroyDetachedVisibilitySkinCache } from "../visibility/skins";
import { stagedPartRevisionKeys } from "./part-revision-overlay";
import { destroyStagedGeometry, destroyStagedStorage } from "./part-revision-cleanup";

/** Releases only overlay-owned resources from an occurrence transaction. */
export function discardStagedOccurrenceResources(
  draw: DrawResources,
  live: DrawResources,
  partIds: ReadonlySet<PartId>,
): void {
  for (const partId of partIds) {
    const current = live.storages.get(partId);
    if (current === undefined) destroyInstancePartResources(draw, partId);
    else destroyStagedStorage(draw.storages.get(partId), current);
  }
  discardVisibilitySkins(draw, live);
  discardGeometry(draw, live);
  discardResults(draw, live, partIds);
  if (draw.orientationGlyphs.paramsBuffer !== live.orientationGlyphs.paramsBuffer)
    draw.orientationGlyphs.paramsBuffer?.destroy();
}

function discardVisibilitySkins(draw: DrawResources, live: DrawResources): void {
  for (const partId of stagedPartRevisionKeys(draw.visibilitySkins)) {
    const skins = draw.visibilitySkins.get(partId);
    if (skins !== undefined && skins !== live.visibilitySkins.get(partId))
      destroyDetachedVisibilitySkinCache(draw, skins);
  }
}

function discardGeometry(draw: DrawResources, live: DrawResources): void {
  for (const partId of stagedPartRevisionKeys(draw.parts)) {
    if (draw.parts.get(partId) !== live.parts.get(partId)) destroyStagedGeometry(draw, partId);
  }
}

function discardResults(
  draw: DrawResources,
  live: DrawResources,
  partIds: ReadonlySet<PartId>,
): void {
  for (const partId of partIds) {
    if (draw.deformations.get(partId) !== live.deformations.get(partId))
      destroyDeformationBuffer(draw.deformations, partId, draw.cost);
    if (draw.resultColors.get(partId) !== live.resultColors.get(partId))
      destroyResultColorBuffer(draw, partId);
    if (draw.orientationGlyphs.parts.get(partId) !== live.orientationGlyphs.parts.get(partId))
      destroyOrientationGlyphPart(draw.orientationGlyphs, partId);
  }
}
