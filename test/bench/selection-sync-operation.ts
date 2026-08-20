import { benchmarkCaseSpecs, createBenchmarkCase } from "../../demo/benchmark/model";
import { getPartSemanticIndex } from "../../src/geometry/part-semantic-index";
import type { Part, PartId } from "../../src/geometry/part";
import { createInteractionState, type InteractionState } from "../../src/interaction/interaction";
import { readInteractionState } from "../../src/interaction/state";
import { setTargetsSelected } from "../../src/interaction/targets";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { buildInstanceLayout, buildSelectionOrder } from "../../src/renderer/runtime-state";
import { buildSelectionDrawCalls } from "../../src/renderer/selection/draw-ranges";
import {
  collectDenseElementSelections,
  denseSelectionContains,
  type DenseElementSelection,
  type DenseElementSelections,
} from "../../src/renderer/selection/element-selection";
import {
  writeDenseSelectionData,
  writeSelectionHeader,
} from "../../src/renderer/selection/highlight-selection-storage";
import { createHighlightStorage } from "../../src/renderer/selection/highlight-storage";
import { HIGHLIGHT_HEADER } from "../../src/renderer/selection/highlight-layout";
import { fakeGpuDevice, installGpuGlobals } from "../renderer/fake-gpu";
import type { OperationSpec } from "./operation-report";
import { countDenseSkinNeighborFaceEntries } from "./selection-sync-probe";

const ELEMENT_COUNT = 131_712;
const HALF_COUNT = ELEMENT_COUNT / 2;
const DENSE_WORD_COUNT = Math.ceil(ELEMENT_COUNT / 32);
const DENSE_PAYLOAD_BYTES = 4 + DENSE_WORD_COUNT * Uint32Array.BYTES_PER_ELEMENT;
const PART_ID = 1;
const CASES = ["half", "all-but-one", "all"] as const;
type CaseId = (typeof CASES)[number];
const EXPECTED_NEIGHBOR_FACE_ENTRIES: Readonly<Record<CaseId, number>> = {
  half: 12_159,
  "all-but-one": 3,
  all: 0,
};
const EXPECTED_NEIGHBOR_CSR_BYTES = 2_596_612;

interface SelectionCase {
  readonly id: CaseId;
  readonly interaction: InteractionState;
  readonly denseSelections: DenseElementSelections;
  readonly order: Uint32Array;
  readonly selectedCount: number;
}
interface SelectionFixture {
  readonly part: Part;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly runtime: ReturnType<typeof createPackedSceneRuntime>;
  readonly layout: ReturnType<typeof buildInstanceLayout>;
  readonly partOccurrenceId: string;
  readonly cases: ReadonlyMap<CaseId, SelectionCase>;
  readonly denseSkinNeighborFaceEntries: ReadonlyMap<CaseId, number>;
}

/** Builds the Tet4 selection fixture and all immutable operation inputs. */
export function createSelectionFixture(): SelectionFixture {
  const spec = benchmarkCaseSpecs(false).find((candidate) => candidate.id === "fe-tet4-solid-132k");
  if (spec === undefined) throw new Error("Tet4 benchmark specification is missing");
  const benchmark = createBenchmarkCase(spec);
  const parts = benchmark.scene.parts;
  const part = parts.get(PART_ID);
  if (part === undefined) throw new Error("Tet4 benchmark part is missing");
  const runtime = createPackedSceneRuntime(benchmark.scene);
  const layout = buildInstanceLayout(runtime);
  const partOccurrenceId = runtime.getInstanceId(0);
  if (partOccurrenceId === undefined) throw new Error("Tet4 benchmark instance is missing");
  const targets = [...(part.elements ?? [])].map((element) => ({
    kind: "element" as const,
    partOccurrenceId,
    elementId: element.id,
  }));
  if (targets.length !== ELEMENT_COUNT) throw new Error("Tet4 element count changed");
  const interactions = new Map<CaseId, InteractionState>([
    ["half", setTargetsSelected(createInteractionState(), targets.slice(0, HALF_COUNT), true)],
    ["all-but-one", setTargetsSelected(createInteractionState(), targets.slice(0, -1), true)],
    ["all", setTargetsSelected(createInteractionState(), targets, true)],
  ]);
  const cases = new Map<CaseId, SelectionCase>();
  for (const id of CASES) {
    const interaction = interactions.get(id);
    if (interaction === undefined) throw new Error(`Missing ${id} interaction`);
    const denseSelections = collectDenseElementSelections(runtime, layout, parts, interaction);
    const order = buildSelectionOrder(layout, runtime, PART_ID, interaction, parts);
    cases.set(id, {
      id,
      interaction,
      denseSelections,
      order,
      selectedCount:
        id === "half" ? HALF_COUNT : id === "all-but-one" ? ELEMENT_COUNT - 1 : ELEMENT_COUNT,
    });
  }
  const denseSkinNeighborFaceEntries = new Map(
    CASES.map((id) => {
      const selected = cases.get(id);
      if (selected === undefined) throw new Error(`Missing ${id} selection case`);
      return [
        id,
        countDenseSkinNeighborFaceEntries({
          part,
          runtime,
          layout,
          partId: PART_ID,
          interaction: selected.interaction,
          order: selected.order,
          denseSelections: selected.denseSelections,
        }),
      ] as const;
    }),
  );
  assertNeighborFixture(part, denseSkinNeighborFaceEntries);
  return { part, parts, runtime, layout, partOccurrenceId, cases, denseSkinNeighborFaceEntries };
}

