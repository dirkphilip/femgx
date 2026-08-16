import { describe, expect, it } from "vitest";
import { createStructuredFeModel } from "../../demo/benchmark/structured-fe";
import { createElement, type Element } from "../../src/elements/element";
import { createElementModel } from "../../src/elements/model";
import { createElementModelFromFemModel } from "../../src/io/conversions/element-model";
import { FEMGX_FORMAT_VERSION, type FemModel } from "../../src/io/fem-model";
import {
  HEX8_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  QUAD_SHAPE,
  TRIANGLE_SHAPE,
  TET4_SHAPE,
} from "../../src/elements/shapes";
import { elementPart } from "../../src/entries/model";
import {
  createInteractionState,
  createPart,
  createScene,
  selectedTargets,
  setTargetsHighlighted,
  setTargetsSelected,
  translation,
  type Geometry,
  type InteractionTarget,
  type Part,
  type TriangleGeometry,
} from "../../src/entries/root";
import { resolvePick, type PickContext, type ResolvedPickIds } from "../../src/picking/pick";
import { buildMeshEdgeData } from "../../src/renderer/edges/mesh-edge";
import { createPickRegionTargetResolver } from "../../src/renderer/picking/region-resolver";
import { buildPrimitiveFaceBodyPickData } from "../../src/renderer/picking/ids";
import { expandSurfaceGeometry } from "../../src/renderer/resources/surface-geometry";
import {
  collectEmphasisUpdates,
  encodeEmphasisRecord,
} from "../../src/renderer/resources/element-resources";
import {
  buildHighlightTable,
  type HighlightTableEntry,
} from "../../src/renderer/selection/highlight-table";
import { collectDenseElementSelections } from "../../src/renderer/selection/element-selection";
import { getPartSemanticIndex } from "../../src/geometry/part-semantic-index";
import { defaultStyle } from "../../src/renderer/resources/foundation";
import { buildInstanceLayout } from "../../src/renderer/runtime-state";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { createSceneRuntime } from "../../src/entries/runtime";
import { SceneNavigationBoundsCache, sceneWorldBounds } from "../../src/viewport/scene-bounds";
import { displayedPartBounds } from "../../src/viewport/geometry-bounds";
import { buildFaceSubsetIndices } from "../../src/renderer/selection/face-subset";
import {
  BENCH_BODY_COUNT,
  BENCH_BODY_ELEMENT_COUNT,
  BENCH_BODY_GRID_CELLS,
  BENCH_HIERARCHY_DEPTH,
  BENCH_HIERARCHY_FANOUT,
  BENCH_HIERARCHY_INSTANCE_COUNT,
  BENCH_HIERARCHY_PARTS_PER_LEAF,
  BENCH_INSTANCE_COUNT,
  BENCH_PART_COUNT,
  BENCH_PLACEMENTS_PER_SUBCASE,
  BENCH_SUBCASE_COUNT,
  makeHierarchyScene,
  makeBodyGeometry,
  makeBodies,
  makeScene,
} from "./fixtures";
import { measureMs, measureScaling, type ScalingPoint } from "./measure";

const RUNTIME_SCALING_PLACEMENTS = [50_000, 100_000, BENCH_INSTANCE_COUNT] as const;
const runtimeScalingScenes = RUNTIME_SCALING_PLACEMENTS.map((placementCount) =>
  makeScene({
    subcaseCount: BENCH_SUBCASE_COUNT,
    placementsPerSubcase: placementCount / BENCH_SUBCASE_COUNT,
    partCount: BENCH_PART_COUNT,
  }),
);
const shallowScene = runtimeScalingScenes.at(-1);
if (shallowScene === undefined) throw new Error("Runtime scaling scenes are missing");

const deepScene = makeHierarchyScene({
  depth: BENCH_HIERARCHY_DEPTH,
  fanout: BENCH_HIERARCHY_FANOUT,
  partsPerLeaf: BENCH_HIERARCHY_PARTS_PER_LEAF,
  partCount: BENCH_PART_COUNT,
});

const CONVERSION_BENCH_ELEMENT_COUNT = 250_000;
const conversionBenchmarkModel = makeConversionBenchmarkModel();
const faceSubsetBenchmarkGeometry = makeFaceSubsetBenchmarkGeometry();
const faceSubsetBenchmarkPart = makeFaceSubsetBenchmarkPart(faceSubsetBenchmarkGeometry);

const runtime = createPackedSceneRuntime(shallowScene);
const runtimeInstances = Array.from(runtime.getDrawList(), (slot, index) => ({
  index,
  instanceId: runtime.getInstanceId(slot) ?? "",
  partId: runtime.getPartId(slot) ?? 0,
  worldTransform: runtime.getTransform(slot) ?? new Float32Array(16),
}));

