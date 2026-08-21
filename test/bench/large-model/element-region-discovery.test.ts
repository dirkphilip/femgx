import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPart, identityMatrix, type Part, type Scene, type Viewport } from "@/entries/root";
import {
  createInteractionState,
  installViewportInteraction,
  selectedElementRegion,
  type ElementRegionSelection,
  type ViewportInteractionOptions,
} from "@/entries/interaction";
import { createCamera } from "@/entries/camera";
import { createSceneOccurrenceSnapshot } from "@/scene-runtime/occurrences";
import { pickTargetsFromRegion, type PickRegionProbe } from "@/renderer/picking/region";
import { createPickDepthReadback } from "@/renderer/picking/depth";
import { createPickTargets, ensurePickTargets } from "@/renderer/picking/pick";
import {
  viewportInteractionProbeKey,
  type ViewportInteractionProbe,
} from "@/interaction/viewport-interaction-types";
import {
  throughIntersectionBoxSelectionResolver,
  type ThroughBoxSelectionProbe,
} from "../../../demo/workbench/selection/through-box-selection";
import { createPlanarGridGeometry } from "../../../demo/fixtures/planar-grid";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "../../renderer/fake-gpu";
import {
  installFakeWindow,
  pointer,
  restoreFakeWindow,
  settle,
  viewportHarness,
} from "../../interaction/viewport-interaction-support";
import {
  buildAsyncOperationsReport,
  emitOperationsReport,
  type AsyncOperationSpec,
} from "../operation-report";
import { exposedGc, forceGc } from "./gc-evidence";
import { assertActualElementRegionEvidence } from "./element-region-discovery-evidence";

const CELLS = 354;
const IDS_PER_OCCURRENCE = CELLS * CELLS * 2;
const BROAD_RECT = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };

interface EvidenceRunner {
  readonly operation: AsyncOperationSpec;
  readonly details: Readonly<Record<string, number>>;
  run(): Promise<void>;
  selection(): ElementRegionSelection;
  clear(): void;
}

let restoreGpu: (() => void) | undefined;
let part: Part;
let visibleOne: EvidenceRunner;
let visibleFour: EvidenceRunner;
let throughOne: EvidenceRunner;
let throughFour: EvidenceRunner;
let lifecycle: EvidenceRunner;

beforeAll(async () => {
  restoreGpu = installGpuGlobals();
  installFakeWindow();
  part = densePart();
  visibleOne = await visibleRunner(part, 1);
  visibleFour = await visibleRunner(part, 4);
  throughOne = throughRunner(part, 1);
  throughFour = throughRunner(part, 4);
  lifecycle = lifecycleRunner(visibleFour);
}, 60_000);

afterAll(() => {
  restoreFakeWindow();
  restoreGpu?.();
});

describe("actual packed element-region discovery evidence", () => {
  it("reports visible, Through, and callback/default work from 250k through one million ids", async () => {
    const runners = [visibleOne, visibleFour, throughOne, throughFour, lifecycle];
    const report = await buildAsyncOperationsReport(runners.map((runner) => runner.operation));
    expect(report.operations).toHaveLength(runners.length);
    for (const operation of report.operations) {
      expect(operation.timingsMs.p50).toBeGreaterThanOrEqual(0);
      expect(operation.timingsMs.p95).toBeGreaterThanOrEqual(operation.timingsMs.p50);
    }
    assertActualElementRegionEvidence(
      [
        visibleOne.details,
        visibleFour.details,
        throughOne.details,
        throughFour.details,
        lifecycle.details,
      ],
      IDS_PER_OCCURRENCE,
    );
    emitOperationsReport(report);
  }, 60_000);

  it.skipIf(exposedGc() === undefined)(
    "records heap and forced-GC evidence around the actual broad paths without a budget",
    async () => {
      clearSelections();
      const gcTimes: number[] = [];
      forceGc(gcTimes);
      const baselineHeapUsedBytes = process.memoryUsage().heapUsed;
      const heapSamples = await sampleActualHeapUse();
      forceGc(gcTimes);
      const evidence = {
        schemaVersion: 1,
        kind: "actual-element-region-heap-gc-evidence",
        method:
          "Node --expose-gc; heapUsed sampled after actual visible discovery, Through discovery, and callback/default application",
        selectedIdentities: IDS_PER_OCCURRENCE * 4,
        occurrenceGroups: 4,
        baselineHeapUsedBytes,
        peakSampledHeapUsedBytes: Math.max(baselineHeapUsedBytes, ...heapSamples),
        postReleaseHeapUsedBytes: process.memoryUsage().heapUsed,
        forcedGcCount: gcTimes.length,
        forcedGcP95Ms: Math.max(...gcTimes),
        visible: visibleFour.details,
        through: throughFour.details,
        lifecycle: lifecycle.details,
      };
      expect(evidence.peakSampledHeapUsedBytes).toBeGreaterThanOrEqual(baselineHeapUsedBytes);
      process.stdout.write(`${JSON.stringify(evidence)}\n`);
    },
    60_000,
  );
});

