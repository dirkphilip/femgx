import { buildDenseTet4Payload } from "../../../demo/benchmark/tet4-transfer";
import { createPackedTet4Part } from "../../../demo/benchmark/packed-tet4";
import { partSemanticGraph } from "../../../src/geometry/semantic/part-semantic-graph";
import { setElementsVisible } from "../../../src/interaction/elements";
import { createInteractionState, setPartOverride } from "../../../src/interaction/interaction";
import { readInteractionState, type InteractionState } from "../../../src/interaction/state";
import { setTargetsSelected } from "../../../src/interaction/targets";
import type { InteractionTarget } from "../../../src/interaction/target-types";
import { identityMatrix } from "../../../src/math/mat4";
import { RendererAttachment } from "../../../src/renderer/attachment";
import { createGpuBundle, destroyGpuBundle, type GpuBundle } from "../../../src/renderer/recovery";
import { destroyVisibilitySkinCache } from "../../../src/renderer/visibility/skins";
import { createPackedSceneRuntime } from "../../../src/scene-runtime/runtime";
import { createSceneBuilder, type Scene } from "../../../src/scene/scene";
import { fakeGpuDevice } from "../../renderer/fake-gpu";
import type { OperationSpec } from "../operation-report";

const PART_ID = 1;
const CELLS = 28;
const ELEMENT_COUNT = 131_712;
const HALF_COUNT = ELEMENT_COUNT / 2;
const NODE_COUNT = 24_389;
const EDGE_COUNT = 160_804;
const FACE_COUNT = 526_848;
const DENSE_SELECTION_BYTES = 4 + Math.ceil(ELEMENT_COUNT / 32) * 4;
const VISIBILITY_SKIN_BYTES = 75_264;
const SELECTED_HIGHLIGHT_BYTES = 16_616;
const HIDDEN_HIGHLIGHT_BYTES = 33_080;

type Runtime = ReturnType<typeof createPackedSceneRuntime>;

export interface SelectionHideWorkflowFixture {
  readonly runtime: Runtime;
  readonly parts: Scene["parts"];
  readonly attachment: RendererAttachment;
  readonly bundle: GpuBundle;
  readonly targets: readonly InteractionTarget[];
  readonly base: InteractionState;
  readonly selected: InteractionState;
  readonly hidden: InteractionState;
}

/** Builds the exact large Tet4 selection-hide state with node and edge overlays enabled. */
export async function createSelectionHideWorkflowFixture(): Promise<SelectionHideWorkflowFixture> {
  const { payload } = buildDenseTet4Payload(CELLS);
  const part = createPackedTet4Part(PART_ID, payload);
  const graph = partSemanticGraph(part);
  if (graph === undefined) throw new Error("Tet4 workflow semantic graph is missing");
  assertTopology(graph);
  const scene = createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "selection-hide-workflow",
      placements: [
        { kind: "part", placementId: "tet4", partId: PART_ID, transform: identityMatrix() },
      ],
    })
    .setRootAssembly(1)
    .build();
  const runtime = createPackedSceneRuntime(scene);
  const partOccurrenceId = runtime.getInstanceId(0);
  if (partOccurrenceId === undefined) throw new Error("Tet4 workflow occurrence is missing");
  const targets = new Array<InteractionTarget>(HALF_COUNT);
  for (let ordinal = 0; ordinal < HALF_COUNT; ordinal += 1) {
    const elementId = graph.elementIds[ordinal];
    if (elementId === undefined) throw new Error(`Tet4 workflow element ${ordinal} is missing`);
    targets[ordinal] = { kind: "element", partOccurrenceId, elementId };
  }
  const base = setPartOverride(createInteractionState(), PART_ID, { edge: true, nodes: true });
  const selected = buildSelection(base, targets);
  const hidden = hideSelectedElements(selected);
  assertStateShape(selected, hidden, partOccurrenceId);
  const bundle = await createGpuBundle(fakeGpuDevice().device, "bgra8unorm", "depth24plus");
  const attachment = new RendererAttachment();
  attachment.prepareParts(scene.parts, bundle);
  attachment.attach(runtime, bundle);
  applyState({ runtime, parts: scene.parts, attachment, bundle }, base);
  return { runtime, parts: scene.parts, attachment, bundle, targets, base, selected, hidden };
}

/** Releases renderer-owned resources retained by the workflow fixture. */
export function destroySelectionHideWorkflowFixture(fixture: SelectionHideWorkflowFixture): void {
  destroyGpuBundle(fixture.bundle);
}

/** Returns independently timed state-build and renderer-sync workflow stages. */
export function selectionHideWorkflowOperations(
  fixture: SelectionHideWorkflowFixture,
): readonly OperationSpec[] {
  let selected = fixture.selected;
  let hidden = fixture.hidden;
  return [
    stateOperation("select", () => buildSelection(fixture.base, fixture.targets)),
    stateOperation("hide", () => hideSelectedElements(fixture.selected)),
    {
      ...operationBase("selection-sync"),
      beforeEach: () => {
        applyState(fixture, fixture.base);
        selected = buildSelection(fixture.base, fixture.targets);
      },
      run: () => {
        applyElements(fixture, selected);
        assertSelectedRendererShape(fixture);
      },
    },
    {
      ...operationBase("hide-sync"),
      beforeEach: () => {
        selected = buildSelection(fixture.base, fixture.targets);
        applyState(fixture, selected);
        hidden = hideSelectedElements(selected);
        destroyVisibilitySkinCache(fixture.bundle.draw, PART_ID);
      },
      run: () => {
        applyElements(fixture, hidden);
        assertHiddenRendererShape(fixture);
      },
    },
  ];
}

