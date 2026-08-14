import { describe, expect, it } from "vitest";
import { createStructuredFeModel } from "../../demo/benchmark/structured-fe";
import { createElement, type Element } from "../../src/elements/element";
import { createElementModel } from "../../src/elements/model";
import { editElementModel } from "../../src/elements/model-edit";
import {
  HEX8_SHAPE,
  LINE_SHAPE,
  POINT_SHAPE,
  QUAD_SHAPE,
  TRIANGLE_SHAPE,
  TET4_SHAPE,
} from "../../src/elements/shapes";
import { elementPart } from "../../src/geometry/heterogeneous-element-mesh";
import { createPart, type Geometry } from "../../src/geometry/part";
import { translation } from "../../src/math/mat4";
import { resolvePick, type PickContext, type ResolvedPickIds } from "../../src/picking/pick";
import { createInteractionState } from "../../src/interaction/interaction";
import { selectedTargets } from "../../src/interaction/targets";
import { setTargetsSelected, type InteractionTarget } from "../../src/interaction/targets";
import { buildMeshEdgeData } from "../../src/renderer/gpu-edge";
import { createPickRegionTargetResolver } from "../../src/renderer/gpu-pick-region-resolve";
import { buildPrimitiveFaceBodyPickData } from "../../src/renderer/gpu-pick-ids";
import { expandSurfaceGeometry } from "../../src/renderer/gpu-surface-geometry";
import { collectEmphasisUpdates, encodeEmphasisRecord } from "../../src/renderer/gpu-elements";
import {
  buildHighlightTable,
  type HighlightTableEntry,
} from "../../src/renderer/gpu-highlight-table";
import { getPartSemanticIndex } from "../../src/geometry/part-semantic-index";
import { defaultStyle } from "../../src/renderer/gpu-support";
import { buildInstanceLayout } from "../../src/renderer/runtime-state";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { sceneWorldBounds } from "../../src/viewport/scene-bounds";
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
import { measureMs } from "./measure";

const shallowScene = makeScene({
  subcaseCount: BENCH_SUBCASE_COUNT,
  placementsPerSubcase: BENCH_PLACEMENTS_PER_SUBCASE,
  partCount: BENCH_PART_COUNT,
});

const deepScene = makeHierarchyScene({
  depth: BENCH_HIERARCHY_DEPTH,
  fanout: BENCH_HIERARCHY_FANOUT,
  partsPerLeaf: BENCH_HIERARCHY_PARTS_PER_LEAF,
  partCount: BENCH_PART_COUNT,
});

const runtime = createPackedSceneRuntime(shallowScene);
const runtimeInstances = Array.from(runtime.getDrawList(), (slot, index) => ({
  index,
  instanceId: runtime.getInstanceId(slot) ?? "",
  partId: runtime.getPartId(slot) ?? 0,
  worldTransform: runtime.getTransform(slot) ?? new Float32Array(16),
}));

