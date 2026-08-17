import { describe, expect, it } from "vitest";
import { createResultField } from "../../src/results/fields";
import { createScalarColorMap } from "../../src/results/mapping";
import { identity } from "../../src/math/mat4";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { buildInstanceLayout } from "../../src/renderer/runtime-state";
import {
  interactionAffectedSlots,
  interactionDirtyParts,
} from "../../src/renderer/interaction-sync";
import { resolveViewportResults, viewportResultColors } from "../../src/viewport/results";
import { changedInstanceSlots } from "../../src/viewport/interaction-diff";
import { createInteractionState } from "../../src/interaction/interaction";
import { setBodyOverride } from "../../src/interaction/bodies";
import { setElementVisible } from "../../src/interaction/elements";
import { setTargetHovered, setTargetsSelected } from "../../src/interaction/targets";
import { readInteractionState } from "../../src/interaction/state";
import { benchmarkCaseSpecs, createBenchmarkCase } from "../../demo/benchmark/model";
import { makeScene } from "./fixtures";
import {
  emphasisInstanceId,
  emphasisPart,
  emphasisRuntime,
  emphasisScene,
} from "./budget/interaction-fixtures";
import {
  buildOperationsReport,
  emitOperationsReport,
  type OperationSpec,
} from "./operation-report";

const TET4_ELEMENT_COUNT = 131_712;
const BODY_ELEMENT_COUNT = 16_384;
const BODY_COUNT = 256;
const ELEMENTAL_RESULT_PLACEMENT_COUNTS = [1, 8, 64] as const;

const tet4Case = buildTet4Case();
const tet4Runtime = createPackedSceneRuntime(tet4Case.scene);
const tet4Layout = buildInstanceLayout(tet4Runtime);
const tet4InstanceId = firstInstanceId(tet4Runtime);
const tet4Part = [...tet4Case.scene.parts.values()][0];
if (tet4Part === undefined) throw new Error("Tet4 operation fixture has no part");
const tet4Targets = (tet4Part.elements ?? []).map((element) => ({
  kind: "element" as const,
  instanceId: tet4InstanceId,
  elementId: element.id,
}));
const halfTet4Targets = tet4Targets.slice(0, TET4_ELEMENT_COUNT / 2);
const tet4HoverTargets = [tet4Targets[0], tet4Targets.at(-1)];
if (tet4Targets.length !== TET4_ELEMENT_COUNT || tet4HoverTargets.includes(undefined)) {
  throw new Error("Tet4 operation fixture has unexpected authored element coverage");
}

const bodyFixture = {
  part: emphasisPart,
  scene: emphasisScene,
  runtime: emphasisRuntime,
  instanceId: requireInstanceId(emphasisInstanceId),
};
const bodyIds = (bodyFixture.part.bodies ?? []).map((body) => body.id);
if (bodyIds.length !== BODY_COUNT) throw new Error("Body operation fixture has unexpected bodies");

const elementalResultFixtures = ELEMENTAL_RESULT_PLACEMENT_COUNTS.map(buildElementalResultFixture);
const activeElementalResultFixture = requireElementalResultFixture(elementalResultFixtures[0]);
const largeScene = makeScene({ subcaseCount: 100, placementsPerSubcase: 2_000, partCount: 200 });

describe("local CPU operation baseline", () => {
  it("emits one structured operation report", () => {
    const report = buildOperationsReport(operationSpecs());
    expect(report.schemaVersion).toBe(2);
    expect(report.operations).toHaveLength(11);
    expect(typeof report.gitDirty).toBe("boolean");
    expect(
      report.operations.filter((operation) =>
        operation.name.startsWith("elemental-result-snapshot-build-"),
      ),
    ).toHaveLength(3);
    expect(
      report.operations.filter((operation) =>
        operation.name.startsWith("elemental-result-cpu-hover-identity-transition"),
      ),
    ).toHaveLength(1);
    for (const operation of report.operations) {
      expect(operation.timingsMs.p50).toBeGreaterThanOrEqual(0);
      expect(operation.timingsMs.p95).toBeGreaterThanOrEqual(operation.timingsMs.p50);
      expect(operation.workload.count).toBeGreaterThan(0);
    }
    emitOperationsReport(report);
  });
});

