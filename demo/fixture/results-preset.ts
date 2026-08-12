import {
  createElement,
  createElementModel,
  createResultField,
  createScene,
  HEX8_SHAPE,
  heterogeneousElementParts,
  identity,
  type PartId,
} from "../../src/index";
import type { ModelPreset } from "./presets";

const RESULTS_PART_ID: PartId = 20;

/** Builds the demo's small static stress/deformation results workflow. */
export function createResultsPreset(): ModelPreset {
  const model = createResultsModel();
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
    count: model.elements.length,
    unit: "MPa",
    values: createStressValues(model.elements.length),
  });
  const displacement = createResultField({
    id: "demo-displacement",
    name: "Demo displacement",
    location: "nodal",
    shape: "vector",
    count: model.nodes.length / 3,
    unit: "mm",
    values: createDisplacementValues(model.nodes),
  });
  return {
    id: "results",
    name: "Static results · stress + deformation",
    scene,
    elementModels: new Map([[RESULTS_PART_ID, model]]),
    partColors: new Map([[RESULTS_PART_ID, { r: 0.48, g: 0.55, b: 0.68, a: 1 }]]),
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    partNames: new Map([[RESULTS_PART_ID, "Results block"]]),
    bounds: part.bounds,
    results: {
      field: stress,
      derive: "vonMises",
      deformation: { field: displacement, scale: 1 },
    },
  };
}

/** Builds one conforming 4-by-2-by-1 Hex8 strip with dense shared node ids. */
function createResultsModel() {
  const columns = 4;
  const rows = 2;
  const nodes: number[] = [];
  const nodeId = (i: number, j: number, k: number): number =>
    k * (rows + 1) * (columns + 1) + j * (columns + 1) + i;

  for (let k = 0; k <= 1; k += 1) {
    for (let j = 0; j <= rows; j += 1) {
      for (let i = 0; i <= columns; i += 1) nodes.push(i, j, k);
    }
  }

  const elements = [];
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) {
      const c0 = nodeId(i, j, 0);
      const c1 = nodeId(i + 1, j, 0);
      const c2 = nodeId(i + 1, j + 1, 0);
      const c3 = nodeId(i, j + 1, 0);
      const c4 = nodeId(i, j, 1);
      const c5 = nodeId(i + 1, j, 1);
      const c6 = nodeId(i + 1, j + 1, 1);
      const c7 = nodeId(i, j + 1, 1);
      elements.push(createElement(j * columns + i, HEX8_SHAPE, [c0, c1, c2, c3, c4, c5, c6, c7]));
    }
  }
  return createElementModel(nodes, elements);
}

function createStressValues(elementCount: number): Float32Array {
  const values = new Float32Array(elementCount * 6);
  for (let element = 0; element < elementCount; element += 1) {
    values[element * 6] = 10 + element * 10;
  }
  return values;
}

function createDisplacementValues(nodes: Float32Array): Float32Array {
  const values = new Float32Array(nodes.length);
  for (let node = 0; node < nodes.length / 3; node += 1) {
    const offset = node * 3;
    const x = nodes[offset] ?? 0;
    const y = nodes[offset + 1] ?? 0;
    const xFraction = x / 4;
    const yFraction = y / 2;
    values[offset] = 0.08 * xFraction * xFraction;
    values[offset + 1] = 0.12 * Math.sin(Math.PI * xFraction) * (0.25 + 0.75 * yFraction);
    values[offset + 2] = 0.35 * xFraction * xFraction + 0.12 * xFraction * yFraction;
  }
  return values;
}
