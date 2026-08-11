import { createElement } from "../../src/elements/element";
import { createElementModel } from "../../src/elements/model";
import { HEX8_SHAPE } from "../../src/elements/shapes";
import { heterogeneousElementParts } from "../../src/geometry/heterogeneous-element-mesh";
import { computeBounds } from "../../src/geometry/part";
import { identity } from "../../src/math/mat4";
import { createResultField } from "../../src/results/fields";
import { createScene } from "../../src/scene/scene";
import type { PartId } from "../../src/scene/types";
import type { ModelPreset } from "./presets";

const RESULTS_PART_ID: PartId = 20;

/** Builds the demo's small static stress/deformation results workflow. */
export function createResultsPreset(): ModelPreset {
  const model = createElementModel(
    [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1],
    [createElement(1, HEX8_SHAPE, [0, 1, 2, 3, 4, 5, 6, 7])],
  );
  const part = heterogeneousElementParts({ triangle: RESULTS_PART_ID }, model).triangle;
  if (part === undefined) throw new Error("Results fixture has no triangle part");
  const scene = createScene()
    .addPart(part)
    .addAssembly({
      id: 20,
      name: "results-block",
      placements: [{ kind: "part", partId: RESULTS_PART_ID, transform: identity() }],
    })
    .withRoot(20)
    .build();
  const stress = createResultField({
    id: "demo-stress",
    name: "Demo stress",
    location: "elemental",
    shape: "tensor",
    count: 2,
    unit: "MPa",
    values: new Float32Array([NaN, NaN, NaN, NaN, NaN, NaN, 40, 0, 0, 0, 0, 0]),
  });
  const displacement = createResultField({
    id: "demo-displacement",
    name: "Demo displacement",
    location: "nodal",
    shape: "vector",
    count: model.nodes.length / 3,
    unit: "mm",
    values: new Float32Array(
      model.nodes.map((value, index) => (index % 3 === 2 ? value * 0.15 : 0)),
    ),
  });
  return {
    id: "results",
    name: "Static results · stress + deformation",
    scene,
    elementModels: new Map([[RESULTS_PART_ID, model]]),
    partColors: new Map([[RESULTS_PART_ID, { r: 0.48, g: 0.55, b: 0.68, a: 1 }]]),
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    partNames: new Map([[RESULTS_PART_ID, "Results block"]]),
    modePartIds: new Map([
      ["solid", [RESULTS_PART_ID]],
      ["surface", [RESULTS_PART_ID]],
      ["edges", [RESULTS_PART_ID]],
    ]),
    overlayPartIds: [],
    defaultMode: "solid",
    bounds: computeBounds(part.geometry),
    results: {
      field: stress,
      derive: "vonMises",
      deformation: { field: displacement, scale: 1 },
    },
  };
}
