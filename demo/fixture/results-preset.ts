import {
  createElement,
  createElementModel,
  createResultField,
  createScene,
  HEX8_SHAPE,
  elementPart,
  identity,
  multiply,
  scale,
  translation,
  type PartId,
  type VectorField,
} from "../../src/index";
import type { ModelPreset } from "./presets";
import { fixtureBounds } from "./preset-bounds";

const RESULTS_PART_ID: PartId = 20;

/** Builds the demo's deterministic scalar, deformation, and orientation workflow. */
export function createResultsPreset(): ModelPreset {
  const model = createResultsModel();
  const part = elementPart(RESULTS_PART_ID, model);
  const scene = createScene()
    .addPart(part)
    .addAssembly({
      id: 20,
      name: "results-block",
      placements: [
        { kind: "part", partId: RESULTS_PART_ID, transform: identity() },
        {
          kind: "part",
          partId: RESULTS_PART_ID,
          transform: multiply(translation(5.5, 0.25, 0.2), scale(-1.15, 0.8, 1.2)),
        },
      ],
    })
    .withRoot(20)
    .build();
  const stress = createResultField({
    id: "demo-stress",
    name: "Demo stress",
    location: "elemental",
    shape: "scalar",
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
  const normals = createNormalsField(model.elements.length);
  const fibers = createFibersField(model.elements.length);
  const vectorFields = [normals, fibers] as const;
  return {
    id: "results",
    name: "Static results · scalar + deformation + orientation",
    scene,
    elementModels: new Map([[RESULTS_PART_ID, model]]),
    partColors: new Map([[RESULTS_PART_ID, { r: 0.48, g: 0.55, b: 0.68, a: 1 }]]),
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    partNames: new Map([[RESULTS_PART_ID, "Results block"]]),
    bounds: fixtureBounds(scene),
    resultVectorFields: vectorFields,
    results: {
      scalar: { field: stress },
      deformation: { field: displacement, scale: 1 },
      vectors: {
        field: normals,
        glyph: "arrow",
        transform: "normal",
        lengthScale: 1,
      },
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
  const values = new Float32Array(elementCount);
  for (let element = 0; element < elementCount; element += 1) {
    values[element] = 10 + element * 10;
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

function createNormalsField(elementCount: number): VectorField<"elemental"> {
  return createResultField({
    id: "demo-normals",
    name: "Demo shell normals",
    location: "elemental",
    shape: "vector",
    count: elementCount,
    unit: "unitless",
    values: new Float32Array([
      0,
      0,
      1,
      0,
      0,
      -1,
      Number.NaN,
      Number.NaN,
      Number.NaN,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      -1,
      0,
      1,
      0,
      0,
      -1,
      0,
      0,
    ]),
  });
}

function createFibersField(elementCount: number): VectorField<"elemental"> {
  return createResultField({
    id: "demo-fibers",
    name: "Demo fiber orientations",
    location: "elemental",
    shape: "vector",
    count: elementCount,
    unit: "unitless",
    values: new Float32Array([
      1, 0.25, 0, -1, -0.25, 0, 0, 1, 0, 0, -1, 0, 1, 1, 0, -1, -1, 0, 1, 0, 1, -1, 0, -1,
    ]),
  });
}
