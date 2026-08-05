import { createElement } from "../src/elements/element";
import { createElementModel } from "../src/elements/model";
import { TET4_SHAPE } from "../src/elements/shapes";
import { elementGeometry } from "../src/geometry/element-mesh";
import {
  createResultField,
  createScalarColorMap,
  finiteRange,
  vonMisesValues,
  type Color,
  type ScalarColorMap,
  type TensorField,
  type ValueRange,
  type VectorField,
} from "../src/index";

/** Grid cells along X and Y; the mesh is a plate grid of one tet per cell. */
const CELLS_X = 6;
const CELLS_Y = 4;
const WIDTH = 6;
const DEPTH = 4;
const NODE_COLUMNS = CELLS_X + 1;
const NODE_ROWS = CELLS_Y + 1;
const NODE_COUNT = NODE_COLUMNS * NODE_ROWS;
const ELEMENT_COUNT = CELLS_X * CELLS_Y;

/**
 * A tessellated FE plate mesh: duplicated vertices per triangle plus the
 * per-vertex node map that lets a nodal displacement field deform it, exactly
 * what `elementGeometry` produces for an FE model.
 */
export interface ResultsMesh {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** Per-vertex node ids (`nodeId + 1`, `0` = interpolated). */
  readonly nodePickIds: Uint32Array;
  /** Owning element id of every triangle, for per-element stress coloring. */
  readonly triangleElements: Uint32Array;
}

/** One analysis step: a displacement field, a stress field, and its von Mises. */
export interface ResultsLoadCase {
  readonly name: string;
  readonly displacement: VectorField<"nodal">;
  readonly stress: TensorField<"elemental">;
  readonly vonMises: Float32Array;
}

/** The deterministic results demo data: mesh, load cases, and a shared color map. */
export interface ResultsFixture {
  readonly mesh: ResultsMesh;
  readonly cases: readonly ResultsLoadCase[];
  /** Observed range over every load case, used for the shared color map. */
  readonly range: ValueRange;
  readonly colorMap: ScalarColorMap;
  readonly baseColor: Color;
}

/**
 * Builds the results demo: a cantilever plate in the XY plane with a nodal
 * displacement field and an elemental stress field per load case. Element 0 of
 * every stress field is missing (`NaN`) to exercise missing-value handling.
 * The mesh is tessellated by the FE geometry builder (one degenerate tet per
 * grid cell), so the demo exercises the node-mapped deformation path rather
 * than a hand-built node-aligned vertex buffer.
 */
export function createResultsFixture(): ResultsFixture {
  const mesh = buildMesh();
  const cases = [buildBendingCase(), buildTwistCase()];
  const allValues = new Float32Array(cases.length * ELEMENT_COUNT);
  for (let index = 0; index < cases.length; index++) {
    const caze = cases[index];
    if (caze === undefined) continue;
    allValues.set(caze.vonMises, index * ELEMENT_COUNT);
  }
  const range = finiteRange(allValues) ?? { min: 0, max: 1 };
  return {
    mesh,
    cases,
    range,
    colorMap: createScalarColorMap({ min: range.min, max: range.max }),
    baseColor: { r: 0.62, g: 0.72, b: 0.86, a: 1 },
  };
}

function buildMesh(): ResultsMesh {
  const nodes: number[] = [];
  for (let row = 0; row < NODE_ROWS; row++) {
    for (let column = 0; column < NODE_COLUMNS; column++) {
      nodes.push((column / CELLS_X) * WIDTH, (row / CELLS_Y) * DEPTH, 0);
    }
  }
  const elements = [];
  for (let row = 0; row < CELLS_Y; row++) {
    for (let column = 0; column < CELLS_X; column++) {
      const n00 = row * NODE_COLUMNS + column;
      const n10 = n00 + 1;
      const n11 = n00 + NODE_COLUMNS + 1;
      const n01 = n00 + NODE_COLUMNS;
      elements.push(createElement(row * CELLS_X + column, TET4_SHAPE, [n00, n10, n11, n01]));
    }
  }
  const geometry = elementGeometry(createElementModel(nodes, elements), "tet", "solid");
  const nodePickIds = geometry.nodePickIds;
  if (nodePickIds === undefined) {
    throw new Error("results fixture mesh must be node-mapped");
  }
  return {
    positions: geometry.positions,
    indices: geometry.indices,
    nodePickIds,
    triangleElements: triangleElementsOf(geometry),
  };
}

