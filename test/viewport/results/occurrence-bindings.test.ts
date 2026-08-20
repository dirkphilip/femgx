import { describe, expect, it } from "vitest";
import { translationMatrix } from "@/math/mat4";
import { createPackedSceneRuntime } from "@/scene-runtime/runtime";
import { createNodalLoadField, createResultField } from "@/results/fields";
import {
  resolveViewportResults,
  viewportOrientationRecords,
  viewportResultColors,
} from "@/viewport/results";
import {
  createSceneBuilder,
  createTestScene,
  elementalScalar,
  elementalVector,
  nodalDisplacement,
} from "./support";

describe("occurrence-bound viewport results", () => {
  it("overrides scalar and deformation rows without duplicating the shared part", () => {
    const { scene, runtime, right } = repeatedPartScene();
    const sharedScalar = elementalScalar();
    const rightScalar = createResultField({
      ...sharedScalar,
      id: "right-stress",
      values: new Float32Array([9]),
    });
    const sharedDisplacement = nodalDisplacement();
    const rightDisplacement = createResultField({
      ...sharedDisplacement,
      id: "right-displacement",
      values: new Float32Array([1, 0, 0, 0, 2, 0, 0, 0, 3]),
    });
    const resolved = resolveViewportResults(
      {
        scalar: { field: sharedScalar, range: { min: 0, max: 10 } },
        deformation: { field: sharedDisplacement, scale: 2 },
        occurrences: [
          {
            partOccurrenceId: right,
            scalar: { field: rightScalar, range: { min: 0, max: 10 } },
            deformation: { field: rightDisplacement, scale: 3 },
          },
        ],
      },
      scene,
      runtime,
    );

    const colors = viewportResultColors(resolved);
    expect(colors?.get(1)).toBeDefined();
    expect(colors?.get(right)).toBeDefined();
    expect(colors?.get(right)).not.toBe(colors?.get(1));
    expect(resolved.deformation?.scale).toBe(1);
    expect(resolved.deformation?.displacements.get(1)?.[0]).toBeCloseTo(0.2);
    expect(resolved.deformation?.displacements.get(right)?.[0]).toBe(3);
    expect(scene.parts.size).toBe(1);
  });

  it("resolves occurrence orientation while retaining shared fallback records", () => {
    const { scene, runtime, right } = repeatedPartScene();
    const shared = elementalVector();
    const override = createResultField({
      ...shared,
      id: "right-direction",
      values: new Float32Array([0, 1, 0]),
    });
    const resolved = resolveViewportResults(
      {
        orientation: { field: shared, glyph: "arrow", transform: "direction" },
        occurrences: [
          {
            partOccurrenceId: right,
            orientation: { field: override, glyph: "axis", transform: "direction" },
          },
        ],
      },
      scene,
      runtime,
    );

    const records = viewportOrientationRecords(resolved);
    expect(records?.get(1)?.directions).toEqual(new Float32Array([1, 0, 0]));
    expect(records?.get(right)?.directions).toEqual(new Float32Array([0, 1, 0]));
    expect(records?.get(right)?.glyphModes).toEqual(new Uint32Array([1]));
  });

  it("replaces authored load rows for one occurrence", () => {
    const { scene, runtime, right } = repeatedPartScene();
    const load = (id: string, force: readonly [number, number, number]) =>
      createNodalLoadField({
        partId: 1,
        id,
        name: id,
        count: 3,
        forceUnit: "N",
        momentUnit: "N·m",
        values: new Float32Array([
          ...force,
          NaN,
          NaN,
          NaN,
          ...Array.from({ length: 12 }, () => NaN),
        ]),
      });
    const resolved = resolveViewportResults(
      {
        loads: { field: load("shared-load", [1, 0, 0]) },
        occurrences: [
          {
            partOccurrenceId: right,
            loads: { field: load("right-load", [0, 1, 0]) },
          },
        ],
      },
      scene,
      runtime,
    );

    expect(viewportOrientationRecords(resolved)?.get(1)?.directions.slice(0, 3)).toEqual(
      new Float32Array([1, 0, 0]),
    );
    expect(viewportOrientationRecords(resolved)?.get(right)?.directions.slice(0, 3)).toEqual(
      new Float32Array([0, 1, 0]),
    );
  });

  it("rejects duplicate and unknown occurrence bindings before replacing state", () => {
    const { scene, runtime, right } = repeatedPartScene();
    expect(() =>
      resolveViewportResults(
        {
          occurrences: [
            { partOccurrenceId: right, scalar: { field: elementalScalar() } },
            { partOccurrenceId: right, deformation: { field: nodalDisplacement() } },
          ],
        },
        scene,
        runtime,
      ),
    ).toThrow("bound more than once");
    expect(() =>
      resolveViewportResults(
        {
          occurrences: [{ partOccurrenceId: "1/missing", scalar: { field: elementalScalar() } }],
        },
        scene,
        runtime,
      ),
    ).toThrow("not rendered");
  });
});

function repeatedPartScene() {
  const base = createTestScene();
  const part = base.parts.get(1);
  if (part === undefined) throw new Error("Test part is missing");
  const scene = createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      name: "repeated",
      placements: [
        { kind: "part", placementId: "left", partId: 1, transform: translationMatrix(-2, 0, 0) },
        { kind: "part", placementId: "right", partId: 1, transform: translationMatrix(2, 0, 0) },
      ],
    })
    .setRootAssembly(1)
    .build();
  const runtime = createPackedSceneRuntime(scene);
  const right = runtime.getInstanceId(runtime.getInstanceSlot("1/right") ?? -1);
  if (right === undefined) throw new Error("Right occurrence is missing");
  return { scene, runtime, right };
}
