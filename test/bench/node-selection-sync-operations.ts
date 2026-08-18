import { createInteractionState } from "../../src/interaction/interaction";
import { readInteractionState } from "../../src/interaction/state";
import { setTargetsSelected } from "../../src/interaction/targets";
import type { GpuBundle } from "../../src/renderer/recovery";
import { buildNodeSelectionOrder } from "../../src/renderer/runtime-state";
import { syncSelectionState } from "../../src/renderer/selection-state";
import { collectDenseNodeSelections } from "../../src/renderer/selection/node-selection";
import {
  collectEmphasisUpdates,
  ELEMENT_RECORD_STRIDE,
  type EmphasisUpdates,
} from "../../src/renderer/resources/element-resources";
import {
  createDrawResources,
  type InstanceStorage,
} from "../../src/renderer/resources/draw-resources";
import {
  createHighlightStorage,
  writeElementHighlights,
} from "../../src/renderer/selection/highlight-storage";
import { HIGHLIGHT_HEADER } from "../../src/renderer/selection/highlight-layout";
import { fakeGpuDevice, installGpuGlobals } from "../renderer/fake-gpu";
import type { OperationSpec } from "./operation-report";
import type { NodeCase, NodeCaseId, NodeSelectionFixture } from "./node-selection-sync-operation";
import {
  assertNodeSync,
  assertSelectedNodeTotal,
  denseNodeBytes,
  details,
  highlightStorageBytes,
  PART_ID,
  SAMPLE_COUNT,
  selectedFlags,
} from "./node-selection-sync-shared";

/** Creates the measured construction, collection, upload, and order operations. */
export function buildNodeSelectionCaseOperations(
  fixture: NodeSelectionFixture,
  id: NodeCaseId,
): readonly OperationSpec[] {
  const selected = requireCase(fixture, id);
  return [
    interactionOperation(fixture, selected),
    denseSelectionOperation(fixture, selected),
    emphasisCollectionOperation(fixture, selected),
    highlightUploadOperation(fixture, selected),
    nodeOrderOperation(fixture, selected),
    nodeSyncOperation(fixture, selected),
  ];
}

function interactionOperation(fixture: NodeSelectionFixture, selected: NodeCase): OperationSpec {
  return {
    name: `node-${selected.id}-build-interaction-state`,
    workloadUnit: "node targets inserted into immutable interaction state",
    workloadCount: selected.selectedNodeCount,
    workloadDetails: details(fixture, selected),
    run: () => {
      const next = setTargetsSelected(createInteractionState(), selected.targets, true);
      assertSelectedNodeTotal(next, selected.selectedNodeCount);
    },
  };
}

function denseSelectionOperation(fixture: NodeSelectionFixture, selected: NodeCase): OperationSpec {
  const selection = selected.denseNodeSelections.get(PART_ID);
  const words = selection === undefined ? 0 : Math.ceil(fixture.nodeCount / 32);
  const inputs = Array.from({ length: SAMPLE_COUNT }, () =>
    setTargetsSelected(createInteractionState(), selected.targets, true),
  );
  let sample = 0;
  return {
    name: `node-${selected.id}-build-dense-selection-cold`,
    workloadUnit: "selected node ids classified and profitable bitsets constructed",
    workloadCount: selected.selectedNodeCount,
    workloadDetails: {
      ...details(fixture, selected),
      denseOccurrenceCount: selection?.occurrences.length ?? 0,
      denseNodeWordCount: words,
      denseSelectionSlotBytes:
        selection === undefined
          ? 0
          : (fixture.layout.partSlots.get(PART_ID)?.length ?? 0) * Uint32Array.BYTES_PER_ELEMENT,
      denseSelectionBitsetBytes:
        (selection?.occurrences.length ?? 0) * words * Uint32Array.BYTES_PER_ELEMENT,
    },
    run: () => {
      const interaction = inputs[sample];
      if (interaction === undefined) throw new Error("Node collect sample input exhausted");
      const next = collectDenseNodeSelections(
        fixture.runtime,
        fixture.layout,
        fixture.parts,
        interaction,
      );
      if (next === selected.denseNodeSelections) throw new Error("Dense node selection was cached");
      const occurrence = next.get(PART_ID)?.occurrences[0];
      if (selected.denseNodeSelections.get(PART_ID) !== undefined && occurrence === undefined) {
        throw new Error("Dense node selection construction lost its occurrence");
      }
      sample += 1;
    },
  };
}

function emphasisCollectionOperation(
  fixture: NodeSelectionFixture,
  selected: NodeCase,
): OperationSpec {
  return {
    name: `node-${selected.id}-collect-emphasis-updates`,
    workloadUnit: "selected node emphasis records collected on the CPU",
    workloadCount: selected.selectedNodeCount,
    workloadDetails: details(fixture, selected),
    run: () => {
      const updates = collectEmphasisUpdates(
        fixture.runtime,
        fixture.layout,
        fixture.slotByInstanceId,
        {
          parts: fixture.parts,
          interaction: selected.interaction,
          denseSelections: new Map(),
          denseNodeSelections: selected.denseNodeSelections,
        },
      );
      assertEmphasisCount(updates, selected);
    },
  };
}

