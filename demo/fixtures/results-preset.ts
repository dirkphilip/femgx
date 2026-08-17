import {
  createResultField,
  createScene,
  identity,
  multiply,
  rotationZ,
  scale,
  translation,
  type PartId,
  type VectorField,
} from "../../src/entries/root";
import {
  createElement,
  createElementModel,
  elementPart,
  ElementShape,
} from "../../src/entries/model";
import type { AuthoredResultSequence, ModelPreset } from "./presets";
import { sceneBounds } from "../scene-bounds";

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
          transform: multiply(
            translation(9.5, 5, 0.2),
            multiply(rotationZ(0.32), scale(-1.15, 0.8, 1.2)),
          ),
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
  const temperature = createResultField({
    id: "demo-temperature",
    name: "Demo temperature",
    location: "nodal",
    shape: "scalar",
    count: model.nodes.length / 3,
    unit: "C",
    values: createTemperatureValues(model.nodes),
  });
  const normals = createNormalsField(model);
  const fibers = createFibersField(model.elements.length);
  const vectorFields = [normals, fibers] as const;
  const resultSequence = createResultSequence(model);
  return {
    id: "results",
    name: "Static results · scalar + deformation + orientation",
    scene,
    elementModels: new Map([[RESULTS_PART_ID, model]]),
    partColors: new Map([[RESULTS_PART_ID, { r: 0.48, g: 0.55, b: 0.68, a: 1 }]]),
    fallbackColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
    partNames: new Map([[RESULTS_PART_ID, "Results block"]]),
    bounds: sceneBounds(scene),
    resultVectorFields: vectorFields,
    results: {
      scalar: { field: stress },
      deformation: { field: displacement, scale: 1 },
      vectors: {
        field: normals,
        glyph: "arrow",
        transform: "normal",
        lengthScale: 1,
        widthPixels: 2,
      },
    },
    resultSequence,
    resultScalarFields: [stress, temperature],
  };
}

function createResultSequence(
  model: ReturnType<typeof createResultsModel>,
): AuthoredResultSequence {
  const steps = Array.from({ length: 4 }, (_, index) => {
    const scalar = createResultField({
      id: `demo-temperature-snapshot-${index}`,
      name: `Demo temperature · Snapshot ${index + 1}`,
      location: "nodal",
      shape: "scalar",
      count: model.nodes.length / 3,
      unit: "C",
      values: createSnapshotTemperatureValues(model.nodes, index),
    });
    const deformation = createResultField({
      id: `demo-displacement-snapshot-${index}`,
      name: "Demo displacement snapshot",
      location: "nodal",
      shape: "vector",
      count: model.nodes.length / 3,
      unit: "mm",
      values: createScaledDisplacementValues(model.nodes, 1 + index * 0.3),
    });
    return { label: `Snapshot ${index + 1}`, time: index, scalar, deformation };
  });
  return { label: "Authored nodal temperature snapshots", range: { min: 10, max: 100 }, steps };
}

function createSnapshotTemperatureValues(nodes: Float32Array, step: number): Float32Array {
  const values = createTemperatureValues(nodes);
  for (let node = 0; node < values.length; node += 1) {
    const offset = node * 3;
    const x = nodes[offset] ?? 0;
    const y = nodes[offset + 1] ?? 0;
    values[node] = (values[node] ?? 0) + step * (4 + x * 2 - y);
  }
  return values;
}

function createScaledDisplacementValues(nodes: Float32Array, scaleValue: number): Float32Array {
  const values = createDisplacementValues(nodes);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = (values[index] ?? 0) * scaleValue;
  }
  return values;
}

/** Builds one gently curved, consistently wound 4-by-2 Quad shell. */
function createResultsModel() {
  const columns = 4;
  const rows = 2;
  const nodes: number[] = [];
  const nodeId = (i: number, j: number): number => j * (columns + 1) + i;

  for (let j = 0; j <= rows; j += 1) {
    for (let i = 0; i <= columns; i += 1) {
      const x = i;
      const y = j;
      const z = 0.04 * i * i + 0.04 * j;
      nodes.push(x, y, z);
    }
  }

  const elements = [];
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) {
      const c0 = nodeId(i, j);
      const c1 = nodeId(i + 1, j);
      const c2 = nodeId(i + 1, j + 1);
      const c3 = nodeId(i, j + 1);
      elements.push(createElement(j * columns + i, ElementShape.Quad, [c0, c1, c2, c3]));
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

function createTemperatureValues(nodes: ArrayLike<number>): Float32Array {
  const values = new Float32Array(nodes.length / 3);
  for (let node = 0; node < values.length; node += 1) {
    const offset = node * 3;
    values[node] = 20 + (nodes[offset] ?? 0) * 8 + (nodes[offset + 1] ?? 0) * 3;
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

function createNormalsField(
  model: ReturnType<typeof createResultsModel>,
): VectorField<"elemental"> {
  const values = new Float32Array(model.elements.length * 3);
  for (const [index, element] of model.elements.entries()) {
    const first = pointAt(model.nodes, element.nodeIds[0]);
    const second = pointAt(model.nodes, element.nodeIds[1]);
    const third = pointAt(model.nodes, element.nodeIds[2]);
    const normal = normalizedCross(subtract(second, first), subtract(third, first));
    values.set(normal, index * 3);
  }
  return createResultField({
    id: "demo-normals",
    name: "Demo shell normals · authored outward",
    location: "elemental",
    shape: "vector",
    count: model.elements.length,
    unit: "unitless",
    values,
  });
}

function pointAt(nodes: ArrayLike<number>, nodeId: number | undefined): [number, number, number] {
  if (nodeId === undefined) throw new Error("Shell element is missing a node");
  const offset = nodeId * 3;
  return [nodes[offset] ?? 0, nodes[offset + 1] ?? 0, nodes[offset + 2] ?? 0];
}

function subtract(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normalizedCross(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  const cross: [number, number, number] = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const length = Math.hypot(cross[0], cross[1], cross[2]);
  if (!Number.isFinite(length) || length <= 1e-8) throw new Error("Shell face is degenerate");
  return [cross[0] / length, cross[1] / length, cross[2] / length];
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
