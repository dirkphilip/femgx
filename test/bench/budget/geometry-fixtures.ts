import { createStructuredFeModel } from "../../../demo/benchmark/structured-fe";
import { createElement, type Element } from "../../../src/elements/element";
import { createElementModel } from "../../../src/elements/model";
import { FEMGX_FORMAT_VERSION, type FemModel } from "../../../src/io/fem-model";
import {
  HEX8_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  QUAD_SHAPE,
  TRIANGLE_SHAPE,
  TET4_SHAPE,
} from "../../../src/elements/shapes";
import { createPart, type Part, type TriangleGeometry } from "../../../src/entries/root";
import { BENCH_BODY_COUNT, BENCH_BODY_GRID_CELLS, makeBodies, makeBodyGeometry } from "../fixtures";

const CONVERSION_BENCH_ELEMENT_COUNT = 250_000;
const conversionBenchmarkModel = makeConversionBenchmarkModel();
const faceSubsetBenchmarkGeometry = makeFaceSubsetBenchmarkGeometry();
const faceSubsetBenchmarkPart = makeFaceSubsetBenchmarkPart(faceSubsetBenchmarkGeometry);

const heterogeneousModel = makeHeterogeneousModel(100);
const bodyGeometry = makeBodyGeometry();

const bodyModel = createStructuredFeModel("quad", BENCH_BODY_GRID_CELLS);
const bodies = makeBodies(bodyModel.elements.length, BENCH_BODY_COUNT);
const bodyModelWithBodies = createElementModel([...bodyModel.nodes], bodyModel.elements, {
  bodies,
});

const LINE_BENCH_SEGMENTS = 10_000;
const lineHeavyGeometry = {
  positions: Float32Array.from({ length: (LINE_BENCH_SEGMENTS + 1) * 3 }, (_, index) => index % 3),
  indices: Uint32Array.from(
    { length: LINE_BENCH_SEGMENTS * 2 },
    (_, index) => Math.floor(index / 2) + (index % 2),
  ),
  primitive: "lines" as const,
};

const SOLID_SCALING_GRID_SIZES = [8, 12, 16] as const;
const solidScalingModels = SOLID_SCALING_GRID_SIZES.map((gridSize) =>
  createStructuredFeModel("hex8", gridSize),
);
const NODE_COPY_BENCH_NODE_COUNT = 500_000;
const nodeCopyBenchmarkNodes = new Float32Array(NODE_COPY_BENCH_NODE_COUNT * 3);
nodeCopyBenchmarkNodes.set([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
const nodeCopyBenchmarkModel = createElementModel(nodeCopyBenchmarkNodes, [
  createElement(1, TET4_SHAPE, [0, 1, 2, 3]),
]);

function makeHeterogeneousModel(repetitions: number) {
  const nodes: number[] = [];
  const elements: Element[] = [];
  let nextElementId = 1;
  const addElement = (shape: Parameters<typeof createElement>[1], nodeCount: number): void => {
    const start = nodes.length / 3;
    for (let node = 0; node < nodeCount; node += 1) {
      nodes.push(start + node, 0, node % 2);
    }
    elements.push(
      createElement(
        nextElementId,
        shape,
        Array.from({ length: nodeCount }, (_, node) => start + node),
      ),
    );
    nextElementId += 1;
  };
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    addElement(TRIANGLE_SHAPE, 3);
    addElement(QUAD_SHAPE, 4);
    addElement(TET4_SHAPE, 4);
    addElement(HEX8_SHAPE, 8);
    addElement(LINE_SHAPE, 2);
    addElement(POINT_SHAPE, 1);
  }
  return createElementModel(nodes, elements);
}

function makeConversionBenchmarkModel(): FemModel {
  const ids = new Uint32Array(CONVERSION_BENCH_ELEMENT_COUNT);
  const connectivity = new Uint32Array(CONVERSION_BENCH_ELEMENT_COUNT * 3);
  for (let index = 0; index < CONVERSION_BENCH_ELEMENT_COUNT; index += 1) {
    ids[index] = index + 1;
    const start = index * 3;
    connectivity[start] = 0;
    connectivity[start + 1] = 1;
    connectivity[start + 2] = 2;
  }
  return {
    formatVersion: FEMGX_FORMAT_VERSION,
    nodes: {
      count: 3,
      ids: new Uint32Array([0, 1, 2]),
      coordinates: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    },
    elementShapeBlocks: [
      {
        shape: TRIANGLE_SHAPE,
        count: CONVERSION_BENCH_ELEMENT_COUNT,
        ids,
        connectivity,
      },
    ],
    sets: [],
    metadata: {},
    results: [],
  };
}

function makeFaceSubsetBenchmarkGeometry(): TriangleGeometry {
  const faceCount = 20_000;
  const faces = Array.from({ length: faceCount }, (_, index) => ({
    elementId: index + 1,
    faceIndex: 0,
    primitiveStart: index,
    primitiveCount: 1,
    key: String(index),
    nodeIds: [0, 1, 2],
  }));
  const faceIds = faces.map(({ elementId, faceIndex }) => ({ elementId, faceIndex }));
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: Uint32Array.from({ length: faceCount * 3 }, (_, index) => index % 3),
    primitive: "triangles",
    faces,
    faceSubset: { faceIds },
  };
}

function makeFaceSubsetBenchmarkPart(geometry: TriangleGeometry): Part {
  const { faceSubset: _faceSubset, ...geometryWithoutSubset } = geometry;
  const validated = createPart(908, { geometries: [geometryWithoutSubset] });
  return { ...validated, geometries: [geometry] };
}

/** Rebuilds the validated face-subset fixture for its construction budget. */
function makeValidatedFaceSubsetPart(): Part {
  const subset = faceSubsetBenchmarkGeometry.faceSubset;
  if (subset === undefined) throw new Error("Expected a face subset benchmark fixture");
  return createPart(909, {
    geometries: [
      {
        ...faceSubsetBenchmarkGeometry,
        faceSubset: { faceIds: [...subset.faceIds] },
      },
    ],
  });
}

export {
  CONVERSION_BENCH_ELEMENT_COUNT,
  conversionBenchmarkModel,
  faceSubsetBenchmarkGeometry,
  faceSubsetBenchmarkPart,
  heterogeneousModel,
  bodyGeometry,
  bodyModelWithBodies,
  lineHeavyGeometry,
  solidScalingModels,
  nodeCopyBenchmarkModel,
  makeValidatedFaceSubsetPart,
};
