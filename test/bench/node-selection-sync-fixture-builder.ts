import { benchmarkCaseSpecs, createBenchmarkCase } from "../../demo/benchmark/model";
import type { Part } from "../../src/geometry/part";
import { createInteractionState } from "../../src/interaction/interaction";
import { setTargetsSelected } from "../../src/interaction/targets";
import { createPackedSceneRuntime } from "../../src/scene-runtime/runtime";
import { buildInstanceLayout } from "../../src/renderer/runtime-state";
import { collectEmphasisUpdates } from "../../src/renderer/resources/element-resources";
import { collectDenseNodeSelections } from "../../src/renderer/selection/node-selection";
import type { NodeCase, NodeSelectionFixture } from "./node-selection-sync-operation";
import {
  assertNodeSelection,
  CASES,
  ELEMENT_COUNT,
  HALF_NODE_COUNT,
  NODE_COUNT,
  PART_ID,
  runtimeInstanceIds,
  slotMap,
} from "./node-selection-sync-shared";

interface Tet4Setup {
  readonly part: Part;
  readonly parts: ReadonlyMap<number, Part>;
  readonly runtime: ReturnType<typeof createPackedSceneRuntime>;
  readonly layout: ReturnType<typeof buildInstanceLayout>;
  readonly partOccurrenceIds: readonly string[];
  readonly nodeCount: number;
  readonly elementCount: number;
}

/** Builds the fixed Tet4 scene and its small, half, and all-node cases. */
export function createNodeSelectionFixture(): NodeSelectionFixture {
  const setup = createTet4Setup();
  return {
    ...setup,
    slotByInstanceId: slotMap(setup.runtime),
    authoredFaceCount: authoredFaceCount(setup.part),
    boundaryFaceCount: boundaryFaceCount(setup.part),
    nodePositionsBytes: setup.part.nodePositions?.byteLength ?? 0,
    nodePickIdsBytes: nodePickIdsBytes(setup.part),
    cases: buildCases(setup),
  };
}

function createTet4Setup(): Tet4Setup {
  const spec = benchmarkCaseSpecs(false).find((candidate) => candidate.id === "fe-tet4-solid-132k");
  if (spec === undefined) throw new Error("Tet4 benchmark specification is missing");
  const benchmark = createBenchmarkCase(spec);
  const part = benchmark.scene.parts.get(PART_ID);
  if (part === undefined) throw new Error("Tet4 benchmark part is missing");
  const runtime = createPackedSceneRuntime(benchmark.scene);
  const layout = buildInstanceLayout(runtime);
  const partOccurrenceIds = runtimeInstanceIds(runtime);
  const nodeCount = (part.nodePositions?.length ?? 0) / 3;
  const elementCount = part.elements?.count ?? 0;
  if (nodeCount !== NODE_COUNT) throw new Error(`Tet4 node count changed: ${nodeCount}`);
  if (elementCount !== ELEMENT_COUNT)
    throw new Error(`Tet4 element count changed: ${elementCount}`);
  if (partOccurrenceIds[0] === undefined) throw new Error("Tet4 benchmark instance is missing");
  return {
    part,
    parts: benchmark.scene.parts,
    runtime,
    layout,
    partOccurrenceIds,
    nodeCount,
    elementCount,
  };
}

function buildCases(setup: Tet4Setup): ReadonlyMap<NodeCase["id"], NodeCase> {
  const cases = new Map<NodeCase["id"], NodeCase>();
  for (const id of CASES) cases.set(id, buildCase(setup, id, nodeIdsForCase(setup.nodeCount, id)));
  return cases;
}

function nodeIdsForCase(nodeCount: number, id: NodeCase["id"]): readonly number[] {
  if (id === "one") return [17];
  if (id === "all") return sequentialNodeIds(nodeCount);
  if (id === "half") return sequentialNodeIds(HALF_NODE_COUNT);
  const sparseCount = Math.floor(nodeCount / 16);
  if (id === "contiguous") return sequentialNodeIds(sparseCount, 37);
  if (id === "fragmented") {
    return Array.from({ length: sparseCount }, (_, index) => index * 16);
  }
  const denseBoundary = Math.ceil((nodeCount * 7) / 8);
  return sequentialNodeIds(id === "near-all" ? denseBoundary - 1 : denseBoundary);
}

function sequentialNodeIds(count: number, start = 0): readonly number[] {
  return Array.from({ length: count }, (_, index) => start + index);
}

function buildCase(setup: Tet4Setup, id: NodeCase["id"], nodeIds: readonly number[]): NodeCase {
  const partOccurrenceId = setup.partOccurrenceIds[0];
  if (partOccurrenceId === undefined) throw new Error("Tet4 benchmark instance is missing");
  const targets = nodeIds.map((nodeId) => ({ kind: "node" as const, partOccurrenceId, nodeId }));
  const interaction = setTargetsSelected(createInteractionState(), targets, true);
  const denseNodeSelections = collectDenseNodeSelections(
    setup.runtime,
    setup.layout,
    setup.parts,
    interaction,
  );
  const emphasisUpdates = collectEmphasisUpdates(
    setup.runtime,
    setup.layout,
    slotMap(setup.runtime),
    {
      parts: setup.parts,
      interaction,
      denseSelections: new Map(),
      denseNodeSelections,
    },
  );
  assertNodeSelection(interaction, partOccurrenceId, nodeIds.length);
  return {
    id,
    interaction,
    targets,
    selectedNodeCount: nodeIds.length,
    denseNodeSelections,
    emphasisUpdates,
  };
}

function authoredFaceCount(part: Part): number {
  const triangles = part.geometries.find((geometry) => geometry.primitive === "triangles");
  return triangles?.primitive === "triangles" ? (triangles.faces?.count ?? 0) : 0;
}

function boundaryFaceCount(part: Part): number {
  const triangles = part.geometries.find((geometry) => geometry.primitive === "triangles");
  return triangles?.primitive === "triangles" ? (triangles.faceSubset?.count ?? 0) : 0;
}

function nodePickIdsBytes(part: Part): number {
  const triangles = part.geometries.find((geometry) => geometry.primitive === "triangles");
  return triangles?.primitive === "triangles" ? (triangles.nodePickIds?.byteLength ?? 0) : 0;
}