function operationSpecs(): readonly OperationSpec[] {
  return [
    {
      name: "selection-half-and-clear",
      workloadUnit: "selected authored elements",
      workloadCount: halfTet4Targets.length,
      run: () => {
        selectAndClear(halfTet4Targets);
      },
    },
    {
      name: "selection-all-and-clear",
      workloadUnit: "selected authored elements",
      workloadCount: tet4Targets.length,
      run: () => {
        selectAndClear(tet4Targets);
      },
    },
    {
      name: "hover-diff-over-dense-selection",
      workloadUnit: "unchanged selected authored elements",
      workloadCount: tet4Targets.length,
      run: hoverDiffOverDenseSelection(),
    },
    {
      name: "sparse-element-visibility-and-restore",
      workloadUnit: "hidden then restored element occurrences",
      workloadCount: sparseVisibilityIds.length,
      run: sparseElementVisibility(),
    },
    {
      name: "body-recolor-256-and-clear",
      workloadUnit: "body overrides applied then cleared",
      workloadCount: bodyIds.length,
      run: recolorBodies(),
    },
    ...elementalResultFixtures.map((fixture) => ({
      name: `elemental-result-snapshot-build-${fixture.runtime.instanceCount}-placements`,
      workloadUnit: "unique authored elements in one scalar table",
      workloadCount: BODY_ELEMENT_COUNT,
      run: buildElementalResultSnapshot(fixture),
    })),
    {
      name: "elemental-result-cpu-hover-identity-transition",
      workloadUnit: "one active-result CPU hover/identity transition",
      workloadCount: 1,
      run: updateElementalResultInteraction(activeElementalResultFixture),
    },
    {
      name: "scene-runtime-rebuild",
      workloadUnit: "placed instances",
      workloadCount: largeScenePlacementCount,
      run: rebuildLargeRuntime,
    },
    {
      name: "scene-runtime-visibility-toggle",
      workloadUnit: "placed instances in one part subtree",
      workloadCount: largeScenePlacementCount / 200,
      run: toggleLargeRuntimeVisibility,
    },
  ];
}

const sparseVisibilityIds = [1, 257, 513, 769, 1_025, 1_281, 1_537, 1_793] as const;
const largeScenePlacementCount = 200_000;
const largeRuntime = createPackedSceneRuntime(largeScene);

function selectAndClear(targets: readonly (typeof tet4Targets)[number][]): void {
  const selected = setTargetsSelected(createInteractionState(), targets, true);
  const cleared = setTargetsSelected(selected, targets, false);
  if (readInteractionState(cleared).selectedElementIds.size !== 0) {
    throw new Error("Selection operation did not restore the empty state");
  }
}

function hoverDiffOverDenseSelection(): () => void {
  const dense = setTargetsSelected(createInteractionState(), tet4Targets, true);
  const first = tet4HoverTargets[0];
  const last = tet4HoverTargets[1];
  if (first === undefined || last === undefined) throw new Error("Hover targets are missing");
  const previous = setTargetHovered(dense, first);
  const next = setTargetHovered(dense, last);
  return () => {
    const changedSlots = changedInstanceSlots(tet4Runtime, previous, next);
    const affectedSlots = interactionAffectedSlots(
      tet4Runtime,
      previous,
      next,
      changedSlots,
      false,
    );
    const dirtyParts = interactionDirtyParts(tet4Runtime, tet4Layout, previous, next, false);
    if (affectedSlots.length !== 1 || dirtyParts.selectionParts.size !== 0) {
      throw new Error("Hover diff changed the dense selection scope");
    }
    interactionAffectedSlots(tet4Runtime, next, previous, changedSlots, false);
    const restored = setTargetHovered(next, undefined);
    if (readInteractionState(restored).selectedElementIds.size !== 1) {
      throw new Error("Hover diff changed the dense selection identity");
    }
  };
}

function sparseElementVisibility(): () => void {
  return () => {
    let state = createInteractionState();
    for (const elementId of sparseVisibilityIds) {
      state = setElementVisible(state, { instanceId: bodyFixture.instanceId, elementId }, false);
    }
    for (const elementId of sparseVisibilityIds) {
      state = setElementVisible(state, { instanceId: bodyFixture.instanceId, elementId }, true);
    }
    if (readInteractionState(state).hiddenElementIds.size !== 0) {
      throw new Error("Visibility operation did not restore the empty state");
    }
  };
}