/** Maps each triangle to the element that tessellated it, in triangle order. */
function triangleElementsOf(geometry: {
  readonly indices: Uint32Array;
  readonly elements?: readonly {
    readonly id: number;
    readonly triangleStart: number;
    readonly triangleCount: number;
  }[];
}): Uint32Array {
  const triangleCount = Math.floor(geometry.indices.length / 3);
  const triangleElements = new Uint32Array(triangleCount);
  for (const element of geometry.elements ?? []) {
    const end = element.triangleStart + element.triangleCount;
    for (let triangle = element.triangleStart; triangle < end; triangle++) {
      triangleElements[triangle] = element.id;
    }
  }
  return triangleElements;
}

function buildBendingCase(): ResultsLoadCase {
  const values = new Float32Array(NODE_COUNT * 3);
  for (let row = 0; row < NODE_ROWS; row++) {
    for (let column = 0; column < NODE_COLUMNS; column++) {
      const base = (row * NODE_COLUMNS + column) * 3;
      const x = (column / CELLS_X) * WIDTH;
      values[base] = 0;
      values[base + 1] = 0;
      values[base + 2] = 0.9 * (x / WIDTH) * (x / WIDTH);
    }
  }
  const displacement = createResultField({
    id: "u-bending",
    name: "Displacement (bending)",
    location: "nodal",
    shape: "vector",
    count: NODE_COUNT,
    unit: "m",
    values,
  });
  const stress = buildStressField("bending", (cx, cy) => {
    const sxx = 120 * (cx - 0.5) + 30 * (cy - 0.5);
    return [sxx, 0.3 * sxx, 0, 12, 0, 0];
  });
  return { name: "bending", displacement, stress, vonMises: vonMisesValues(stress) };
}

function buildTwistCase(): ResultsLoadCase {
  const values = new Float32Array(NODE_COUNT * 3);
  for (let row = 0; row < NODE_ROWS; row++) {
    for (let column = 0; column < NODE_COLUMNS; column++) {
      const base = (row * NODE_COLUMNS + column) * 3;
      const x = (column / CELLS_X) * WIDTH;
      const y = (row / CELLS_Y) * DEPTH;
      values[base] = 0;
      values[base + 1] = 0;
      values[base + 2] = 1.2 * (x / WIDTH) * (y / DEPTH - 0.5);
    }
  }
  const displacement = createResultField({
    id: "u-twist",
    name: "Displacement (twist)",
    location: "nodal",
    shape: "vector",
    count: NODE_COUNT,
    unit: "m",
    values,
  });
  const stress = buildStressField("twist", (cx, cy) => {
    const sxx = 90 * (cx - 0.5);
    return [sxx, 0.25 * sxx, 0, 25 * (cy - 0.5), 0, 0];
  });
  return { name: "twist", displacement, stress, vonMises: vonMisesValues(stress) };
}

function buildStressField(
  id: string,
  tensor: (cx: number, cy: number) => readonly [number, number, number, number, number, number],
): TensorField<"elemental"> {
  const values = new Float32Array(ELEMENT_COUNT * 6);
  for (let row = 0; row < CELLS_Y; row++) {
    for (let column = 0; column < CELLS_X; column++) {
      const cell = row * CELLS_X + column;
      const cx = (column + 0.5) / CELLS_X;
      const cy = (row + 0.5) / CELLS_Y;
      const components = tensor(cx, cy);
      const base = cell * 6;
      for (let index = 0; index < 6; index++) {
        values[base + index] = components[index] ?? NaN;
      }
    }
  }
  values.set([NaN, NaN, NaN, NaN, NaN, NaN], 0);
  return createResultField({
    id: `stress-${id}`,
    name: `Stress (${id})`,
    location: "elemental",
    shape: "tensor",
    count: ELEMENT_COUNT,
    unit: "MPa",
    values,
  });
}