/** Returns the dense selection operation matrix. */
export function selectionSyncOperations(fixture: SelectionFixture): readonly OperationSpec[] {
  const operations: OperationSpec[] = [];
  for (const id of ["half", "all-but-one", "all"] as const) {
    const selected = requireCase(fixture, id);
    operations.push(
      buildDensePayloadOperation(fixture, selected),
      drawRangeOperation(fixture, selected),
    );
  }
  operations.push(unchangedCollectOperation(fixture));
  return operations;
}

function buildDensePayloadOperation(
  fixture: SelectionFixture,
  selected: SelectionCase,
): OperationSpec {
  // Nine distinct immutable states cover two warmups and seven timed samples;
  // the selected-element map identity is never served from cache.
  const inputs = Array.from({ length: 9 }, () => cloneInteraction(fixture, selected.interaction));
  const storage = createSelectionStorage(selected);
  return {
    name: `selection-${selected.id}-build-dense-payload`,
    workloadUnit: "authored elements collected and packed into dense highlight payload",
    workloadCount: selected.selectedCount,
    workloadDetails: details(fixture, selected),
    run: () => {
      const interaction = inputs.shift();
      if (interaction === undefined) throw new Error("Selection collect sample input exhausted");
      const dense = collectDenseElementSelections(
        fixture.runtime,
        fixture.layout,
        fixture.parts,
        interaction,
      );
      const selection = dense.get(PART_ID);
      assertDenseSelection(selection, selected.selectedCount);
      writeDenseSelectionData(storage.data, storage, selection);
      assertDensePayload(storage.data, selected.selectedCount);
    },
  };
}

function drawRangeOperation(fixture: SelectionFixture, selected: SelectionCase): OperationSpec {
  return {
    name: `selection-${selected.id}-build-draw-ranges`,
    workloadUnit: "selected occurrence draw-call construction",
    workloadCount: selected.selectedCount,
    workloadDetails: details(fixture, selected),
    run: () => {
      const calls = buildSelectionDrawCalls({
        layout: fixture.layout,
        runtime: fixture.runtime,
        partId: PART_ID,
        interaction: selected.interaction,
        part: fixture.part,
        order: selected.order,
        denseSelections: selected.denseSelections,
      });
      if (selected.id === "half" && calls !== undefined) {
        throw new Error("Half selection should retain the range-cap fallback");
      }
      if (
        selected.id === "all-but-one" &&
        (calls?.length !== 2 ||
          calls[0]?.surfaceSubset !== true ||
          (calls[1]?.selectionRanges?.length ?? 0) === 0)
      ) {
        throw new Error("All-but-one selection did not build the expected skin ranges");
      }
      if (
        selected.id === "all" &&
        (calls?.length !== 1 ||
          calls[0]?.surfaceSubset !== true ||
          calls[0].selectionRanges !== undefined)
      ) {
        throw new Error("All selection did not build the expected surface skin");
      }
    },
  };
}

function unchangedCollectOperation(fixture: SelectionFixture): OperationSpec {
  const selected = requireCase(fixture, "all");
  const dense = collectDenseElementSelections(
    fixture.runtime,
    fixture.layout,
    fixture.parts,
    selected.interaction,
  ).get(PART_ID);
  return {
    name: "selection-all-unchanged-repeat-collect-cache",
    workloadUnit: "unchanged selected authored elements",
    workloadCount: ELEMENT_COUNT,
    workloadDetails: details(fixture, selected),
    run: () => {
      const next = collectDenseElementSelections(
        fixture.runtime,
        fixture.layout,
        fixture.parts,
        selected.interaction,
      ).get(PART_ID);
      if (next !== dense) throw new Error("Unchanged dense selection missed its identity cache");
    },
  };
}