function recolorBodies(): () => void {
  return () => {
    let state = createInteractionState();
    for (const bodyId of bodyIds) {
      state = setBodyOverride(
        state,
        { instanceId: bodyFixture.instanceId, bodyId },
        { color: { r: (bodyId % 3) / 2, g: (bodyId % 5) / 4, b: (bodyId % 7) / 6, a: 1 } },
      );
    }
    for (const bodyId of bodyIds) {
      state = setBodyOverride(state, { instanceId: bodyFixture.instanceId, bodyId }, undefined);
    }
    if (readInteractionState(state).bodyOverrides.size !== 0) {
      throw new Error("Body recolor operation did not restore the empty state");
    }
  };
}

function updateElementalResultInteraction(fixture: ElementalResultFixture): () => void {
  const instanceId = requireInstanceId(fixture.runtime.getInstanceId(0));
  const colors = viewportResultColors(fixture.state);
  return () => {
    const interaction = setTargetHovered(createInteractionState(), {
      kind: "element",
      instanceId,
      elementId: 1,
    });
    if (
      readInteractionState(interaction).elementOverrides.size !== 0 ||
      viewportResultColors(fixture.state) !== colors
    ) {
      throw new Error("Elemental result interaction changed renderer-owned colors");
    }
  };
}

function buildElementalResultSnapshot(fixture: ElementalResultFixture): () => void {
  return () => {
    const state = resolveViewportResults(fixture.state.config, fixture.scene, fixture.runtime);
    if (viewportResultColors(state)?.get(bodyFixture.part.id)?.location !== "elemental") {
      throw new Error("Elemental result snapshot did not build its dense part table");
    }
  };
}

function requireInstanceId(instanceId: string | undefined): string {
  if (instanceId === undefined) throw new Error("Operation fixture has no instance");
  return instanceId;
}

function requireElementalResultFixture(
  fixture: ElementalResultFixture | undefined,
): ElementalResultFixture {
  if (fixture === undefined)
    throw new Error("Active elemental result operation fixture is missing");
  return fixture;
}

function rebuildLargeRuntime(): void {
  const runtime = createPackedSceneRuntime(largeScene);
  if (runtime.instanceCount !== largeScenePlacementCount) {
    throw new Error("Large runtime rebuild lost placements");
  }
}

function toggleLargeRuntimeVisibility(): void {
  largeRuntime.setPartVisible(1, false);
  largeRuntime.setPartVisible(1, true);
  if (largeRuntime.visibleCount !== largeScenePlacementCount) {
    throw new Error("Large runtime visibility toggle did not restore visibility");
  }
}

function buildTet4Case() {
  const spec = benchmarkCaseSpecs(false).find((candidate) => candidate.id === "fe-tet4-solid-132k");
  if (spec === undefined) throw new Error("Tet4 benchmark specification is missing");
  return createBenchmarkCase(spec);
}

function firstInstanceId(runtime: ReturnType<typeof createPackedSceneRuntime>): string {
  const slot = runtime.getDrawList()[0];
  const instanceId = slot === undefined ? undefined : runtime.getInstanceId(slot);
  if (instanceId === undefined) throw new Error("Operation fixture has no instance");
  return instanceId;
}

interface ElementalResultFixture {
  readonly scene: typeof bodyFixture.scene;
  readonly runtime: ReturnType<typeof createPackedSceneRuntime>;
  readonly state: ReturnType<typeof resolveViewportResults>;
}

function buildElementalResultFixture(placementCount: number): ElementalResultFixture {
  const scene = {
    ...bodyFixture.scene,
    assemblies: new Map([
      [
        1,
        {
          id: 1,
          placements: Array.from({ length: placementCount }, () => ({
            kind: "part" as const,
            partId: bodyFixture.part.id,
            transform: identity(),
          })),
        },
      ],
    ]),
  };
  const runtime = createPackedSceneRuntime(scene);
  const values = Float32Array.from({ length: BODY_ELEMENT_COUNT + 1 }, (_, index) => index % 101);
  const field = createResultField({
    id: "benchmark-elemental-scalar",
    name: "Benchmark elemental scalar",
    location: "elemental",
    shape: "scalar",
    count: BODY_ELEMENT_COUNT + 1,
    unit: "unitless",
    values,
  });
  const colorMap = createScalarColorMap({ min: 0, max: 100 });
  const state = resolveViewportResults({ scalar: { field, colorMap } }, scene, runtime);
  return { scene, runtime, state };
}
