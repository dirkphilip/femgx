import { describe, expectTypeOf, it } from "vitest";
import {
  InteractionGranularity,
  createInteractionState,
  interactionTargetFromHit,
  setPartOccurrenceOverrides,
  setPartOverrides,
  type EdgePickHit,
  type InteractionTargetFor,
  type PickHit,
  type SceneReconciliationOutcome,
  type Viewport,
  type ViewportElementVectorConfig,
  type ViewportResultsConfig,
  type AssemblyOccurrenceId,
  type PartOccurrenceId,
} from "../../src/entries/root";

async function assertPickingContracts(viewport: Viewport, hit: PickHit): Promise<void> {
  const edgeHit = await viewport.interaction.pick(10, 20, "edge");
  expectTypeOf(edgeHit).toEqualTypeOf<EdgePickHit | undefined>();

  const nodeTargets = await viewport.interaction.pickRegion(
    { left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 },
    InteractionGranularity.Node,
  );
  expectTypeOf(nodeTargets).toEqualTypeOf<readonly InteractionTargetFor<"node">[]>();

  const faceTarget = interactionTargetFromHit(hit, InteractionGranularity.Face);
  expectTypeOf(faceTarget).toEqualTypeOf<InteractionTargetFor<"face"> | undefined>();
}

function assertPartOccurrenceOverrideContracts(): void {
  const state = createInteractionState();
  setPartOverrides(state, [[1, { emissive: 0.2 }]]);
  setPartOccurrenceOverrides(state, [["1/0", { emissive: 0.2 }]]);
  // @ts-expect-error Part-occurrence override keys use stable string identities.
  setPartOccurrenceOverrides(state, [[1, { emissive: 0.2 }]]);
}

function assertOccurrenceIdentityContracts(
  partOccurrenceId: PartOccurrenceId,
  assemblyOccurrenceId: AssemblyOccurrenceId,
): void {
  // @ts-expect-error Assembly-occurrence identities cannot address part occurrences.
  const wrongPartIdentity: PartOccurrenceId = assemblyOccurrenceId;
  // @ts-expect-error Part-occurrence identities cannot address assembly occurrences.
  const wrongAssemblyIdentity: AssemblyOccurrenceId = partOccurrenceId;
  void [wrongPartIdentity, wrongAssemblyIdentity];
}

function assertResultAndReconciliationContracts(outcome: SceneReconciliationOutcome): void {
  // @ts-expect-error Result snapshots require at least one authored role.
  const emptyResults: ViewportResultsConfig = {};
  // @ts-expect-error Cleared results always provide an actionable reason.
  const missingReason: SceneReconciliationOutcome = { results: "cleared" };
  // @ts-expect-error Preserved results cannot carry a clearing reason.
  const impossibleReason: SceneReconciliationOutcome = { results: "preserved", reason: "invalid" };
  // @ts-expect-error Axis glyphs retain direction and cannot represent an unoriented normal.
  const impossibleAxis: ViewportElementVectorConfig = {
    field: null as never,
    glyph: "axis",
    transform: "normal",
  };
  void [emptyResults, missingReason, impossibleReason, impossibleAxis];

  if (outcome.results === "cleared") {
    expectTypeOf(outcome.reason).toEqualTypeOf<string>();
  } else {
    // @ts-expect-error Non-cleared outcomes do not expose a clearing reason.
    void outcome.reason;
  }
}

describe("public compiler contracts", () => {
  it("keeps invalid states and mismatched picking results unrepresentable", () => {
    expectTypeOf<PartOccurrenceId>().toExtend<string>();
    expectTypeOf<AssemblyOccurrenceId>().toExtend<string>();
    expectTypeOf(assertPickingContracts).toBeFunction();
    expectTypeOf(assertResultAndReconciliationContracts).toBeFunction();
    expectTypeOf(assertPartOccurrenceOverrideContracts).toBeFunction();
    expectTypeOf(assertOccurrenceIdentityContracts).toBeFunction();
  });
});
