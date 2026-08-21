import type { PartId } from "../../geometry/part";
import { destroyDeformationBuffer } from "../frame/deformation";
import { destroyOrientationGlyphPart } from "../orientation-glyphs/orientation-glyph";
import type { DrawResources } from "../resources/draw-resources";
import { destroyResultColorBuffer } from "../resources/result-colors";
import type { PartRevisionResultState } from "./part-revision-results";

/** Publishes exact detached result resources and retires their prior live identities. */
export function commitStagedPartResults(
  draw: DrawResources,
  staged: DrawResources,
  partIds: ReadonlySet<PartId>,
  results: PartRevisionResultState | undefined,
): void {
  for (const partId of partIds) {
    replaceStagedResult(draw, staged, partId);
    transferPartResource(draw.deformations, staged.deformations, partId);
    transferPartResource(draw.resultColors, staged.resultColors, partId);
    transferPartResource(draw.orientationGlyphs.parts, staged.orientationGlyphs.parts, partId);
  }
  if (draw.orientationGlyphs.paramsBuffer !== staged.orientationGlyphs.paramsBuffer) {
    draw.orientationGlyphs.paramsBuffer?.destroy();
    draw.orientationGlyphs.paramsBuffer = staged.orientationGlyphs.paramsBuffer;
  }
  new Uint8Array(draw.orientationGlyphs.paramsData).set(
    new Uint8Array(staged.orientationGlyphs.paramsData),
  );
  draw.orientationGlyphs.state = results?.glyphs;
}

function replaceStagedResult(draw: DrawResources, staged: DrawResources, partId: PartId): void {
  if (draw.deformations.get(partId) !== staged.deformations.get(partId)) {
    destroyDeformationBuffer(draw.deformations, partId, draw.cost);
  }
  if (draw.resultColors.get(partId) !== staged.resultColors.get(partId)) {
    destroyResultColorBuffer(draw, partId);
  }
  if (draw.orientationGlyphs.parts.get(partId) !== staged.orientationGlyphs.parts.get(partId)) {
    destroyOrientationGlyphPart(draw.orientationGlyphs, partId);
  }
}

function transferPartResource<T>(
  target: Map<PartId, T>,
  source: ReadonlyMap<PartId, T>,
  partId: PartId,
): void {
  const resource = source.get(partId);
  if (resource === undefined) target.delete(partId);
  else target.set(partId, resource);
}