const heterogeneousModel = makeHeterogeneousModel(100);
const bodyGeometry = makeBodyGeometry();
const boundsPart = createPart(906, {
  geometries: [bodyGeometry.geometry],
  elements: bodyGeometry.elements,
  nodePositions: bodyGeometry.nodePositions,
  ...(bodyGeometry.bodies === undefined ? {} : { bodies: bodyGeometry.bodies }),
});
const boundsScene = {
  rootAssemblyId: 1,
  parts: new Map([[boundsPart.id, boundsPart]]),
  assemblies: new Map([
    [
      1,
      {
        id: 1,
        placements: Array.from({ length: 64 }, (_, index) => ({
          kind: "part" as const,
          partId: boundsPart.id,
          transform: translation(index, 0, 0),
        })),
      },
    ],
  ]),
  visiblePartIds: new Set([boundsPart.id]),
  visibleAssemblyIds: new Set([1]),
};
const boundsRuntime = createPackedSceneRuntime(boundsScene);
const navigationBoundsCache = new SceneNavigationBoundsCache();
navigationBoundsCache.get(boundsScene, boundsRuntime);
const bodyModel = createStructuredFeModel("quad", BENCH_BODY_GRID_CELLS);
const bodies = makeBodies(bodyModel.elements.length, BENCH_BODY_COUNT);
const bodyModelWithBodies = createElementModel([...bodyModel.nodes], bodyModel.elements, {
  bodies,
});
const emphasisPart = createPart(907, {
  geometries: [bodyGeometry.geometry],
  elements: bodyGeometry.elements,
  nodePositions: bodyGeometry.nodePositions,
  ...(bodyGeometry.bodies === undefined ? {} : { bodies: bodyGeometry.bodies }),
});
getPartSemanticIndex(emphasisPart);
const emphasisScene = {
  rootAssemblyId: 1,
  parts: new Map([[emphasisPart.id, emphasisPart]]),
  assemblies: new Map([
    [
      1,
      {
        id: 1,
        placements: [
          { kind: "part" as const, partId: emphasisPart.id, transform: translation(0, 0, 0) },
        ],
      },
    ],
  ]),
  visiblePartIds: new Set([emphasisPart.id]),
  visibleAssemblyIds: new Set([1]),
};
const emphasisRuntime = createPackedSceneRuntime(emphasisScene);
const emphasisLayout = buildInstanceLayout(emphasisRuntime);
const emphasisInstanceId = emphasisRuntime.getInstanceId(0);
if (emphasisInstanceId === undefined) throw new Error("Missing emphasis benchmark instance");
const emphasisSlotByInstanceId = new Map([[emphasisInstanceId, 0]]);
const emphasisElementIds = Array.from(
  { length: BENCH_BODY_ELEMENT_COUNT },
  (_, index) => index + 1,
);
const emphasisInteraction = setTargetsSelected(
  createInteractionState(),
  emphasisElementIds.map((elementId) => ({
    kind: "element" as const,
    instanceId: emphasisInstanceId,
    elementId,
  })),
  true,
);
const emphasisDenseSelections = collectDenseElementSelections(
  emphasisRuntime,
  emphasisLayout,
  emphasisScene.parts,
  emphasisInteraction,
);
const LINE_BENCH_SEGMENTS = 10_000;
const lineHeavyGeometry = {
  positions: Float32Array.from({ length: (LINE_BENCH_SEGMENTS + 1) * 3 }, (_, index) => index % 3),
  indices: Uint32Array.from(
    { length: LINE_BENCH_SEGMENTS * 2 },
    (_, index) => Math.floor(index / 2) + (index % 2),
  ),
  primitive: "lines" as const,
};

const PICK_COUNT = 50_000;
const pickIds: number[] = [];
for (let i = 0; i < PICK_COUNT; i++) {
  pickIds.push(i % runtimeInstances.length);
}