function createSelectionStorage(selected: SelectionCase) {
  installGpuGlobals();
  const device = fakeGpuDevice().device;
  const storage = createHighlightStorage(device, 1, {
    selectionSlotCapacity: 1,
    selectionRecordCapacity: 1,
    selectionWordCapacity: DENSE_WORD_COUNT,
  });
  const header = new Uint8Array(HIGHLIGHT_HEADER);
  const dense = selected.denseSelections.get(PART_ID);
  writeSelectionHeader(new Uint32Array(header.buffer), storage, dense, undefined);
  storage.data.set(header);
  writeDenseSelectionData(storage.data, storage, dense);
  return storage;
}

function assertDensePayload(data: Uint8Array, selectedCount: number): void {
  const view = new Uint32Array(data.buffer);
  const bitsWord = view[5] ?? 0;
  const dataBase = HIGHLIGHT_HEADER / 4;
  const lastBit = selectedCount - 1;
  const firstWord = view[dataBase + bitsWord] ?? 0;
  const lastWord = view[dataBase + bitsWord + (lastBit >> 5)] ?? 0;
  if ((firstWord & 1) === 0 || (lastWord & (1 << (lastBit & 31))) === 0) {
    throw new Error("Dense selection payload lost its first or last authored element");
  }
}

function assertDenseSelection(
  selection: DenseElementSelection | undefined,
  selectedCount: number,
): void {
  const occurrence = selection?.occurrences[0];
  if (
    selection?.occurrences.length !== 1 ||
    occurrence === undefined ||
    !denseSelectionContains(selection, occurrence.slot, 1) ||
    !denseSelectionContains(selection, occurrence.slot, selectedCount)
  ) {
    throw new Error("Dense selection lost its first or last authored element");
  }
}

function cloneInteraction(
  fixture: SelectionFixture,
  interaction: InteractionState,
): InteractionState {
  const selected = readInteractionState(interaction).selectedElementIds.get(
    fixture.partOccurrenceId,
  );
  if (selected === undefined || selected.size === 0) return createInteractionState();
  return setTargetsSelected(
    createInteractionState(),
    [...selected].map((elementId) => ({
      kind: "element" as const,
      partOccurrenceId: fixture.partOccurrenceId,
      elementId,
    })),
    true,
  );
}

function requireCase(fixture: SelectionFixture, id: CaseId): SelectionCase {
  const selected = fixture.cases.get(id);
  if (selected === undefined) throw new Error(`Missing selection case ${id}`);
  return selected;
}

function details(
  fixture: SelectionFixture,
  selected: SelectionCase,
): Readonly<Record<string, number>> {
  const triangles = fixture.part.geometries.find((geometry) => geometry.primitive === "triangles");
  const authoredFaceCount =
    triangles?.primitive === "triangles" ? (triangles.faces?.count ?? 0) : 0;
  const boundaryFaceCount =
    triangles?.primitive === "triangles" ? (triangles.faceSubset?.count ?? 0) : 0;
  const semantic = getPartSemanticIndex(fixture.part);
  return {
    selectedElements: selected.selectedCount,
    occurrenceCount: 1,
    elementCount: ELEMENT_COUNT,
    authoredFaceCount,
    boundaryFaceCount,
    densePayloadBytes: DENSE_PAYLOAD_BYTES,
    denseWordCount: DENSE_WORD_COUNT,
    denseSkinNeighborFaceEntries: fixture.denseSkinNeighborFaceEntries.get(selected.id) ?? 0,
    neighborTriangleCsrBytes:
      semantic.neighborTriangleFaceOffsets.byteLength + semantic.neighborTriangleFaceIds.byteLength,
  };
}

function assertNeighborFixture(part: Part, entries: ReadonlyMap<CaseId, number>): void {
  const semantic = getPartSemanticIndex(part);
  const retainedBytes =
    semantic.neighborTriangleFaceOffsets.byteLength + semantic.neighborTriangleFaceIds.byteLength;
  if (retainedBytes !== EXPECTED_NEIGHBOR_CSR_BYTES) {
    throw new Error(`Neighbor CSR bytes changed: expected ${EXPECTED_NEIGHBOR_CSR_BYTES}`);
  }
  for (const id of CASES) {
    if (entries.get(id) !== EXPECTED_NEIGHBOR_FACE_ENTRIES[id]) {
      throw new Error(`Neighbor CSR entries changed for ${id}`);
    }
  }
}
