import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStructuredFePart } from "../../../demo/benchmark/structured-fe";
import { partSemanticGraph } from "@/geometry/semantic/part-semantic-graph";
import { createInteractionState, setPartOverride } from "@/interaction/interaction";
import { hideSelectedElements } from "@/interaction/selection-queries";
import { readInteractionState } from "@/interaction/state";
import { setTargetsSelected } from "@/interaction/targets";
import type { InteractionTarget } from "@/interaction/target-types";
import { identityMatrix } from "@/math/mat4";
import { RendererAttachment } from "@/renderer/attachment";
import { createGpuBundle, destroyGpuBundle, type GpuBundle } from "@/renderer/recovery";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { createSceneBuilder, type Scene } from "@/scene/scene";
import { fakeGpuDevice, installGpuGlobals } from "../../renderer/fake-gpu";
import {
  buildOperationsReport,
  emitOperationsReport,
  type OperationSpec,
} from "../operation-report";

const PART_ID = 1;
const CELLS = 32;
const ELEMENT_COUNT = CELLS ** 3;
const HALF_COUNT = ELEMENT_COUNT / 2;
const NODE_COUNT = (CELLS + 1) ** 3;
const FACE_COUNT = ELEMENT_COUNT * 6;
const EDGE_COUNT = 104_544;
const SYNC_P95_BUDGET_MS = 750;
const STATE_P95_BUDGET_MS = 10;
const DENSE_ELEMENT_WORD_BYTES = Math.ceil(ELEMENT_COUNT / 32) * Uint32Array.BYTES_PER_ELEMENT;

interface Fixture {
  readonly scene: Scene;
  readonly runtime: ReturnType<typeof createPackedSceneRuntime>;
  readonly bundle: GpuBundle;
  readonly attachment: RendererAttachment;
  readonly targets: readonly InteractionTarget[];
  readonly base: ReturnType<typeof createInteractionState>;
  readonly selected: ReturnType<typeof createInteractionState>;
  readonly hidden: ReturnType<typeof createInteractionState>;
}

let restoreGpuGlobals: (() => void) | undefined;

beforeAll(() => {
  restoreGpuGlobals = installGpuGlobals();
});

afterAll(() => {
  restoreGpuGlobals?.();
});

describe("large Hex8 selection-hide workflow", () => {
  it("keeps half-element membership dense while edges and nodes are presented", async () => {
    const fixture = await createFixture();
    try {
      const report = buildOperationsReport(operations(fixture));
      expect(report.operations.map((operation) => operation.name)).toEqual([
        "hex8-half-select-state-build-nodes-edges",
        "hex8-half-hide-state-build-nodes-edges",
        "hex8-half-selection-sync-nodes-edges",
        "hex8-half-hide-sync-nodes-edges",
      ]);
      for (const operation of report.operations) {
        expect(operation.workload.count).toBe(HALF_COUNT);
        expect(operation.workload.details).toMatchObject({
          elementCount: ELEMENT_COUNT,
          nodeCount: NODE_COUNT,
          edgeCount: EDGE_COUNT,
          faceCount: FACE_COUNT,
        });
        expect(operation.timingsMs.p95).toBeGreaterThanOrEqual(operation.timingsMs.p50);
        if (process.env["FEMGX_PERFORMANCE_BUDGET"] === "1") {
          expect(operation.timingsMs.p95).toBeLessThan(
            operation.name.includes("sync") ? SYNC_P95_BUDGET_MS : STATE_P95_BUDGET_MS,
          );
        }
      }
      emitOperationsReport(report);
    } finally {
      destroyGpuBundle(fixture.bundle);
    }
  }, 120_000);
});

async function createFixture(): Promise<Fixture> {
  const part = createStructuredFePart(PART_ID, "hex8", CELLS);
  const graph = partSemanticGraph(part);
  if (
    graph === undefined ||
    graph.elementIds.length !== ELEMENT_COUNT ||
    graph.faceOwnerElementOrdinals.length !== FACE_COUNT ||
    graph.edgeNodeOffsets.length - 1 !== EDGE_COUNT ||
    part.nodePositions?.length !== NODE_COUNT * 3
  ) {
    throw new Error("Hex8 workflow topology counts changed");
  }
  const scene = createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "hex8-selection-hide-workflow",
      placements: [
        { kind: "part", placementId: "hex8", partId: PART_ID, transform: identityMatrix() },
      ],
    })
    .setRootAssembly(1)
    .build();
  const runtime = createPackedSceneRuntime(scene);
  const partOccurrenceId = runtime.getInstanceId(0);
  if (partOccurrenceId === undefined) throw new Error("Hex8 workflow occurrence is missing");
  const targets = Array.from(graph.elementIds.subarray(0, HALF_COUNT), (elementId) => ({
    kind: "element" as const,
    partOccurrenceId,
    elementId,
  }));
  const base = setPartOverride(createInteractionState(), PART_ID, { edge: true, nodes: true });
  const selected = setTargetsSelected(base, targets, true);
  const hidden = hideSelectedElements(selected);
  assertState(selected, hidden, partOccurrenceId);
  const bundle = await createGpuBundle(fakeGpuDevice().device, "bgra8unorm", "depth24plus");
  const attachment = new RendererAttachment();
  attachment.prepareParts(scene.parts, bundle);
  attachment.attach(runtime, bundle);
  apply({ scene, runtime, bundle, attachment }, base);
  return { scene, runtime, bundle, attachment, targets, base, selected, hidden };
}