async function visibleRunner(sourcePart: Part, occurrenceCount: number): Promise<EvidenceRunner> {
  const width = occurrenceCount === 1 ? 708 : 1_416;
  const height = occurrenceCount === 1 ? 354 : 708;
  const probe = emptyVisibleProbe();
  const details: Record<string, number> = {};
  const gpu = fakeGpuDevice({ pickValueAt: pickValueAt(width, occurrenceCount) });
  const pick = createPickTargets(await createPickDepthReadback(gpu.device));
  ensurePickTargets(gpu.device, pick, width, height, "depth24plus");
  let latest: ElementRegionSelection | undefined;
  const run = async (): Promise<void> => {
    resetValues(probe);
    const result = await pickTargetsFromRegion({
      device: gpu.device,
      canvas: fakeCanvas(width, height),
      pick,
      readback: pick.readback,
      context: {
        instances: Array.from({ length: occurrenceCount }, (_, index) => ({
          partOccurrenceId: `visible/${index}`,
          partId: sourcePart.id,
          worldTransform: identityMatrix(),
        })),
        parts: new Map([[sourcePart.id, sourcePart]]),
      },
      rect: { left: 0, top: 0, right: width, bottom: height, width, height },
      granularity: "element",
      probe,
    });
    latest = packed(result);
    assertSelection(latest, occurrenceCount);
    Object.assign(details, probe, selectionDetails(latest));
  };
  return evidenceRunner(
    `visible-element-region-${occurrenceCount}-occurrences`,
    details,
    run,
    () => latest,
    (value) => {
      latest = value;
    },
  );
}

function throughRunner(sourcePart: Part, occurrenceCount: number): EvidenceRunner {
  const probe = emptyThroughProbe();
  const details: Record<string, number> = {};
  const viewport = throughViewport(sourcePart, occurrenceCount);
  const resolver = throughIntersectionBoxSelectionResolver(() => viewport, probe);
  let latest: ElementRegionSelection | undefined;
  const run = async (): Promise<void> => {
    resetValues(probe);
    latest = packed(await resolver({ event: boxEvent(), granularity: "element" }));
    assertSelection(latest, occurrenceCount);
    Object.assign(details, probe, selectionDetails(latest));
  };
  return evidenceRunner(
    `through-element-region-${occurrenceCount}-occurrences`,
    details,
    run,
    () => latest,
    (value) => {
      latest = value;
    },
  );
}

function lifecycleRunner(source: EvidenceRunner): EvidenceRunner {
  const probe = emptyLifecycleProbe();
  const details: Record<string, number> = {};
  let latest: ElementRegionSelection | undefined;
  const run = async (): Promise<void> => {
    resetValues(probe);
    let boxCallbacks = 0;
    let applyCallbacks = 0;
    const discovered = source.selection();
    const harness = viewportHarness();
    const options = {
      canvas: harness.canvas as unknown as HTMLCanvasElement,
      viewport: harness.viewport,
      granularity: () => "element" as const,
      resolveRegion: () => Promise.resolve(discovered),
      [viewportInteractionProbeKey]: probe,
      onBoxSelection: (box) => {
        if (box.granularity !== "element") throw new Error("Expected packed box callback");
        boxCallbacks += 1;
        box.selection.elementIds.fill(99);
      },
      applyInteraction: (request) => {
        if (request.phase !== "box" || request.granularity !== "element") {
          throw new Error("Expected packed apply callback");
        }
        applyCallbacks += 1;
        request.selection.offsets.fill(0);
        return request.defaultInteraction;
      },
    } satisfies ViewportInteractionOptions & {
      readonly [viewportInteractionProbeKey]: ViewportInteractionProbe;
    };
    const disposer = installViewportInteraction(options);
    harness.canvas.dispatch("pointerdown", pointer({ buttons: 1 }));
    harness.canvas.dispatch("pointerup", pointer({ clientX: 100, clientY: 100 }));
    await settle();
    disposer();
    latest = selectedElementRegion(harness.viewport.interaction.state);
    assertSelection(latest, 4);
    Object.assign(details, probe, { boxCallbacks, applyCallbacks }, selectionDetails(latest));
  };
  return evidenceRunner(
    "element-region-callback-default-lifecycle",
    details,
    run,
    () => latest,
    (value) => {
      latest = value;
    },
  );
}

function evidenceRunner(
  name: string,
  details: Readonly<Record<string, number>>,
  run: () => Promise<void>,
  read: () => ElementRegionSelection | undefined,
  write: (value: ElementRegionSelection | undefined) => void,
): EvidenceRunner {
  return {
    operation: {
      name,
      workloadUnit: "selected authored element occurrences",
      workloadCount: name.includes("1-occurrences") ? IDS_PER_OCCURRENCE : IDS_PER_OCCURRENCE * 4,
      workloadDetails: details,
      run,
    },
    details,
    run,
    selection: () => requireSelection(read()),
    clear: () => {
      write(undefined);
    },
  };
}

