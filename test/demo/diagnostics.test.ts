import { describe, expect, it } from "vitest";
import { createInteractionState, createSceneRuntime } from "../../src/index";
import { createBoltedPlatePreset } from "../../demo/fixtures/presets";
import { createPerformancePreset } from "../../demo/fixtures/performance-fixture";
import { statsText } from "../../demo/devtools/diagnostics";
import { createExampleModel } from "../../demo/workbench/models/model";
import { IDLE_RENDER_LOOP_STATS } from "../../demo/workbench/viewport/render-loop";

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
      renderLoop: IDLE_RENDER_LOOP_STATS,
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
      renderLoop: IDLE_RENDER_LOOP_STATS,
      selectedCount: 0,
    });

    expect(text).toContain("Part ");
    expect(text).toContain("shown");
  });

  it("distinguishes reusable triangles from submitted instance triangles", () => {
    const preset = createPerformancePreset();
    const context = {
      model: { ...createExampleModel(preset), benchmarkElementFamily: "quad" as const },
      runtime: createSceneRuntime(preset.scene),
      interaction: createInteractionState(),
    };
    const text = statsText(context, {
      rendererName: "webgpu",
      toggles: { edges: true, nodes: true, diagnostics: true },
      stats: { visibleInstances: 64, batches: 1 },
      renderLoop: IDLE_RENDER_LOOP_STATS,
      selectedCount: 0,
    });

    expect(text).toContain("Unique triangles 32,768");
    expect(text).toContain("Submitted triangles 2,097,152");
    expect(text).toContain("Element family quad");
    expect(text).toContain("Unique elements 16,384");
    expect(text).toContain("Submitted element occurrences 1,048,576");
  });
});
