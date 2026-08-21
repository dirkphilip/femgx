import { describe, expect, it } from "vitest";
import {
  createElementRegionSelection,
  createInteractionState,
  selectedElementRegion,
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

  it.skipIf(exposedGc() === undefined)(
    "records broad heap and forced-GC evidence without a machine-specific budget",
    () => {
      const evidence = measureHeapAndGc();
      expect(evidence.peakSampledHeapUsedBytes).toBeGreaterThanOrEqual(
        evidence.baselineHeapUsedBytes,
      );
      expect(evidence.forcedGcCount).toBe(2);
      process.stdout.write(`${JSON.stringify(evidence)}\n`);
    },
  );
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
    descriptorObjects: 0,
    targetKeyStrings: 0,
    descriptorExpansionCallbacks: 0,
    temporaryDedupSets: 0,
    stateMapPublications: 1,
    touchedOccurrenceSetClones: region.occurrenceCount,
  };
}

function measureHeapAndGc(): {
  readonly schemaVersion: 1;
  readonly kind: "packed-element-region-heap-gc-evidence";
  readonly method: string;
  readonly count: number;
  readonly occurrenceGroups: number;
  readonly baselineHeapUsedBytes: number;
  readonly peakSampledHeapUsedBytes: number;
  readonly postReleaseHeapUsedBytes: number;
  readonly forcedGcCount: number;
  readonly forcedGcP95Ms: number;
} {
  const gcTimes: number[] = [];
  forceGc(gcTimes);
  const heapSamples = sampleHeapUse();
  forceGc(gcTimes);
  const postReleaseHeapUsedBytes = process.memoryUsage().heapUsed;
  return {
    schemaVersion: 1,
    kind: "packed-element-region-heap-gc-evidence",
    method:
      "Node --expose-gc; heapUsed sampled after query output, direct state apply, and state inspection",
    count: 1_000_000,
    occurrenceGroups: 4,
    baselineHeapUsedBytes: heapSamples[0] ?? 0,
    peakSampledHeapUsedBytes: Math.max(...heapSamples),
    postReleaseHeapUsedBytes,
    forcedGcCount: gcTimes.length,
    forcedGcP95Ms: gcTimes.sort((left, right) => left - right).at(-1) ?? 0,
  };
}

function sampleHeapUse(): readonly number[] {
  const heapSamples = [process.memoryUsage().heapUsed];
  const selection = createElementRegionSelection(denseGroups(1_000_000, 4));
  heapSamples.push(process.memoryUsage().heapUsed);
  const state = setElementRegionSelected(createInteractionState(), selection, "replace");
  heapSamples.push(process.memoryUsage().heapUsed);
  const snapshot = selectedElementRegion(state);
  if (snapshot.count !== 1_000_000) throw new Error("Element region state inspection lost ids");
  heapSamples.push(process.memoryUsage().heapUsed);
  return heapSamples;
}

function forceGc(gcTimes: number[]): void {
  const gc = exposedGc();
  if (gc === undefined)
    throw new Error("Packed element region heap evidence requires Node --expose-gc");
  const start = performance.now();
  gc();
  gcTimes.push(performance.now() - start);
}

function exposedGc(): (() => void) | undefined {
  return (globalThis as { readonly gc?: () => void }).gc;
}
