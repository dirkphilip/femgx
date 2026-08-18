import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  isBodyVisible,
  isTargetHighlighted,
} from "../../../src/entries/interaction";
import { createSceneRuntime, type SceneRuntime } from "../../../src/entries/runtime";
import { createBoltedPlatePreset } from "../../../demo/fixtures/presets";
import { createResultsPreset } from "../../../demo/fixtures/results-preset";
import { createExampleModel, type WorkbenchModel } from "../../../demo/workbench/models/model";
import { VisibilityPanelController } from "../../../demo/workbench/state/visibility-panel";

describe("VisibilityPanelController", () => {
  it("preserves expanded rows across rebuilds but resets for a new model", () => {
    let model = createExampleModel(createBoltedPlatePreset());
    let runtime = createSceneRuntime(model.scene);
    const panel = createPanel(
      () => model,
      () => runtime,
    );

    panel.rebuild();
    const assembly = panel
      .snapshot()
      .rows.find((row) => row.kind === "assembly" && row.expandable && row.expanded);
    if (assembly?.target.kind !== "assembly") throw new Error("Expected an expanded assembly");
    panel.toggleExpanded(assembly.target.occurrenceId);
    expect(rowFor(panel, assembly.target.occurrenceId)?.expanded).toBe(false);

    panel.rebuild();
    expect(rowFor(panel, assembly.target.occurrenceId)?.expanded).toBe(false);

    model = createExampleModel(createResultsPreset());
    runtime = createSceneRuntime(model.scene);
    panel.rebuild();
    const replacementRoot = panel.snapshot().rows[0];
    expect(replacementRoot?.kind).toBe("assembly");
    expect(replacementRoot?.expanded).toBe(true);
    expect(rowFor(panel, assembly.target.occurrenceId)).toBeUndefined();
  });
});

function rowFor(panel: VisibilityPanelController, occurrenceId: string) {
  return panel
    .snapshot()
    .rows.find((row) => row.target.kind === "assembly" && row.target.occurrenceId === occurrenceId);
}

function createPanel(
  getModel: () => WorkbenchModel,
  getRuntime: () => SceneRuntime,
): VisibilityPanelController {
  const interaction = createInteractionState();
  return new VisibilityPanelController({
    getModel,
    getRuntime,
    partName: (partId) => getModel().partNames.get(partId),
    partVisible: () => true,
    bodyVisible: (partOccurrenceId, bodyId) =>
      isBodyVisible(interaction, { partOccurrenceId, bodyId }),
    bodyHighlighted: (partOccurrenceId, bodyId) =>
      isTargetHighlighted(interaction, { kind: "body", partOccurrenceId, bodyId }),
    onChanged: () => undefined,
  });
}
