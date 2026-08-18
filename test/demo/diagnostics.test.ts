import { describe, expect, it } from "vitest";
import { createInteractionState } from "../../src/entries/root";
import { createSceneRuntime } from "../../src/entries/runtime";
import { createBoltedPlatePreset } from "../../demo/fixtures/presets";
import { createPerformancePreset } from "../../demo/fixtures/performance-fixture";
import { statsText } from "../../demo/devtools/diagnostics";
import { createExampleModel } from "../../demo/workbench/models/model";
import type { WorkbenchSceneContext } from "../../demo/workbench/types";
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

  it("counts only effective-visible instances in submitted element diagnostics", () => {
    const preset = createPerformancePreset();
    const model = {
      ...createExampleModel(preset),
      benchmarkElementFamily: "quad" as const,
    };
    const runtime = {
      getPartOccurrences: () => [
        {
          partOccurrenceId: "visible",
          partId: 1,
          occurrenceId: "root",
          visible: true,
          partVisible: true,
          overrideVisible: true,
          transform: new Float32Array(16),
        },
        {
          partOccurrenceId: "hidden",
          partId: 1,
          occurrenceId: "root",
          visible: false,
          partVisible: true,
          overrideVisible: true,
          transform: new Float32Array(16),
        },
      ],
    } as unknown as WorkbenchSceneContext["runtime"];
    const text = statsText(
      { model, runtime, interaction: createInteractionState() },
      {
        rendererName: "webgpu",
        toggles: { edges: true, nodes: true, diagnostics: true },
        stats: { visibleInstances: 1, batches: 1 },
        renderLoop: IDLE_RENDER_LOOP_STATS,
        selectedCount: 0,
      },
    );

    expect(text).toContain("Submitted triangles 32,768");
    expect(text).toContain("Submitted element occurrences 16,384");
  });

  it("reports a reusable part as shown when any occurrence is visible", () => {
    const preset = createPerformancePreset();
    const model = createExampleModel(preset);
    const runtime = {
      getPartOccurrences: () => [
        {
          partOccurrenceId: "hidden-first",
          partId: 1,
          occurrenceId: "root/hidden",
          visible: false,
        },
        {
          partOccurrenceId: "visible-second",
          partId: 1,
          occurrenceId: "root/visible",
          visible: true,
        },
      ],
    } as unknown as WorkbenchSceneContext["runtime"];
    const text = statsText(
      { model, runtime, interaction: createInteractionState() },
      {
        rendererName: "webgpu",
        toggles: { edges: true, nodes: true, diagnostics: true },
        stats: { visibleInstances: 1, batches: 1 },
        renderLoop: IDLE_RENDER_LOOP_STATS,
        selectedCount: 0,
      },
    );

    expect(text).toContain("Part 1 128 × 128 reusable shell · shown");
  });

  it("reports Performance Lab retention outcomes in the diagnostics HUD", () => {
    const preset = createPerformancePreset();
    const context = {
      model: {
        ...createExampleModel(preset),
        benchmarkElementFamily: "quad" as const,
        performanceRetentionReason: "reused" as const,
      },
      runtime: createSceneRuntime(preset.scene),
      interaction: createInteractionState(),
    };
    const text = statsText(context, {
      rendererName: "webgpu",
      toggles: { edges: false, nodes: false, diagnostics: true },
      stats: { visibleInstances: 64, batches: 1 },
      renderLoop: IDLE_RENDER_LOOP_STATS,
      selectedCount: 0,
    });

    expect(text).toContain("Performance model retention reused");
  });
});