const heterogeneousModel = makeHeterogeneousModel(100);
const bodyGeometry = makeBodyGeometry();
const boundsPart = createPart(906, bodyGeometry);
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
const bodyModel = createStructuredFeModel("quad", BENCH_BODY_GRID_CELLS);
const bodies = makeBodies(bodyModel.elements.length, BENCH_BODY_COUNT);
const bodyModelWithBodies = createElementModel([...bodyModel.nodes], bodyModel.elements, {
  bodies,
});
const emphasisPart = createPart(907, bodyGeometry);
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
const duplicateBulkSelectionTargets = [
  ...bulkSelectionTargets,
  ...bulkSelectionTargets.slice(0, 1_024),
];
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
    elements: Array.from({ length: elementCount }, (_, index) => ({
      id: index + 1,
      primitiveStart: index,
      primitiveCount: 1,
    })),
  };
  const part = createPart(5000 + elementCount, geometry);
  const context: PickContext = {
    instances: [
      {
        index: 0,
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

const EDIT_BLOCK_COUNT = 128;

function makeEditableModel() {
  const nodes: number[] = [];
  const elements: Element[] = [];
  const blocks: { readonly id: number; readonly elementIds: readonly number[] }[] = [];
  for (let blockId = 1; blockId <= EDIT_BLOCK_COUNT; blockId += 1) {
    const nodeStart = (blockId - 1) * 3;
    nodes.push(nodeStart, 0, 0, nodeStart + 1, 0, 0, nodeStart, 1, 0);
    elements.push(
      createElement(blockId, TRIANGLE_SHAPE, [nodeStart, nodeStart + 1, nodeStart + 2]),
    );
    blocks.push({ id: blockId, elementIds: [blockId] });
  }
  return createElementModel(nodes, elements, {
    blocks,
    bodies: [{ id: 1, blockIds: blocks.map(({ id }) => id) }],
  });
}

const editableModel = makeEditableModel();
const editReplacement = {
  elements: [
    editableModel.elements[0] as Element,
    createElement(EDIT_BLOCK_COUNT + 1, TRIANGLE_SHAPE, [
      EDIT_BLOCK_COUNT * 3,
      EDIT_BLOCK_COUNT * 3 + 1,
      EDIT_BLOCK_COUNT * 3 + 2,
    ]),
  ],
  nodes: [0, 2, 0, 1, 2, 0, 0, 3, 0],
};
const editReplacementForBlockFour = {
  elements: [
    editableModel.elements[3] as Element,
    createElement(EDIT_BLOCK_COUNT + 2, TRIANGLE_SHAPE, [
      EDIT_BLOCK_COUNT * 3,
      EDIT_BLOCK_COUNT * 3 + 1,
      EDIT_BLOCK_COUNT * 3 + 2,
    ]),
  ],
  nodes: editReplacement.nodes,
};

interface BudgetCase {
  readonly name: string;
  readonly description: string;
  readonly budgetMs: number;
  readonly run: () => void;
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
    name: "createPackedSceneRuntime",
    description: `packed compile, ${BENCH_INSTANCE_COUNT} instances`,
    budgetMs: 700,
    run: () => {
      createPackedSceneRuntime(shallowScene);
    },
  },
  {
    name: "createPackedSceneRuntime (deep hierarchy)",
    description: `nested transforms, ${BENCH_HIERARCHY_INSTANCE_COUNT} instances`,
    budgetMs: 700,
    run: () => {
      createPackedSceneRuntime(deepScene);
    },
  },
  {
    name: "editElementModel merge",
    description: `merge 64 blocks in a ${EDIT_BLOCK_COUNT}-block model`,
    budgetMs: 700,
    run: () => {
      editElementModel(editableModel, (edit) => {
        edit.mergeBlocks({
          sourceIds: Array.from({ length: 64 }, (_, index) => index + 2),
          targetId: 1,
        });
      });
    },
  },
  {
    name: "editElementModel remove",
    description: `remove one block from a ${EDIT_BLOCK_COUNT}-block model`,
    budgetMs: 500,
    run: () => {
      editElementModel(editableModel, (edit) => {
        edit.removeBlock(1);
      });
    },
  },
  {
    name: "editElementModel replace",
    description: "retain one element and append one element plus three nodes",
    budgetMs: 500,
    run: () => {
      editElementModel(editableModel, (edit) => {
        edit.replaceBlock(1, editReplacement);
      });
    },
  },
  {
    name: "editElementModel transaction",
    description: "merge, remove, and replace in one private draft",
    budgetMs: 700,
    run: () => {
      editElementModel(editableModel, (edit) => {
        edit.mergeBlocks({ sourceIds: [2], targetId: 1 });
        edit.removeBlock(3);
        edit.replaceBlock(4, editReplacementForBlockFour);
      });
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
  ...PHASE_SELECTION_COUNTS.flatMap((count) => {
    const targets = phaseSelectionTargets.get(count);
    const selected = phaseSelectionStates.get(count);
    if (targets === undefined || selected === undefined)
      throw new Error(`Missing ${count} targets`);
    return [
      {
        name: `setTargetsSelected replace (${count} targets)`,
        description: "duplicate-safe replacement across two occurrences",
        budgetMs: count <= 1_024 ? 20 : 100,
        run: () => {
          setTargetsSelected(createInteractionState(), targets, true);
        },
      },
      {
        name: `setTargetsSelected toggle (${count} targets)`,
        description: "duplicate-safe clear across two occurrences",
        budgetMs: count <= 1_024 ? 20 : 100,
        run: () => {
          setTargetsSelected(selected, targets, false);
        },
      },
      {
        name: `selectedTargets feedback (${count} targets)`,
        description: "count selected targets without DOM timing",
        budgetMs: count <= 1_024 ? 20 : 100,
        run: () => {
          expect(selectedTargets(selected)).toHaveLength(count);
        },
      },
    ];
  }),
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
    description: "one occurrence using cached part ownership metadata",
    budgetMs: 1_500,
    run: () => {
      collectEmphasisUpdates(
        emphasisRuntime,
        emphasisLayout,
        emphasisSlotByInstanceId,
        emphasisScene.parts,
        emphasisInteraction,
      );
    },
  },
  ...regionCases.flatMap(({ part, ids }, index) => {
    const count = index === 0 ? 16_384 : 100_000;
    const resolver = regionResolvers[index];
    if (resolver === undefined) throw new Error(`Missing region resolver for ${count} elements`);
    return [
      {
        name: `pickRegion cached metadata lookup (${count})`,
        description: `${count} immutable element identity lookups`,
        budgetMs: index === 0 ? 100 : 500,
        run: () => {
          getPartSemanticIndex(part);
        },
      },
      {
        name: `pickRegion target resolve (${count})`,
        description: `${count} indexed element identities`,
        budgetMs: index === 0 ? 100 : 700,
        run: () => {
          for (const pickIds of ids) resolver(pickIds);
        },
      },
    ];
  }),
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
      createPart(904, bodyGeometry);
    },
  },
  {
    name: "buildPrimitiveFaceBodyPickData",
    description: `${BENCH_BODY_ELEMENT_COUNT} elements across ${BENCH_BODY_COUNT} bodies`,
    budgetMs: 25,
    run: () => {
      buildPrimitiveFaceBodyPickData(bodyGeometry);
    },
  },
  {
    name: "buildMeshEdgeData (body-heavy)",
    description: `${BENCH_BODY_ELEMENT_COUNT} elements across ${BENCH_BODY_COUNT} bodies`,
    budgetMs: 600,
    run: () => {
      buildMeshEdgeData(bodyGeometry);
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
];

function report(name: string, description: string, measuredMs: number): void {
  if (process.env["PERF_REPORT"] === undefined) {
    return;
  }
  console.log(`${name.padEnd(38)} ${description.padEnd(46)} ${measuredMs.toFixed(3)} ms`);
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

  it("toggles visibility on a part with a known instance count", () => {
    const delta = runtime.setPartVisible(1, false);
    expect(delta.changedInstanceIds).toHaveLength(
      (BENCH_PLACEMENTS_PER_SUBCASE / BENCH_PART_COUNT) * BENCH_SUBCASE_COUNT,
    );
    runtime.setPartVisible(1, true);
    expect(runtime.visibleCount).toBe(BENCH_INSTANCE_COUNT);
  });
});
