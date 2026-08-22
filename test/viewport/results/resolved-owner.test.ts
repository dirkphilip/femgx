import { describe, expect, it } from "vitest";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { resolvedViewportResultData } from "@/viewport/results/resolved-owner";
import {
  createTestScene,
  elementalScalar,
  elementalVector,
  nodalDisplacement,
  resolveViewportResults,
  viewportOrientationRecords,
  viewportResultColors,
} from "./support";

describe("resolved viewport result owner", () => {
  it("keeps renderer data with the public result projection", () => {
    const scene = createTestScene();
    const state = resolveViewportResults(
      {
        scalar: { field: elementalScalar() },
        deformation: { field: nodalDisplacement() },
        orientation: { field: elementalVector(), glyph: "arrow", transform: "direction" },
      },
      scene,
      createPackedSceneRuntime(scene),
    );
    const data = resolvedViewportResultData(state);

    expect(data).toBeDefined();
    expect(data?.colors).toBe(viewportResultColors(state));
    expect(data?.sharedDeformation?.displacements.get(1)).toBe(
      state.deformation?.displacements.get(1),
    );
    expect(data?.orientationRecords).toBe(viewportOrientationRecords(state));
    expect(Object.keys(state)).toEqual(["config", "scalar", "deformation", "orientation", "loads"]);
  });
});
