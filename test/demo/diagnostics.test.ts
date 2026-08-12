import { describe, expect, it } from "vitest";
import { createInteractionState, createSceneRuntime } from "../../src/index";
import { createBoltedPlatePreset } from "../../demo/fixture/presets";
import { createPerformancePreset } from "../../demo/fixture/performance-fixture";
import { statsText } from "../../demo/devtools/diagnostics";
import { createExampleModel } from "../../demo/workbench/model";

describe("demo diagnostics", () => {
  it("does not build per-part detail while the diagnostics HUD is closed", () => {
    const preset = createBoltedPlatePreset();
    const context = {
      model: createExampleModel(preset),
      runtime: createSceneRuntime(preset.scene),
      interaction: createInteractionState(),
    };
    const text = statsText(context, {
      rendererName: "webgpu",
      toggles: { edges: true, nodes: true, diagnostics: false },
      stats: { visibleInstances: 34, batches: 4 },
      selectedCount: 0,
    });

    expect(text).toContain("Visible instances 34");
    expect(text).not.toContain("Part ");
  });

  it("includes per-part visibility when the diagnostics HUD is open", () => {
    const preset = createBoltedPlatePreset();
    const context = {
      model: createExampleModel(preset),
      runtime: createSceneRuntime(preset.scene),
      interaction: createInteractionState(),
    };
    const text = statsText(context, {
      rendererName: "webgpu",
      toggles: { edges: true, nodes: true, diagnostics: true },
      stats: { visibleInstances: 34, batches: 4 },
      selectedCount: 0,
    });

    expect(text).toContain("Part ");
    expect(text).toContain("shown");
  });

  it("distinguishes reusable triangles from submitted instance triangles", () => {
    const preset = createPerformancePreset();
    const context = {
      model: createExampleModel(preset),
      runtime: createSceneRuntime(preset.scene),
      interaction: createInteractionState(),
    };
    const text = statsText(context, {
      rendererName: "webgpu",
      toggles: { edges: true, nodes: true, diagnostics: false },
      stats: { visibleInstances: 64, batches: 1 },
      selectedCount: 0,
    });

    expect(text).toContain("Unique triangles 32,768");
    expect(text).toContain("Submitted triangles 2,097,152");
  });
});
