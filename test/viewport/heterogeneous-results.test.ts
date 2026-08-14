import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { createElementModel } from "../../src/elements/model";
import {
  HEX8_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  QUAD_SHAPE,
  TRIANGLE_SHAPE,
  TET4_SHAPE,
} from "../../src/elements/shapes";
import { elementPart } from "../../src/geometry/heterogeneous-element-mesh";
import { computeBounds } from "../../src/geometry/part";
import { createInteractionState } from "../../src/interaction/interaction";
import { readInteractionState } from "../../src/interaction/state";
import { identity } from "../../src/math/mat4";
import { createResultField } from "../../src/results/fields";
import { createScene } from "../../src/scene/scene";
import { applyViewportResultInteraction, resolveViewportResults } from "../../src/viewport/results";

function mixedModel() {
  const nodes: number[] = [];
  for (let node = 0; node < 22; node += 1) nodes.push(node % 4, Math.floor(node / 4), 0);
  return createElementModel(nodes, [
    createElement(1, TRIANGLE_SHAPE, [0, 1, 2]),
    createElement(2, QUAD_SHAPE, [3, 4, 5, 6]),
    createElement(3, TET4_SHAPE, [7, 8, 9, 10]),
    createElement(4, HEX8_SHAPE, [11, 12, 13, 14, 15, 16, 17, 18]),
    createElement(5, LINE_SHAPE, [19, 20]),
    createElement(6, POINT_SHAPE, [21]),
  ]);
}

function heterogeneousScene() {
  const model = mixedModel();
  const sourceParts = [elementPart(30, model)];
  let builder = createScene();
  for (const part of sourceParts) builder = builder.addPart(part);
  const scene = builder
    .addAssembly({
      id: 1,
      name: "mixed",
      placements: sourceParts.map((part) => ({
        kind: "part" as const,
        partId: part.id,
        transform: identity(),
      })),
    })
    .withRoot(1)
    .build();
  return { scene, partIds: sourceParts.map((part) => part.id) };
}

describe("heterogeneous viewport results", () => {
  it("maps elemental values and nodal deformation across every primitive group", () => {
    const { scene, partIds } = heterogeneousScene();
    const scalar = createResultField({
      id: "mixed-scalar",
      name: "Mixed scalar",
      location: "elemental",
      shape: "scalar",
      count: 7,
      unit: "MPa",
      values: new Float32Array([NaN, 10, 20, 30, 40, 50, 60]),
    });
    const displacement = createResultField({
      id: "mixed-displacement",
      name: "Mixed displacement",
      location: "nodal",
      shape: "vector",
      count: 22,
      unit: "mm",
      values: new Float32Array(22 * 3),
    });
    const runtime = {
      instanceCount: partIds.length,
      getPartId: (slot: number) => partIds[slot],
      getInstanceId: (slot: number) => `1/${slot}`,
    } as never;

    const result = resolveViewportResults(
      {
        scalar: { field: scalar, range: { min: 0, max: 60 } },
        deformation: { field: displacement },
      },
      scene,
      runtime,
    );

    const resolvedScalar = result.scalar;
    if (resolvedScalar?.field.location !== "elemental") {
      throw new Error("Expected elemental field");
    }
    const effective = applyViewportResultInteraction(
      createInteractionState(),
      resolvedScalar,
      scene,
      runtime,
    );
    const effectiveData = readInteractionState(effective);
    expect([...(effectiveData.elementOverrides.get("1/0")?.keys() ?? [])]).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(result.deformation?.displacements.size).toBe(1);
    expect(result.deformation?.displacements.get(30)?.length).toBe(22 * 3);
  });

  it("keeps each generated part independently bounds-valid", () => {
    const { scene } = heterogeneousScene();
    const part = scene.parts.get(30);
    if (part === undefined) throw new Error("mixed part missing");
    expect(part.bounds).toBeDefined();
    expect(part.bounds).not.toEqual(computeBounds(part.geometry));
  });
});
