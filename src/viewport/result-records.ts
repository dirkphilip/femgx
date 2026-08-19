import type { ElementalOrientationRecords } from "../results/orientation-records";
import type { OrientationRecordMap } from "./results-roles";

/** Merges independent authored glyph roles at each shared or occurrence binding. */
export function mergeResultRecords(
  first: OrientationRecordMap | undefined,
  second: OrientationRecordMap | undefined,
): OrientationRecordMap | undefined {
  if (first === undefined && second === undefined) return undefined;
  const merged = new Map(first);
  for (const [bindingId, records] of second ?? []) {
    const current = merged.get(bindingId);
    merged.set(bindingId, current === undefined ? records : appendRecords(current, records));
  }
  return merged;
}

function appendRecords(
  first: ElementalOrientationRecords,
  second: ElementalOrientationRecords,
): ElementalOrientationRecords {
  const count = first.elementIds.length + second.elementIds.length;
  const records = {
    elementIds: new Uint32Array(count),
    bodyIds: new Uint32Array(count),
    anchors: new Float32Array(count * 3),
    referenceLengths: new Float32Array(count),
    directions: new Float32Array(count * 3),
    glyphModes: new Uint32Array(count),
    transformModes: new Uint32Array(count),
    lengthScales: new Float32Array(count),
    axisIndices: new Uint32Array(count),
    anchorDeltas:
      first.anchorDeltas === undefined && second.anchorDeltas === undefined
        ? undefined
        : new Float32Array(count * 3),
  };
  copyRecords(records, first, 0);
  copyRecords(records, second, first.elementIds.length);
  return records;
}

function copyRecords(
  target: ElementalOrientationRecords,
  source: ElementalOrientationRecords,
  offset: number,
): void {
  const count = source.elementIds.length;
  target.elementIds.set(source.elementIds, offset);
  target.bodyIds.set(source.bodyIds, offset);
  target.anchors.set(source.anchors, offset * 3);
  target.referenceLengths.set(source.referenceLengths, offset);
  target.directions.set(source.directions, offset * 3);
  target.glyphModes?.set(source.glyphModes ?? new Uint32Array(count), offset);
  target.transformModes?.set(source.transformModes ?? new Uint32Array(count), offset);
  target.lengthScales?.set(source.lengthScales ?? new Float32Array(count).fill(1), offset);
  target.axisIndices?.set(source.axisIndices ?? new Uint32Array(count), offset);
  target.anchorDeltas?.set(source.anchorDeltas ?? new Float32Array(count * 3), offset * 3);
}
