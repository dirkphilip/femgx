import { describe, expect, it } from "vitest";
import { importGlb } from "../../../src/io/glb/importer";
import { createImportedModel } from "../../../demo/workbench/models/model";
import { createModelInteraction } from "../../../demo/workbench/state/preset";
import { createDefaultDisplayToggles } from "../../../demo/workbench/types";
import { makeManyPrimitiveGlb } from "./glb-import-fixture";

const PRIMITIVE_COUNTS = [25_000, 50_000, 100_000] as const;
const sources = PRIMITIVE_COUNTS.map((count) => makeManyPrimitiveGlb(count));

describe("many-primitive GLB scaling", () => {
  it("keeps import and workbench activation approximately linear", async () => {
    const measurements: Array<{ readonly count: number; readonly milliseconds: number }> = [];
    for (let index = 0; index < PRIMITIVE_COUNTS.length; index += 1) {
      const count = PRIMITIVE_COUNTS[index];
      const source = sources[index];
      if (count === undefined || source === undefined) throw new Error("GLB fixture is missing");
      const start = performance.now();
      const imported = await importGlb(source);
      const model = createImportedModel(`many-${count}.glb`, {
        scene: imported.scene,
        elementModels: new Map(),
        partNames: imported.partNames,
        partStyles: imported.partStyles,
        results: undefined,
        issues: imported.issues,
      });
      const toggles = createDefaultDisplayToggles(model);
      createModelInteraction(model, toggles.edges, toggles.nodes);
      measurements.push({ count, milliseconds: performance.now() - start });
      expect(imported.scene.parts).toHaveLength(1);
      expect(imported.scene.parts.get(0)?.geometries[0]?.indices).toHaveLength(count * 3);
    }
    const normalized = measurements.map(({ count, milliseconds }) => milliseconds / count);
    const spread = Math.max(...normalized) / Math.min(...normalized);
    console.log(
      `many-primitive GLB: ${measurements
        .map(({ count, milliseconds }) => `${count}=${milliseconds.toFixed(1)} ms`)
        .join(", ")}`,
    );
    expect(spread).toBeLessThanOrEqual(4);
  });
});