function operations(fixture: Fixture): readonly OperationSpec[] {
  return [
    stateOperation("select", fixture.base, fixture.targets),
    stateOperation("hide", fixture.selected, fixture.targets),
    selectionSyncOperation(fixture),
    hideSyncOperation(fixture),
  ];
}

function stateOperation(
  id: "select" | "hide",
  previous: ReturnType<typeof createInteractionState>,
  targets: readonly InteractionTarget[],
): OperationSpec {
  return {
    ...operationBase(`${id}-state-build`),
    run: () => {
      const next =
        id === "select"
          ? setTargetsSelected(previous, targets, true)
          : hideSelectedElements(previous);
      const data = readInteractionState(next);
      expect(data.selectedElementIds.size).toBe(1);
      expect(nestedSize(data.selectedElementIds)).toBe(HALF_COUNT);
      if (id === "hide") expect(nestedSize(data.hiddenElementIds)).toBe(HALF_COUNT);
    },
  };
}

function selectionSyncOperation(fixture: Fixture): OperationSpec {
  return {
    ...operationBase("selection-sync"),
    beforeEach: () => {
      apply(fixture, fixture.base);
    },
    run: () => {
      apply(fixture, fixture.selected);
      assertOverlays(fixture);
      const selection = fixture.bundle.draw.storages.get(PART_ID)?.highlight.denseSelection;
      expect(selection?.elementCount).toBe(ELEMENT_COUNT);
      expect(selection?.occurrences).toHaveLength(1);
      expect(selection?.occurrences[0]?.selectedCount).toBe(HALF_COUNT);
      expect(selection?.occurrences[0]?.words.byteLength).toBe(DENSE_ELEMENT_WORD_BYTES);
    },
  };
}

function hideSyncOperation(fixture: Fixture): OperationSpec {
  return {
    ...operationBase("hide-sync"),
    beforeEach: () => {
      apply(fixture, fixture.selected);
    },
    run: () => {
      apply(fixture, fixture.hidden);
      assertOverlays(fixture);
      expect(fixture.attachment.usesExteriorFaceSubsets).toBe(false);
      expect(fixture.attachment.calls[0]?.visibilitySkin?.indexCount ?? 0).toBeGreaterThan(0);
      const visibility = fixture.bundle.draw.storages.get(PART_ID)?.highlight.denseVisibility;
      expect(visibility?.elementCount).toBe(ELEMENT_COUNT);
      expect(visibility?.occurrences[0]?.selectedCount).toBe(HALF_COUNT);
      expect(visibility?.occurrences[0]?.words.byteLength).toBe(DENSE_ELEMENT_WORD_BYTES);
    },
  };
}

function operationBase(id: string): Omit<OperationSpec, "run"> {
  return {
    name: `hex8-half-${id}-nodes-edges`,
    workloadUnit: "authored Hex8 element occurrences",
    workloadCount: HALF_COUNT,
    workloadDetails: {
      elementCount: ELEMENT_COUNT,
      selectedElementCount: HALF_COUNT,
      hiddenElementCount: id.startsWith("hide") ? HALF_COUNT : 0,
      nodeCount: NODE_COUNT,
      edgeCount: EDGE_COUNT,
      faceCount: FACE_COUNT,
    },
  };
}

function apply(
  fixture: Pick<Fixture, "scene" | "runtime" | "bundle" | "attachment">,
  interaction: ReturnType<typeof createInteractionState>,
): void {
  fixture.attachment.updateInstances(fixture.runtime, interaction, [0], fixture.bundle);
  fixture.attachment.updateElements(
    fixture.runtime,
    interaction,
    fixture.bundle,
    fixture.scene.parts,
  );
}

function assertState(
  selected: ReturnType<typeof createInteractionState>,
  hidden: ReturnType<typeof createInteractionState>,
  occurrenceId: string,
): void {
  const selectedData = readInteractionState(selected);
  const hiddenData = readInteractionState(hidden);
  if (
    selectedData.selectedElementIds.get(occurrenceId)?.size !== HALF_COUNT ||
    hiddenData.selectedElementIds !== selectedData.selectedElementIds ||
    hiddenData.hiddenElementIds.get(occurrenceId)?.size !== HALF_COUNT
  ) {
    throw new Error("Hex8 workflow lost selected or hidden half-element membership");
  }
}

function assertOverlays(fixture: Fixture): void {
  expect(fixture.attachment.edgeCalls).toHaveLength(1);
  expect(fixture.attachment.nodeCalls).toHaveLength(1);
}

function nestedSize(values: ReadonlyMap<string, ReadonlySet<number>>): number {
  let count = 0;
  for (const ids of values.values()) count += ids.size;
  return count;
}
