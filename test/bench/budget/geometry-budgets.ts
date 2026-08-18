import { createPart } from "../../../src/entries/root";
import { createElementModelFromFemModel } from "../../../src/io/conversions/element-model";
import { elementPart } from "../../../src/entries/model";
import { buildMeshEdgeData } from "../../../src/renderer/edges/mesh-edge";
import { buildPrimitiveFaceBodyPickData } from "../../../src/renderer/picking/ids";
import { expandSurfaceGeometry } from "../../../src/renderer/resources/surface-geometry";
import { triangleUploadData } from "../../../src/renderer/resources/geometry-upload";
import { displayedPartBounds } from "../../../src/viewport/geometry-bounds";
import { buildFaceSubsetIndices } from "../../../src/renderer/selection/face-subset";
import { BENCH_BODY_COUNT, BENCH_BODY_ELEMENT_COUNT } from "../fixtures";
import type { BudgetCase, ScalingCase } from "./types";
import {
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
} from "./geometry-fixtures";

export const geometryBudgets: readonly BudgetCase[] = [
  {
    name: "createElementModelFromFemModel",
    description: `${CONVERSION_BENCH_ELEMENT_COUNT} Triangle3 elements from typed connectivity`,
    budgetMs: 100,
    run: () => {
      createElementModelFromFemModel(conversionBenchmarkModel);
    },
  },
  {
    name: "buildFaceSubsetIndices",
    description: "20,000 declared and selected triangle faces",
    budgetMs: 100,
    run: () => {
      buildFaceSubsetIndices(faceSubsetBenchmarkGeometry);
    },
  },
  {
    name: "displayedPartBounds (face subset)",
    description: "20,000 selected faces across 20,000 logical triangles",
    budgetMs: 100,
    run: () => {
      displayedPartBounds(faceSubsetBenchmarkPart, undefined);
    },
  },
  {
    name: "createPart (face subset)",
    description: "20,000 declared and selected triangle faces",
    budgetMs: 100,
    run: () => {
      makeValidatedFaceSubsetPart();
    },
  },
  {
    name: "elementPart",
    description: "600 mixed linear elements compiled into one semantic part",
    budgetMs: 500,
    run: () => {
      elementPart(901, heterogeneousModel);
    },
  },
  {
    name: "expand line geometry",
    description: `${lineHeavyGeometry.indices.length / 2} authored segments into reusable quads`,
    budgetMs: 100,
    run: () => {
      expandSurfaceGeometry(lineHeavyGeometry);
    },
  },
  {
    name: "triangle shared-source upload layout",
    description: "20,000 triangle corners retain source positions and corner connectivity",
    budgetMs: 100,
    run: () => {
      triangleUploadData(faceSubsetBenchmarkGeometry);
    },
  },
  {
    name: "createPart (body-heavy)",
    description: `${BENCH_BODY_ELEMENT_COUNT} elements across ${BENCH_BODY_COUNT} bodies`,
    budgetMs: 100,
    run: () => {
      createPart(904, {
        geometries: [bodyGeometry.geometry],
        elements: bodyGeometry.elements,
        nodePositions: bodyGeometry.nodePositions,
        ...(bodyGeometry.bodies === undefined ? {} : { bodies: bodyGeometry.bodies }),
      });
    },
  },
  {
    name: "buildPrimitiveFaceBodyPickData",
    description: `${BENCH_BODY_ELEMENT_COUNT} elements across ${BENCH_BODY_COUNT} bodies`,
    budgetMs: 25,
    run: () => {
      buildPrimitiveFaceBodyPickData(bodyGeometry.geometry, bodyGeometry.elements);
    },
  },
  {
    name: "buildMeshEdgeData (body-heavy)",
    description: `${BENCH_BODY_ELEMENT_COUNT} elements across ${BENCH_BODY_COUNT} bodies`,
    budgetMs: 600,
    run: () => {
      buildMeshEdgeData(
        bodyGeometry.geometry,
        bodyGeometry.geometry.indices,
        bodyGeometry.elements,
      );
    },
  },
  {
    name: "elementPart (body-heavy)",
    description: `${BENCH_BODY_ELEMENT_COUNT} FE quads across ${BENCH_BODY_COUNT} bodies`,
    budgetMs: 600,
    run: () => {
      elementPart(905, bodyModelWithBodies);
    },
  },
  {
    name: "elementPart (large node pool)",
    description: "500,000 nodes with one Tet4 element",
    budgetMs: 20,
    run: () => {
      elementPart(906, nodeCopyBenchmarkModel);
    },
  },
];

export const geometryScalingCases: readonly ScalingCase[] = [
  {
    name: "structured Hex8 part compilation",
    description: "tessellate 512–4,096 authored solid elements",
    points: solidScalingModels.map((model, index) => ({
      size: model.elements.length,
      run: () => {
        elementPart(10_000 + index, model);
      },
    })),
    maxNormalizedSpread: 3,
  },
];