function highlightUploadOperation(
  fixture: NodeSelectionFixture,
  selected: NodeCase,
): OperationSpec {
  installGpuGlobals();
  const gpu = fakeGpuDevice();
  const storages = Array.from({ length: SAMPLE_COUNT }, () => freshHighlightTarget(gpu.device));
  let sample = 0;
  return {
    name: `node-${selected.id}-encode-upload-highlights-cold`,
    workloadUnit:
      "sparse node emphasis records plus dense node membership encoded and uploaded to fresh highlight storage",
    workloadCount: selected.selectedNodeCount,
    workloadDetails: {
      ...details(fixture, selected),
      freshStoragePerSample: 1,
      sparseHighlightRecordBytes:
        (selected.emphasisUpdates.get(PART_ID)?.length ?? 0) * ELEMENT_RECORD_STRIDE,
      highlightHeaderBytes: HIGHLIGHT_HEADER,
      denseSelectionBytes: denseNodeBytes(fixture, selected),
      highlightStorageBytes: highlightStorageBytes(fixture, selected),
    },
    run: () => {
      const storage = storages[sample];
      if (storage === undefined) throw new Error("Highlight upload sample exhausted");
      writeElementHighlights(gpu.device, storage, selected.emphasisUpdates.get(PART_ID) ?? [], {
        nodeSelection: selected.denseNodeSelections.get(PART_ID),
        selectedTheme: readInteractionState(selected.interaction).theme.selected,
        slotCapacity: fixture.layout.partSlots.get(PART_ID)?.length ?? 0,
      });
      sample += 1;
    },
  };
}

function nodeOrderOperation(fixture: NodeSelectionFixture, selected: NodeCase): OperationSpec {
  const selectedNodeFlags = selectedFlags(fixture, selected.interaction);
  const expectedOccurrences = selectedNodeFlags.filter(Boolean).length;
  return {
    name: `node-${selected.id}-build-selected-node-order`,
    workloadUnit: "selected occurrence entries in the node-selection order",
    workloadCount: expectedOccurrences,
    workloadDetails: details(fixture, selected),
    run: () => {
      const order = buildNodeSelectionOrder(
        fixture.layout,
        fixture.runtime,
        PART_ID,
        selectedNodeFlags,
        fixture.parts,
      );
      if (order.length !== expectedOccurrences) throw new Error("Selected node order changed");
    },
  };
}

function nodeSyncOperation(fixture: NodeSelectionFixture, selected: NodeCase): OperationSpec {
  installGpuGlobals();
  const expectedFlags = selectedFlags(fixture, selected.interaction);
  const expectedOrder = buildNodeSelectionOrder(
    fixture.layout,
    fixture.runtime,
    PART_ID,
    expectedFlags,
    fixture.parts,
  );
  const samples = Array.from({ length: SAMPLE_COUNT }, () => {
    const gpu = fakeGpuDevice();
    return {
      gpu,
      draw: createDrawResources(gpu.device),
      selection: {
        selectedNodeFlags: new Array<boolean>(fixture.runtime.instanceCount).fill(false),
        nodeFlags: new Array<boolean>(fixture.runtime.instanceCount).fill(false),
      },
    };
  });
  let sample = 0;
  return {
    name: `node-${selected.id}-sync-node-visibility-selected-order-cold`,
    workloadUnit:
      "isolated node visibility and selected-node orders synced to fresh fake GPU buffers",
    workloadCount: fixture.runtime.instanceCount,
    workloadDetails: { ...details(fixture, selected), freshDrawResourcesPerSample: 1 },
    run: () => {
      const current = samples[sample];
      if (current === undefined) throw new Error("Node order sample exhausted");
      syncSelectionState({
        runtime: fixture.runtime,
        layout: fixture.layout,
        interaction: selected.interaction,
        parts: fixture.parts,
        selection: current.selection,
        bundle: { device: current.gpu.device, draw: current.draw } as unknown as GpuBundle,
        selectionParts: new Set(),
        nodeParts: new Set([PART_ID]),
        changedInstanceIds: undefined,
        denseSelections: new Map(),
        denseNodeSelections: selected.denseNodeSelections,
      });
      assertNodeSync(
        current.selection.selectedNodeFlags,
        current.draw,
        expectedFlags,
        expectedOrder,
      );
      sample += 1;
    },
  };
}

function freshHighlightTarget(device: GPUDevice): InstanceStorage {
  const emptyHighlight = createHighlightStorage(device, 1);
  return {
    highlight: emptyHighlight,
    emptyHighlight,
    highlightOwned: false,
    capacity: 1,
    bindGroup: undefined,
    nodeBindGroup: undefined,
    edgeBindGroup: undefined,
    transparentBindGroup: undefined,
    selectionBindGroup: undefined,
    subsetSelectionBindGroup: undefined,
    nodeSelectionBindGroup: undefined,
  } as unknown as InstanceStorage;
}

function assertEmphasisCount(updates: EmphasisUpdates, selected: NodeCase): void {
  const records = updates.get(PART_ID) ?? [];
  const denseCount =
    selected.denseNodeSelections
      .get(PART_ID)
      ?.occurrences.reduce((count, occurrence) => count + occurrence.selectedCount, 0) ?? 0;
  const expected = selected.selectedNodeCount - denseCount;
  if (records.length !== expected)
    throw new Error(`Node emphasis count changed: ${records.length}`);
}

function requireCase(fixture: NodeSelectionFixture, id: NodeCaseId): NodeCase {
  const selected = fixture.cases.get(id);
  if (selected === undefined) throw new Error(`Missing ${id} node selection case`);
  return selected;
}
