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

/** Grid cells along X and Y; the mesh is a triangulated plate grid. */
const CELLS_X = 6;
const CELLS_Y = 4;
const WIDTH = 6;
const DEPTH = 4;
const NODE_COLUMNS = CELLS_X + 1;
const NODE_ROWS = CELLS_Y + 1;
const NODE_COUNT = NODE_COLUMNS * NODE_ROWS;
const ELEMENT_COUNT = CELLS_X * CELLS_Y * 2;

/** A triangulated FE mesh whose vertex index matches the node index. */
export interface ResultsMesh {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
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
  const positions = new Float32Array(NODE_COUNT * 3);
  for (let row = 0; row < NODE_ROWS; row++) {
    for (let column = 0; column < NODE_COLUMNS; column++) {
      const base = (row * NODE_COLUMNS + column) * 3;
      positions[base] = (column / CELLS_X) * WIDTH;
      positions[base + 1] = (row / CELLS_Y) * DEPTH;
      positions[base + 2] = 0;
    }
  }
  const indices = new Uint32Array(ELEMENT_COUNT * 3);
  let element = 0;
  for (let row = 0; row < CELLS_Y; row++) {
    for (let column = 0; column < CELLS_X; column++) {
      const n00 = row * NODE_COLUMNS + column;
      const n10 = n00 + 1;
      const n01 = n00 + NODE_COLUMNS;
      const n11 = n01 + 1;
      const base = element * 3;
      indices[base] = n00;
      indices[base + 1] = n10;
      indices[base + 2] = n01;
      indices[base + 3] = n10;
      indices[base + 4] = n11;
      indices[base + 5] = n01;
      element += 2;
    }
  }
  return { positions, indices };
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
      for (let half = 0; half < 2; half++) {
        const base = (cell * 2 + half) * 6;
        for (let index = 0; index < 6; index++) {
          values[base + index] = components[index] ?? NaN;
        }
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