function stateOperation(phase: "select" | "hide", build: () => InteractionState): OperationSpec {
  return {
    ...operationBase(`${phase}-state-build`),
    run: () => {
      const state = build();
      const data = readInteractionState(state);
      const count = phase === "select" ? data.selectedElementIds : data.hiddenElementIds;
      if (nestedCount(count) !== HALF_COUNT) throw new Error(`${phase} state lost element ids`);
    },
  };
}

function operationBase(name: string) {
  return {
    name: `tet4-half-${name}-nodes-edges`,
    workloadUnit: "selected authored Tet4 element occurrences",
    workloadCount: HALF_COUNT,
    workloadDetails: {
      elementCount: ELEMENT_COUNT,
      selectedElementCount: HALF_COUNT,
      hiddenElementCount: name.startsWith("hide") ? HALF_COUNT : 0,
      nodeCount: NODE_COUNT,
      edgeCount: EDGE_COUNT,
      faceCount: FACE_COUNT,
      denseSelectionBytes: DENSE_SELECTION_BYTES,
      visibilitySkinBytes: name === "hide-sync" ? VISIBILITY_SKIN_BYTES : 0,
      selectedHighlightBytes: SELECTED_HIGHLIGHT_BYTES,
      hiddenHighlightBytes: HIDDEN_HIGHLIGHT_BYTES,
    },
  } satisfies Omit<OperationSpec, "run">;
}

function buildSelection(
  base: InteractionState,
  targets: readonly InteractionTarget[],
): InteractionState {
  return setTargetsSelected(base, targets, true);
}

function hideSelectedElements(selected: InteractionState): InteractionState {
  const data = readInteractionState(selected);
  return setElementsVisible(selected, elementRefs(data.selectedElementIds), false);
}

function* elementRefs(
  groups: ReadonlyMap<string, ReadonlySet<number>>,
): Generator<{ readonly partOccurrenceId: string; readonly elementId: number }> {
  for (const [partOccurrenceId, elementIds] of groups) {
    for (const elementId of elementIds) yield { partOccurrenceId, elementId };
  }
}

function applyState(
  fixture: Pick<SelectionHideWorkflowFixture, "runtime" | "parts" | "attachment" | "bundle">,
  interaction: InteractionState,
): void {
  fixture.attachment.updateInstances(fixture.runtime, interaction, [0], fixture.bundle);
  applyElements(fixture, interaction);
}

function applyElements(
  fixture: Pick<SelectionHideWorkflowFixture, "runtime" | "parts" | "attachment" | "bundle">,
  interaction: InteractionState,
): void {
  fixture.attachment.updateElements(
    fixture.runtime,
    interaction,
    fixture.bundle,
    fixture.parts,
    [0],
  );
}

function assertTopology(graph: NonNullable<ReturnType<typeof partSemanticGraph>>): void {
  if (
    graph.elementIds.length !== ELEMENT_COUNT ||
    graph.faceOwnerElementOrdinals.length !== FACE_COUNT ||
    graph.edgeNodeOffsets.length - 1 !== EDGE_COUNT
  ) {
    throw new Error("Tet4 workflow topology counts changed");
  }
}

function assertStateShape(
  selected: InteractionState,
  hidden: InteractionState,
  occurrenceId: string,
): void {
  const selectedData = readInteractionState(selected);
  const hiddenData = readInteractionState(hidden);
  if (
    selectedData.selectedElementIds.get(occurrenceId)?.size !== HALF_COUNT ||
    hiddenData.selectedElementIds !== selectedData.selectedElementIds ||
    hiddenData.hiddenElementIds.get(occurrenceId)?.size !== HALF_COUNT
  ) {
    throw new Error("Tet4 workflow selection-hide state shape changed");
  }
}

function assertSelectedRendererShape(fixture: SelectionHideWorkflowFixture): void {
  assertOverlayOrders(fixture);
  const storage = fixture.bundle.draw.storages.get(PART_ID);
  if (
    storage === undefined ||
    storage.highlight.buffer.size !== SELECTED_HIGHLIGHT_BYTES ||
    storage.highlight.selectionSlotCapacity !== 1 ||
    storage.highlight.selectionRecordCapacity !== 1 ||
    storage.highlight.selectionWordCapacity !== Math.ceil(ELEMENT_COUNT / 32)
  ) {
    throw new Error("Tet4 selection omitted overlay orders or dense highlight storage");
  }
}

function assertHiddenRendererShape(fixture: SelectionHideWorkflowFixture): void {
  assertOverlayOrders(fixture);
  const skin = fixture.bundle.draw.visibilitySkins.get(PART_ID);
  const storage = fixture.bundle.draw.storages.get(PART_ID);
  if (
    skin?.residentBytes !== VISIBILITY_SKIN_BYTES ||
    storage?.highlight.buffer.size !== HIDDEN_HIGHLIGHT_BYTES ||
    storage.highlight.visibilityRecordCapacity !== 1 ||
    storage.highlight.visibilityWordCapacity !== Math.ceil(ELEMENT_COUNT / 32)
  ) {
    throw new Error("Tet4 half-hide visibility skin payload changed");
  }
}

function assertOverlayOrders(fixture: SelectionHideWorkflowFixture): void {
  if (fixture.attachment.edgeCalls.length !== 1 || fixture.attachment.nodeCalls.length !== 1) {
    throw new Error("Tet4 workflow omitted edge or node overlay orders");
  }
}

function nestedCount(values: ReadonlyMap<unknown, ReadonlySet<unknown>>): number {
  let count = 0;
  for (const nested of values.values()) count += nested.size;
  return count;
}