const BULK_SELECTION_COUNT = 16_384;
const bulkSelectionTargets: InteractionTarget[] = Array.from(
  { length: BULK_SELECTION_COUNT },
  (_, index) => ({ kind: "element", instanceId: "bench/0", elementId: index + 1 }),
);
const TET4_SELECTION_COUNT = 131_712;
const tet4SelectionTargets = makeSelectionTargets(TET4_SELECTION_COUNT, 1);
const duplicateBulkSelectionTargets = [
  ...bulkSelectionTargets,
  ...bulkSelectionTargets.slice(0, 1_024),
];
const bulkHighlightTargets = bulkSelectionTargets.slice(0, 8_192);
const PHASE_SELECTION_COUNTS = [1, 1_024, 4_096, 16_384] as const;
const phaseSelectionTargets = new Map(
  PHASE_SELECTION_COUNTS.map((count) => [count, makeSelectionTargets(count, 2)]),
);
const phaseSelectionStates = new Map(
  PHASE_SELECTION_COUNTS.map((count) => {
    const targets = phaseSelectionTargets.get(count) ?? [];
    return [count, setTargetsSelected(createInteractionState(), targets, true)] as const;
  }),
);
const SCENE_BUILDER_PART_COUNT = 4_096;
const sceneBuilderParts: readonly Part[] = Array.from(
  { length: SCENE_BUILDER_PART_COUNT },
  (_, index) =>
    createPart(index + 1, {
      geometries: [
        {
          positions: new Float32Array([0, 0, 0]),
          indices: new Uint32Array(),
          primitive: "points",
        },
      ],
    }),
);
const emphasisTableEntries: HighlightTableEntry[] = Array.from(
  { length: BULK_SELECTION_COUNT },
  (_, index) => {
    const update = {
      slot: index % 64,
      elementPickId: index + 1,
      facePickId: 0,
      nodePickId: 0,
      style: defaultStyle,
    };
    return {
      slot: update.slot,
      elementPickId: update.elementPickId,
      facePickId: 0,
      nodePickId: 0,
      data: encodeEmphasisRecord(update),
    };
  },
);

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

function makeSelectionTargets(count: number, occurrenceCount: number): InteractionTarget[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "element" as const,
    instanceId: `bench/${index % occurrenceCount}`,
    elementId: index + 1,
  }));
}

function makeRegionCase(elementCount: number) {
  const geometry: Geometry = {
    positions: new Float32Array(elementCount * 3),
    indices: Uint32Array.from({ length: elementCount }, (_, index) => index),
    primitive: "points",
  };
  const elements = Array.from({ length: elementCount }, (_, index) => ({
    id: index + 1,
    primitiveRanges: [{ primitive: "points" as const, primitiveStart: index, primitiveCount: 1 }],
  }));
  const part = createPart(5000 + elementCount, { geometries: [geometry], elements });
  const context: PickContext = {
    instances: [
      {
        instanceId: "benchmark/0",
        partId: part.id,
        worldTransform: new Float32Array(16),
      },
    ],
    parts: new Map([[part.id, part]]),
  };
  const ids: ResolvedPickIds[] = Array.from({ length: elementCount }, (_, index) => ({
    instancePickId: 1,
    elementPickId: index + 1,
    facePickId: 0,
    nodePickId: 0,
  }));
  return { part, context, ids };
}

const regionCases = [makeRegionCase(16_384), makeRegionCase(100_000)] as const;
const regionResolvers = regionCases.map(({ context }) =>
  createPickRegionTargetResolver(context, "element"),
);

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

interface BudgetCase {
  readonly name: string;
  readonly description: string;
  readonly budgetMs: number;
  readonly run: () => void;
}

interface ScalingCase {
  readonly name: string;
  readonly description: string;
  readonly points: readonly ScalingPoint[];
  /** Maximum tolerated spread between the cheapest and costliest normalized points. */
  readonly maxNormalizedSpread: number;
  readonly iterations?: number;
}

/**
 * Wall-clock ceilings for representative CPU workloads. Budgets are roughly
 * 10x the measured medians on a developer laptop (see `wiki/engineering/benchmarks.md`),
 * so they absorb CI noise and only trip on order-of-magnitude or asymptotic
 * regressions — e.g. a visibility update that starts scanning the whole model
 * instead of a single part. Recalibrate with
 * `PERF_REPORT=1 npx vitest run test/bench/budget.test.ts`.
 */
