import { describe, expect, it } from "vitest";
import {
  createElementRegionSelection,
  createInteractionState,
  setElementRegionSelected,
  type ElementRegionSelection,
  type InteractionState,
} from "@/entries/interaction";
import { readInteractionState } from "@/interaction/state";
import {
  buildOperationsReport,
  emitOperationsReport,
  type OperationSpec,
} from "../operation-report";

const COUNTS = [1, 65_856, 131_712, 257_250, 1_000_000] as const;
const OCCURRENCE_COUNTS = [1, 4] as const;

interface RegionCase {
  readonly count: number;
  readonly occurrenceCount: number;
  readonly selection: ElementRegionSelection;
}

describe("packed element-region selection scaling", () => {
  it("reports direct replace p50/p95 and exact packed ownership through one million ids", () => {
    const cases = createCases();
    for (const region of cases) assertPackedRegion(region);
    const report = buildOperationsReport(cases.map(replaceOperation));
    expect(report.operations).toHaveLength(cases.length);
    for (const operation of report.operations) {
      expect(operation.timingsMs.p50).toBeGreaterThanOrEqual(0);
      expect(operation.timingsMs.p95).toBeGreaterThanOrEqual(operation.timingsMs.p50);
    }
    emitOperationsReport(report);
  });
});

function createCases(): readonly RegionCase[] {
  return COUNTS.flatMap((count) =>
    occurrenceCounts(count).map((occurrenceCount) => ({
      count,
      occurrenceCount,
      selection: createElementRegionSelection(denseGroups(count, occurrenceCount)),
    })),
  );
}

function occurrenceCounts(count: number): readonly number[] {
  return count < 4 ? [1] : OCCURRENCE_COUNTS;
}

function replaceOperation(region: RegionCase): OperationSpec {
  return {
    name: `packed-element-region-replace-${region.count}-ids-${region.occurrenceCount}-occurrences`,
    workloadUnit: "selected authored elements",
    workloadCount: region.count,
    workloadDetails: structuralDetails(region),
    run: () => {
      const state = setElementRegionSelected(createInteractionState(), region.selection, "replace");
      assertAppliedRegion(state, region);
    },
  };
}

function denseGroups(
  count: number,
  occurrenceCount: number,
): ReadonlyMap<string, ReadonlySet<number>> {
  const groups = new Map<string, ReadonlySet<number>>();
  for (let group = 0; group < occurrenceCount; group += 1) {
    const start = Math.floor((group * count) / occurrenceCount);
    const end = Math.floor(((group + 1) * count) / occurrenceCount);
    const ids = new Set<number>();
    for (let id = start + 1; id <= end; id += 1) ids.add(id);
    groups.set(`bench/${group}`, ids);
  }
  return groups;
}

function assertPackedRegion(region: RegionCase): void {
  const { count, occurrenceCount, selection } = region;
  expect(selection.count).toBe(count);
  expect(selection.partOccurrenceIds).toHaveLength(occurrenceCount);
  expect(selection.elementIds.byteLength + selection.offsets.byteLength).toBe(
    (count + occurrenceCount + 1) * Uint32Array.BYTES_PER_ELEMENT,
  );
  expect(selection.elementIds[0]).toBe(1);
  expect(selection.elementIds.at(-1)).toBe(count);
  for (let group = 0; group < occurrenceCount; group += 1) {
    const start = selection.offsets[group] ?? 0;
    const end = selection.offsets[group + 1] ?? 0;
    expect(selection.elementIds[start]).toBe(Math.floor((group * count) / occurrenceCount) + 1);
    expect(selection.elementIds[end - 1]).toBe(Math.floor(((group + 1) * count) / occurrenceCount));
  }
}

function assertAppliedRegion(state: InteractionState, region: RegionCase): void {
  const selected = readInteractionState(state).selectedElementIds;
  expect(selected.size).toBe(region.occurrenceCount);
  for (let group = 0; group < region.occurrenceCount; group += 1) {
    const start = Math.floor((group * region.count) / region.occurrenceCount) + 1;
    const end = Math.floor(((group + 1) * region.count) / region.occurrenceCount);
    const ids = selected.get(`bench/${group}`);
    expect(ids?.size).toBe(end - start + 1);
    expect(ids?.has(start)).toBe(true);
    expect(ids?.has(end)).toBe(true);
  }
}

function structuralDetails(region: RegionCase): Readonly<Record<string, number>> {
  return {
    occurrenceGroups: region.occurrenceCount,
    queryOutputTypedBytes:
      region.selection.elementIds.byteLength + region.selection.offsets.byteLength,
    queryOutputElementIdColumns: 1,
    queryOutputOffsetColumns: 1,
    queryOutputOccurrenceIdArrays: 1,
  };
}
