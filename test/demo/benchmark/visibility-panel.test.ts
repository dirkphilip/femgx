import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  createScene,
  isBodyVisible,
  isTargetHighlighted,
  identity,
  type PartOccurrenceId,
  type Viewport,
} from "../../../src/entries/root";
import { createSceneRuntime, type SceneRuntime } from "../../../src/entries/runtime";
import { createBoltedPlatePreset } from "../../../demo/fixtures/presets";
import { createExampleModel, type WorkbenchModel } from "../../../demo/workbench/models/model";
import { VisibilityPanelController } from "../../../demo/workbench/state/visibility-panel";
import { WorkbenchVisibilityActions } from "../../../demo/workbench/state/visibility-actions";

const ROOT_ID = 1000;
const CHILD_COUNT = 128;
const INSTANCES_PER_CHILD = 16;

describe("visibility panel benchmark", () => {
  it("caches a hidden part across repeated instance rows", () => {
    const { model, runtime } = createFixture();
    let partVisibleCalls = 0;
    const panel = createPanel(model, runtime, () => {
      partVisibleCalls += 1;
      return false;
    });

    panel.rebuild();

    const instanceRows = panel.snapshot().rows.filter((row) => row.kind === "partOccurrence");
    expect(partVisibleCalls).toBe(1);
    expect(instanceRows.length).toBe(CHILD_COUNT * INSTANCES_PER_CHILD);
    expect(instanceRows.every((row) => row.disabled)).toBe(true);
  });

  it("measures sync work across assembly, instance, and body rows", () => {
    const { model, runtime } = createFixture();
    const tracked = trackRuntime(runtime);
    const panel = createPanel(model, tracked.runtime);
    panel.rebuild();
    for (let warmup = 0; warmup < 2; warmup += 1) panel.sync();
    tracked.calls.getPartOccurrences = 0;
    tracked.calls.getPartOccurrence = 0;

    const samples = [0, 1, 2].map(() => {
      const start = performance.now();
      panel.sync();
      return performance.now() - start;
    });
    const median = [...samples].sort((left, right) => left - right)[1] ?? 0;
    const rowCount = panel.snapshot().rows.length;
    expect(rowCount).toBe(1 + CHILD_COUNT * (1 + INSTANCES_PER_CHILD * 3));
    expect(tracked.calls.getPartOccurrences).toBe(0);
    expect(tracked.calls.getPartOccurrence).toBeLessThanOrEqual(samples.length);
    console.log(
      `visibility panel ${CHILD_COUNT} assemblies × ${INSTANCES_PER_CHILD} instances: ${median.toFixed(2)} ms median, ${rowCount} rows`,
    );
  }, 30_000);
});

function createFixture(): { readonly model: WorkbenchModel; readonly runtime: SceneRuntime } {
  const preset = createBoltedPlatePreset();
  const part = preset.scene.parts.get(1);
  if (part === undefined) throw new Error("Bolted fixture plate is missing");
  let builder = createScene().addPart(part);
  const childPlacements = Array.from({ length: CHILD_COUNT }, (_, childIndex) => {
    const childId = childIndex + 1;
    builder = builder.addAssembly({
      id: childId,
      name: `Child ${childId}`,
      placements: Array.from({ length: INSTANCES_PER_CHILD }, (_, instanceIndex) => ({
        kind: "part" as const,
        partId: part.id,
        transform: identity(),
        placementId: `p${childId}-${instanceIndex}`,
      })),
    });
    return { kind: "assembly" as const, assemblyId: childId, transform: identity() };
  });
  const scene = builder
    .addAssembly({ id: ROOT_ID, name: "Benchmark root", placements: childPlacements })
    .withRoot(ROOT_ID)
    .build();
  return { model: createExampleModel({ ...preset, scene }), runtime: createSceneRuntime(scene) };
}

function trackRuntime(runtime: SceneRuntime): {
  readonly runtime: SceneRuntime;
  readonly calls: { getPartOccurrences: number; getPartOccurrence: number };
} {
  const calls = { getPartOccurrences: 0, getPartOccurrence: 0 };
  const tracked: SceneRuntime = {
    get rootAssemblyId() {
      return runtime.rootAssemblyId;
    },
    get occurrenceCount() {
      return runtime.occurrenceCount;
    },
    get partOccurrenceCount() {
      return runtime.partOccurrenceCount;
    },
    get visibleCount() {
      return runtime.visibleCount;
    },
    getPartOccurrenceIds: () => runtime.getPartOccurrenceIds(),
    getOccurrenceIds: () => runtime.getOccurrenceIds(),
    getPartOccurrences: () => {
      calls.getPartOccurrences += 1;
      return runtime.getPartOccurrences();
    },
    getOccurrences: () => runtime.getOccurrences(),
    getPartOccurrence: (partOccurrenceId: PartOccurrenceId) => {
      calls.getPartOccurrence += 1;
      return runtime.getPartOccurrence(partOccurrenceId);
    },
    getOccurrence: (occurrenceId) => runtime.getOccurrence(occurrenceId),
    getPartId: (partOccurrenceId) => runtime.getPartId(partOccurrenceId),
    getTransform: (partOccurrenceId) => runtime.getTransform(partOccurrenceId),
    isPartOccurrenceVisible: (partOccurrenceId) =>
      runtime.isPartOccurrenceVisible(partOccurrenceId),
    getVisiblePartOccurrenceIds: () => runtime.getVisiblePartOccurrenceIds(),
  };
  return { runtime: tracked, calls };
}

function createPanel(
  model: WorkbenchModel,
  runtime: SceneRuntime,
  partVisible?: (partId: number) => boolean,
): VisibilityPanelController {
  let interaction = createInteractionState();
  const actions = new WorkbenchVisibilityActions({
    viewport: () => ({}) as Viewport,
    scene: () => model.scene,
    runtime: () => runtime,
    interaction: () => interaction,
    setInteraction: (next) => {
      interaction = next;
    },
    applyInteraction: (next) => {
      interaction = next;
    },
    syncPanel: () => {},
    render: () => {},
  });
  return new VisibilityPanelController({
    getModel: () => model,
    getRuntime: () => runtime,
    partName: (partId) => model.partNames.get(partId),
    partVisible: partVisible ?? ((partId) => actions.partVisible(partId)),
    bodyVisible: (partOccurrenceId, bodyId) =>
      isBodyVisible(interaction, { partOccurrenceId, bodyId }),
    bodyHighlighted: (partOccurrenceId, bodyId) =>
      isTargetHighlighted(interaction, { kind: "body", partOccurrenceId, bodyId }),
    onChanged: () => {},
  });
}