const budgets: readonly BudgetCase[] = [
  {
    name: "createPackedSceneRuntime (deep hierarchy)",
    description: `nested transforms, ${BENCH_HIERARCHY_INSTANCE_COUNT} instances`,
    budgetMs: 700,
    run: () => {
      createPackedSceneRuntime(deepScene);
    },
  },
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
    name: "setPartVisible toggle",
    description: "part with 1000 instances, hide then show",
    budgetMs: 10,
    run: () => {
      runtime.setPartVisible(1, false);
      runtime.setPartVisible(1, true);
    },
  },
  {
    name: "setAssemblyVisible toggle",
    description: "subcase subtree with 2000 instances, hide then show",
    budgetMs: 10,
    run: () => {
      runtime.setAssemblyVisible(2, false);
      runtime.setAssemblyVisible(2, true);
    },
  },
  {
    name: "setInstanceVisible toggle",
    description: "single instance override, hide then show",
    budgetMs: 10,
    run: () => {
      runtime.setInstanceVisible(0, false);
      runtime.setInstanceVisible(0, true);
    },
  },
  {
    name: "getDrawList",
    description: `${BENCH_INSTANCE_COUNT} visible instances`,
    budgetMs: 20,
    run: () => {
      runtime.getDrawList();
    },
  },
  {
    name: "sceneWorldBounds",
    description: "32,768 triangles reused across 64 placements",
    budgetMs: 100,
    run: () => {
      sceneWorldBounds(boundsScene, boundsRuntime);
    },
  },
  {
    name: "cached navigation bounds",
    description: "1,000 zoom-time reads of 32,768 triangles across 64 placements",
    budgetMs: 2,
    run: () => {
      for (let index = 0; index < 1_000; index += 1) {
        navigationBoundsCache.get(boundsScene, boundsRuntime);
      }
    },
  },
  {
    name: "resolvePick",
    description: `${PICK_COUNT} lookups on ${BENCH_INSTANCE_COUNT} instances`,
    budgetMs: 50,
    run: () => {
      for (const pickId of pickIds) {
        resolvePick(runtimeInstances, pickId);
      }
    },
  },
  {
    name: "setTargetsSelected (16,384 elements)",
    description: "one immutable bulk transition in one occurrence",
    budgetMs: 100,
    run: () => {
      setTargetsSelected(createInteractionState(), bulkSelectionTargets, true);
    },
  },
  {
    name: "setTargetsSelected duplicate inputs (16,384 elements)",
    description: "one bulk transition with 1,024 repeated identities",
    budgetMs: 100,
    run: () => {
      setTargetsSelected(createInteractionState(), duplicateBulkSelectionTargets, true);
    },
  },
  {
    name: "setTargetsSelected (131,712 Tet4 elements)",
    description: "one immutable bulk transition for the bounded Tet4 selection result",
    budgetMs: 35,
    run: () => {
      setTargetsSelected(createInteractionState(), tet4SelectionTargets, true);
    },
  },
  {
    name: "setTargetsHighlighted (8,192 elements)",
    description: "one duplicate-safe immutable bulk transition in one occurrence",
    budgetMs: 100,
    run: () => {
      setTargetsHighlighted(createInteractionState(), bulkHighlightTargets, true);
    },
  },
  {
    name: "buildHighlightTable (16,384 records)",
    description: "bounded four-entry buckets for repeated placements",
    budgetMs: 1_500,
    run: () => {
      buildHighlightTable(emphasisTableEntries);
    },
  },
  {
    name: "encodeEmphasisRecord mirror (16,384 records)",
    description: "CPU mirror preparation for selected element records",
    budgetMs: 100,
    run: () => {
      for (const entry of emphasisTableEntries) {
        encodeEmphasisRecord({
          slot: entry.slot,
          elementPickId: entry.elementPickId,
          facePickId: entry.facePickId,
          nodePickId: entry.nodePickId,
          style: defaultStyle,
        });
      }
    },
  },
  {
    name: "immutable part ownership lookup (16,384 elements)",
    description: "cached element-to-body metadata map reads",
    budgetMs: 100,
    run: () => {
      const metadata = getPartSemanticIndex(emphasisPart);
      for (const elementId of emphasisElementIds) metadata.bodyByElement.get(elementId);
    },
  },
  {
    name: "collectEmphasisUpdates (16,384 elements)",
    description: "dense selection avoids per-element sparse records",
    budgetMs: 25,
    run: () => {
      collectEmphasisUpdates(emphasisRuntime, emphasisLayout, emphasisSlotByInstanceId, {
        parts: emphasisScene.parts,
        interaction: emphasisInteraction,
        denseSelections: emphasisDenseSelections,
      });
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
    description: `${LINE_BENCH_SEGMENTS} authored segments into reusable quads`,
    budgetMs: 100,
    run: () => {
      expandSurfaceGeometry(lineHeavyGeometry);
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
    description: `${NODE_COPY_BENCH_NODE_COUNT} nodes with one Tet4 element`,
    budgetMs: 20,
    run: () => {
      elementPart(906, nodeCopyBenchmarkModel);
    },
  },
];

const scalingCases: readonly ScalingCase[] = [
  {
    name: "public scene runtime rebuild",
    description: "compile 50k–200k placements through createSceneRuntime",
    points: runtimeScalingScenes.map((scene, index) => ({
      size: RUNTIME_SCALING_PLACEMENTS[index] ?? 0,
      run: () => {
        createSceneRuntime(scene);
      },
    })),
    maxNormalizedSpread: 3,
  },
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
  {
    name: "many-part scene build",
    description: "register, place, snapshot, and compile 1,024–4,096 reusable parts",
    points: [1_024, 2_048, SCENE_BUILDER_PART_COUNT].map((size) => ({
      size,
      run: () => {
        const parts = sceneBuilderParts.slice(0, size);
        let builder = createScene();
        for (const part of parts) builder = builder.addPart(part);
        const scene = builder
          .addAssembly({
            id: 1,
            name: "root",
            placements: parts.map((part) => ({
              kind: "part" as const,
              partId: part.id,
              transform: translation(part.id, 0, 0),
            })),
          })
          .withRoot(1)
          .build();
        createSceneRuntime(scene);
      },
    })),
    maxNormalizedSpread: 3,
  },
  {
    name: "element interaction updates",
    description: "select, enumerate, and clear 1,024–16,384 targets",
    points: PHASE_SELECTION_COUNTS.slice(1).map((count) => {
      const targets = phaseSelectionTargets.get(count);
      const selected = phaseSelectionStates.get(count);
      if (targets === undefined || selected === undefined)
        throw new Error(`Missing ${count} targets`);
      return {
        size: count,
        run: () => {
          setTargetsSelected(createInteractionState(), targets, true);
          selectedTargets(selected);
          setTargetsSelected(selected, targets, false);
        },
      };
    }),
    maxNormalizedSpread: 3,
    iterations: 2,
  },
  {
    name: "pick-region target resolution",
    description: "resolve 16,384–100,000 element identities",
    points: regionCases.map(({ ids }, index) => {
      const resolver = regionResolvers[index];
      if (resolver === undefined) throw new Error("Region scaling resolver is missing");
      return {
        size: ids.length,
        run: () => {
          for (const pickIds of ids) resolver(pickIds);
        },
      };
    }),
    maxNormalizedSpread: 3,
    iterations: 4,
  },
];

function report(name: string, description: string, measuredMs: number): void {
  if (process.env["PERF_REPORT"] === undefined) {
    return;
  }
  console.log(`${name.padEnd(38)} ${description.padEnd(46)} ${measuredMs.toFixed(3)} ms`);
}

function reportScaling(name: string, measurements: ReturnType<typeof measureScaling>): void {
  if (process.env["PERF_REPORT"] === undefined) return;
  console.log(
    `${name}: ${measurements
      .map(({ size, measuredMs }) => `${size}=${measuredMs.toFixed(3)} ms`)
      .join(", ")}`,
  );
}

describe("performance budgets", () => {
  it.each(budgets)("$name stays under its budget", (budget) => {
    const measured = measureMs(budget.run);
    report(budget.name, budget.description, measured);
    expect(
      measured,
      `${budget.name} (${budget.description}) took ${measured.toFixed(2)} ms, above its ` +
        `${budget.budgetMs} ms budget; see wiki/engineering/benchmarks.md`,
    ).toBeLessThanOrEqual(budget.budgetMs);
  });

  it.each(scalingCases)("$name remains approximately linear", (scaling) => {
    const measurements = measureScaling(scaling.points, {
      warmup: 1,
      samples: 3,
      ...(scaling.iterations === undefined ? {} : { iterations: scaling.iterations }),
    });
    reportScaling(scaling.name, measurements);
    const normalized = measurements.map(({ millisecondsPerUnit }) => millisecondsPerUnit);
    const spread = Math.max(...normalized) / Math.min(...normalized);
    expect(
      spread,
      `${scaling.name} (${scaling.description}) normalized cost spread was ` +
        `${spread.toFixed(2)}x across ` +
        `${measurements.map(({ size }) => size).join(" → ")}; expected at most ` +
        `${scaling.maxNormalizedSpread}x, see wiki/engineering/benchmarks.md`,
    ).toBeLessThanOrEqual(scaling.maxNormalizedSpread);
  });

  it("toggles visibility on a part with a known instance count", () => {
    const delta = runtime.setPartVisible(1, false);
    expect(delta.changedInstanceIds).toHaveLength(
      (BENCH_PLACEMENTS_PER_SUBCASE / BENCH_PART_COUNT) * BENCH_SUBCASE_COUNT,
    );
    runtime.setPartVisible(1, true);
    expect(runtime.visibleCount).toBe(BENCH_INSTANCE_COUNT);
  });
});