function throughViewport(sourcePart: Part, occurrenceCount: number): Viewport {
  const scene: Scene = {
    rootAssemblyId: 1,
    parts: new Map([[sourcePart.id, sourcePart]]),
    assemblies: new Map([
      [
        1,
        {
          id: 1,
          name: "root",
          placements: Array.from({ length: occurrenceCount }, (_, index) => ({
            kind: "part" as const,
            placementId: `through-${index}`,
            partId: sourcePart.id,
            transform: identityMatrix(),
          })),
        },
      ],
    ]),
    visiblePartIds: new Set([sourcePart.id]),
    visibleAssemblyIds: new Set([1]),
  };
  return {
    scene,
    occurrences: createSceneOccurrenceSnapshot(scene),
    view: {
      camera: createCamera({
        mode: "orthographic",
        position: [0.5, 0.5, 10],
        target: [0.5, 0.5, 0],
        up: [0, 1, 0],
        width: 800,
        height: 600,
        orthoHeight: 2,
      }),
    },
    interaction: { state: createInteractionState() },
    results: { state: undefined },
    presentation: { sectionPlane: undefined },
  } as unknown as Viewport;
}

function densePart(): Part {
  const grid = createPlanarGridGeometry(CELLS, { elementFamily: "triangle" });
  return createPart(1, {
    geometries: [grid.geometry],
    elements: grid.elements,
    nodePositions: grid.nodePositions,
  });
}

function pickValueAt(width: number, occurrenceCount: number) {
  return (sample: { readonly attachmentIndex: number; readonly x: number; readonly y: number }) => {
    const pixel = sample.y * width + sample.x;
    const group = Math.floor(pixel / IDS_PER_OCCURRENCE);
    if (group >= occurrenceCount) return 0;
    return sample.attachmentIndex === 0 ? group + 1 : (pixel % IDS_PER_OCCURRENCE) + 2;
  };
}

function assertSelection(selection: ElementRegionSelection, occurrenceCount: number): void {
  expect(selection.count).toBe(IDS_PER_OCCURRENCE * occurrenceCount);
  expect(selection.partOccurrenceIds).toHaveLength(occurrenceCount);
  for (let group = 0; group < occurrenceCount; group += 1) {
    const start = selection.offsets[group] ?? 0;
    const end = selection.offsets[group + 1] ?? 0;
    expect(selection.elementIds[start]).toBe(1);
    expect(selection.elementIds[end - 1]).toBe(IDS_PER_OCCURRENCE);
  }
}

function selectionDetails(selection: ElementRegionSelection): Readonly<Record<string, number>> {
  return {
    selectedIdentities: selection.count,
    occurrenceGroups: selection.partOccurrenceIds.length,
    queryOutputTypedBytes: selection.elementIds.byteLength + selection.offsets.byteLength,
  };
}

function boxEvent() {
  return {
    type: "complete" as const,
    anchor: { x: 0, y: 0 },
    current: { x: 800, y: 600 },
    rect: BROAD_RECT,
    modifiers: { shift: false, control: false, alt: false, meta: false },
  };
}

function packed(result: ElementRegionSelection | readonly unknown[]): ElementRegionSelection {
  if (Array.isArray(result)) throw new Error("Element discovery returned descriptors");
  return result as ElementRegionSelection;
}

function requireSelection(value: ElementRegionSelection | undefined): ElementRegionSelection {
  if (value === undefined) throw new Error("Element discovery has not produced a selection");
  return value;
}

function emptyVisibleProbe(): PickRegionProbe {
  return {
    rawIdentityObjects: 0,
    resolvedTargetDescriptors: 0,
    elementPickGroups: 0,
    elementPickIds: 0,
  };
}

function emptyThroughProbe(): ThroughBoxSelectionProbe {
  return {
    occurrencesVisited: 0,
    elementsVisited: 0,
    intersectionTests: 0,
    selectedIdentities: 0,
    groupsCreated: 0,
  };
}

function emptyLifecycleProbe(): ViewportInteractionProbe {
  return {
    descriptorVisits: 0,
    targetKeyStrings: 0,
    defaultElementTransitions: 0,
    callbackSelectionCopies: 0,
    statePublications: 0,
  };
}

function resetValues(values: object): void {
  for (const key of Object.keys(values)) (values as Record<string, number>)[key] = 0;
}

async function sampleActualHeapUse(): Promise<readonly number[]> {
  const samples: number[] = [];
  await visibleFour.run();
  samples.push(process.memoryUsage().heapUsed);
  await throughFour.run();
  samples.push(process.memoryUsage().heapUsed);
  await lifecycle.run();
  samples.push(process.memoryUsage().heapUsed);
  clearSelections();
  return samples;
}

function clearSelections(): void {
  visibleOne.clear();
  visibleFour.clear();
  throughOne.clear();
  throughFour.clear();
  lifecycle.clear();
}
