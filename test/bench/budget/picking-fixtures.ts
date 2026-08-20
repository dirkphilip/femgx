import { createPart, type GeometryInput } from "../../../src/entries/root";
import { createPickRegionTargetResolver } from "../../../src/renderer/picking/region-resolver";
import type { PickContext, ResolvedPickIds } from "../../../src/picking/pick";

function makeRegionCase(elementCount: number) {
  const geometry: GeometryInput = {
    positions: new Float32Array(elementCount * 3),
    indices: Uint32Array.from({ length: elementCount }, (_, index) => index),
    primitive: "points",
  };
  const elements = Array.from({ length: elementCount }, (_, index) => ({
    id: index + 1,
    primitiveRanges: [{ primitive: "points" as const, primitiveStart: index, primitiveCount: 1 }],
  }));
  const part = createPart(5000 + elementCount, { geometries: [geometry], elements });
  const context: PickContext = {
    instances: [
      {
        partOccurrenceId: "benchmark/0",
        partId: part.id,
        worldTransform: new Float32Array(16),
      },
    ],
    parts: new Map([[part.id, part]]),
  };
  const ids: ResolvedPickIds[] = Array.from({ length: elementCount }, (_, index) => ({
    instancePickId: 1,
    elementPickId: index + 1,
    facePickId: 0,
    nodePickId: 0,
  }));
  return { part, context, ids };
}

const regionCases = [makeRegionCase(16_384), makeRegionCase(100_000)] as const;
const regionResolvers = regionCases.map(({ context }) =>
  createPickRegionTargetResolver(context, "element"),
);

export { regionCases, regionResolvers };
