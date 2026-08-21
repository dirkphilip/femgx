import { describe, expect, it } from "vitest";
import {
  createSceneBuilder,
  identityMatrix,
  type PartOccurrenceId,
  type Viewport,
} from "@/entries/root";
import {
  createInteractionState,
  isBodyVisible,
  isTargetHighlighted,
  isTargetSelected,
} from "@/entries/interaction";
import { createSceneOccurrenceSnapshot, type SceneOccurrences } from "@/scene-runtime/occurrences";
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
    expect(instanceRows.length).toBeLessThanOrEqual(1_000);
    expect(instanceRows.length).toBeGreaterThan(0);
    expect(instanceRows.every((row) => row.disabled)).toBe(true);
  });

  it("measures sync work across assembly, instance, and body rows", () => {
    const { model, runtime } = createFixture();
    const tracked = trackRuntime(runtime);
    const panel = createPanel(model, tracked.runtime);
    panel.rebuild();
    for (let warmup = 0; warmup < 2; warmup += 1) panel.sync();
    tracked.calls.partOccurrences = 0;
    tracked.calls.getPartOccurrence = 0;

    const samples = [0, 1, 2].map(() => {
      const start = performance.now();
      panel.sync();
      return performance.now() - start;
    });
    const median = [...samples].sort((left, right) => left - right)[1] ?? 0;
    const rowCount = panel.snapshot().rowCount;
    expect(panel.snapshot().rows).toHaveLength(1_000);
    expect(panel.snapshot().materializedRowCount).toBe(1_000);
    expect(tracked.calls.partOccurrences).toBe(0);
    expect(tracked.calls.getPartOccurrence).toBeLessThanOrEqual(samples.length);
    console.log(
      `visibility panel ${CHILD_COUNT} assemblies × ${INSTANCES_PER_CHILD} instances: ${median.toFixed(2)} ms median, ${rowCount} rows`,
    );
  }, 30_000);
});

function createFixture(): { readonly model: WorkbenchModel; readonly runtime: SceneOccurrences } {
  const preset = createBoltedPlatePreset();
  const part = preset.scene.parts.get(1);
  if (part === undefined) throw new Error("Bolted fixture plate is missing");
  let builder = createSceneBuilder().addPart(part);
  const childPlacements = Array.from({ length: CHILD_COUNT }, (_, childIndex) => {
    const childId = childIndex + 1;
    builder = builder.addAssembly({
      id: childId,
      name: `Child ${childId}`,
      placements: Array.from({ length: INSTANCES_PER_CHILD }, (_, instanceIndex) => ({
        kind: "part" as const,
        partId: part.id,
        transform: identityMatrix(),
        placementId: `p${childId}-${instanceIndex}`,
      })),
    });
    return {
      kind: "assembly" as const,
      placementId: `child-${childId}`,
      assemblyId: childId,
      transform: identityMatrix(),
    };
  });
  const scene = builder
    .addAssembly({ id: ROOT_ID, name: "Benchmark root", placements: childPlacements })
    .setRootAssembly(ROOT_ID)
    .build();
  return {
    model: createExampleModel({ ...preset, scene }),
    runtime: createSceneOccurrenceSnapshot(scene),
  };
}

function trackRuntime(runtime: SceneOccurrences): {
  readonly runtime: SceneOccurrences;
  readonly calls: { partOccurrences: number; getPartOccurrence: number };
} {
  const calls = { partOccurrences: 0, getPartOccurrence: 0 };
  const tracked: SceneOccurrences = {
    get rootAssemblyId() {
      return runtime.rootAssemblyId;
    },
    get assemblyOccurrenceCount() {
      return runtime.assemblyOccurrenceCount;
    },
    get partOccurrenceCount() {
      return runtime.partOccurrenceCount;
    },
    get visibleCount() {
      return runtime.visibleCount;
    },
    getPartOccurrenceId: (ordinal) => runtime.getPartOccurrenceId(ordinal),
    getAssemblyOccurrenceId: (ordinal) => runtime.getAssemblyOccurrenceId(ordinal),
    *partOccurrences() {
      calls.partOccurrences += 1;
      yield* runtime.partOccurrences();
    },
    assemblyOccurrences: () => runtime.assemblyOccurrences(),
    getPartOccurrence: (partOccurrenceId: PartOccurrenceId) => {
      calls.getPartOccurrence += 1;
      return runtime.getPartOccurrence(partOccurrenceId);
    },
    getAssemblyOccurrence: (occurrenceId) => runtime.getAssemblyOccurrence(occurrenceId),
    getPartId: (partOccurrenceId) => runtime.getPartId(partOccurrenceId),
    getTransform: (partOccurrenceId) => runtime.getTransform(partOccurrenceId),
    isPartOccurrenceVisible: (partOccurrenceId) =>
      runtime.isPartOccurrenceVisible(partOccurrenceId),
    visiblePartOccurrenceIds: () => runtime.visiblePartOccurrenceIds(),
  };
  return { runtime: tracked, calls };
}

function createPanel(
  model: WorkbenchModel,
  runtime: SceneOccurrences,
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
    targetSelected: (target) => isTargetSelected(interaction, target),
    onChanged: () => {},
  });
}
