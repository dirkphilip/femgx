import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  isBodyVisible,
  isTargetHighlighted,
  isTargetSelected,
} from "@/entries/interaction";
import { createSceneOccurrenceSnapshot, type SceneOccurrences } from "@/scene-runtime/occurrences";
import { createBoltedPlatePreset } from "../../../demo/fixtures/presets";
import { createResultsPreset } from "../../../demo/fixtures/results-preset";
import { createExampleModel, type WorkbenchModel } from "../../../demo/workbench/models/model";
import { VisibilityPanelController } from "../../../demo/workbench/state/visibility-panel";

describe("VisibilityPanelController", () => {
  it("marks rows with their ordinary interaction selection state", () => {
    const model = createExampleModel(createBoltedPlatePreset());
    const runtime = createSceneOccurrenceSnapshot(model.scene);
    const panel = new VisibilityPanelController({
      getModel: () => model,
      getRuntime: () => runtime,
      partName: (partId) => model.partNames.get(partId),
      partVisible: () => true,
      bodyVisible: () => true,
      bodyHighlighted: () => false,
      targetSelected: (target) =>
        target.kind === "assemblyOccurrence" && target.assemblyOccurrenceId === "1",
      onChanged: () => undefined,
    });

    panel.rebuild();

    expect(panel.snapshot().rows[0]?.selected).toBe(true);
    expect(panel.snapshot().rows.some((row) => row.kind === "partOccurrence" && row.selected)).toBe(
      false,
    );
  });

  it("preserves expanded rows across rebuilds but resets for a new model", () => {
    let model = createExampleModel(createBoltedPlatePreset());
    let runtime = createSceneOccurrenceSnapshot(model.scene);
    const panel = createPanel(
      () => model,
      () => runtime,
    );

    panel.rebuild();
    const assembly = panel
      .snapshot()
      .rows.find((row) => row.kind === "assembly" && row.expandable && row.expanded);
    if (assembly?.target.kind !== "assemblyOccurrence")
      throw new Error("Expected an expanded assembly");
    panel.toggleExpanded(assembly.target.assemblyOccurrenceId);
    expect(rowFor(panel, assembly.target.assemblyOccurrenceId)?.expanded).toBe(false);

    panel.rebuild();
    expect(rowFor(panel, assembly.target.assemblyOccurrenceId)?.expanded).toBe(false);

    model = createExampleModel(createResultsPreset());
    runtime = createSceneOccurrenceSnapshot(model.scene);
    panel.rebuild();
    const replacementRoot = panel.snapshot().rows[0];
    expect(replacementRoot?.kind).toBe("assembly");
    expect(replacementRoot?.expanded).toBe(true);
    expect(rowFor(panel, assembly.target.assemblyOccurrenceId)).toBeUndefined();
  });

  it("pages every logical row while materializing only the active 1,000-row window", () => {
    const runtime = flatHierarchy(100_001);
    const panel = new VisibilityPanelController({
      getModel: () => flatHierarchyModel(),
      getRuntime: () => runtime,
      partName: () => undefined,
      partVisible: () => true,
      bodyVisible: () => true,
      bodyHighlighted: () => false,
      targetSelected: () => false,
      onChanged: () => undefined,
    });

    panel.rebuild();

    expect(panel.snapshot().rowCount).toBe(100_001);
    expect(panel.snapshot().pageCount).toBe(101);
    expect(panel.snapshot().rows).toHaveLength(1_000);
    expect(panel.snapshot().materializedRowCount).toBe(1_000);

    panel.setPage(100);

    expect(panel.snapshot().page).toBe(100);
    expect(panel.snapshot().rows).toHaveLength(1);
    expect(panel.snapshot().rows[0]?.key).toBe("assembly:100000");
    expect(panel.snapshot().materializedRowCount).toBe(1);
  }, 30_000);
});

function rowFor(panel: VisibilityPanelController, occurrenceId: string) {
  return panel
    .snapshot()
    .rows.find(
      (row) =>
        row.target.kind === "assemblyOccurrence" &&
        row.target.assemblyOccurrenceId === occurrenceId,
    );
}

function createPanel(
  getModel: () => WorkbenchModel,
  getRuntime: () => SceneOccurrences,
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
    targetSelected: (target) => isTargetSelected(interaction, target),
    onChanged: () => undefined,
  });
}

function flatHierarchy(count: number): SceneOccurrences {
  return {
    rootAssemblyId: 1,
    assemblyOccurrenceCount: count,
    partOccurrenceCount: 0,
    visibleCount: 0,
    getPartOccurrenceId: () => undefined,
    getAssemblyOccurrenceId: (ordinal) =>
      ordinal >= 0 && ordinal < count ? String(ordinal) : undefined,
    partOccurrences: () => [],
    assemblyOccurrences: () => [],
    getPartOccurrence: () => undefined,
    getAssemblyOccurrence: (id) => {
      const ordinal = Number(id);
      if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= count) return undefined;
      return {
        assemblyOccurrenceId: id,
        placementId: ordinal === 0 ? undefined : id,
        assemblyId: 1,
        parentAssemblyOccurrenceId: ordinal === 0 ? undefined : "0",
        childCount: ordinal === 0 ? count - 1 : 0,
        getChildId: (childOrdinal) =>
          ordinal === 0 && childOrdinal >= 0 && childOrdinal < count - 1
            ? String(childOrdinal + 1)
            : undefined,
        partOccurrenceCount: 0,
        getPartOccurrenceId: () => undefined,
        visible: true,
        effectiveVisible: true,
      };
    },
    getPartId: () => undefined,
    getTransform: () => undefined,
    isPartOccurrenceVisible: () => false,
    visiblePartOccurrenceIds: () => [],
  };
}

function flatHierarchyModel(): WorkbenchModel {
  return {
    scene: {
      rootAssemblyId: 1,
      assemblies: { get: () => ({ id: 1, name: "Flat hierarchy" }) },
      parts: { get: () => undefined },
    },
    partNames: new Map(),
  } as unknown as WorkbenchModel;
}
