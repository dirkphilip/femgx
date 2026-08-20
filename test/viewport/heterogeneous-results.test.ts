import { describe, expect, it } from "vitest";
import { createElement } from "../../src/elements/element";
import { createElementModel } from "../../src/elements/model";
import { ElementShape } from "../../src/elements/shapes";
import { createPartFromElementModel } from "../../src/geometry/element-model-part";
import { computeBounds } from "../../src/geometry/part";
import { identityMatrix } from "../../src/math/mat4";
import { createResultField } from "../../src/results/fields";
import { createSceneBuilder } from "../../src/scene/scene";
import { resolveViewportResults, viewportResultColors } from "../../src/viewport/results";

function mixedModel() {
  const nodes: number[] = [];
  for (let node = 0; node < 22; node += 1) nodes.push(node % 4, Math.floor(node / 4), 0);
  return createElementModel(nodes, [
    createElement(1, ElementShape.Triangle, [0, 1, 2]),
    createElement(2, ElementShape.Quad, [3, 4, 5, 6]),
    createElement(3, ElementShape.Tet4, [7, 8, 9, 10]),
    createElement(4, ElementShape.Hex8, [11, 12, 13, 14, 15, 16, 17, 18]),
    createElement(5, ElementShape.Line, [19, 20]),
    createElement(6, ElementShape.Point, [21]),
  ]);
}

function heterogeneousScene() {
  const model = mixedModel();
  const sourceParts = [createPartFromElementModel(30, model)];
  let builder = createSceneBuilder();
  for (const part of sourceParts) builder = builder.addPart(part);
  const scene = builder
    .addAssembly({
      id: 1,
      name: "mixed",
      placements: sourceParts.map((part) => ({
        kind: "part" as const,
        partId: part.id,
        transform: identityMatrix(),
      })),
    })
    .setRootAssembly(1)
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

    const colors = viewportResultColors(result)?.get(30);
    expect(colors?.location).toBe("elemental");
    expect(colors?.values).toHaveLength(7 * 4);
    expect(result.deformation?.displacements.size).toBe(1);
    expect(result.deformation?.displacements.get(30)?.length).toBe(22 * 3);
  });

  it("keeps each generated part independently bounds-valid", () => {
    const { scene } = heterogeneousScene();
    const part = scene.parts.get(30);
    if (part === undefined) throw new Error("mixed part missing");
    const geometry = part.geometries[0];
    if (geometry === undefined) throw new Error("mixed part geometry missing");
    expect(part.bounds).toBeDefined();
    expect(part.bounds).not.toEqual(computeBounds(geometry));
  });
});
