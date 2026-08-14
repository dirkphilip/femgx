import type { ElementModel } from "./model";
import type { ElementModelEditReport } from "./model-edit-types";

/** Computes semantic identity deltas between the committed model versions. */
export function createReport(before: ElementModel, after: ElementModel): ElementModelEditReport {
  const beforeElements = new Set(before.elements.map((element) => element.id));
  const afterElements = new Set(after.elements.map((element) => element.id));
  const beforeBlocks = new Set((before.blocks ?? []).map((block) => block.id));
  const afterBlocks = new Set((after.blocks ?? []).map((block) => block.id));
  const beforeBodies = new Set((before.bodies ?? []).map((body) => body.id));
  const afterBodies = new Set((after.bodies ?? []).map((body) => body.id));
  const beforeUsedNodes = usedNodes(before);
  const afterUsedNodes = usedNodes(after);
  return {
    addedNodeIds: difference(
      [...Array(after.nodes.length / 3).keys()],
      [...Array(before.nodes.length / 3).keys()],
    ),
    unusedNodeIds: [...beforeUsedNodes]
      .filter((id) => !afterUsedNodes.has(id))
      .sort((a, b) => a - b),
    addedElementIds: difference([...afterElements], [...beforeElements]),
    removedElementIds: difference([...beforeElements], [...afterElements]),
    retainedElementIds: intersection(beforeElements, afterElements),
    addedBlockIds: difference([...afterBlocks], [...beforeBlocks]),
    removedBlockIds: difference([...beforeBlocks], [...afterBlocks]),
    retainedBlockIds: intersection(beforeBlocks, afterBlocks),
    addedBodyIds: difference([...afterBodies], [...beforeBodies]),
    removedBodyIds: difference([...beforeBodies], [...afterBodies]),
    retainedBodyIds: intersection(beforeBodies, afterBodies),
  };
}

/** Creates the report for a verified no-op transaction. */
export function emptyReport(): ElementModelEditReport {
  return {
    addedNodeIds: [],
    unusedNodeIds: [],
    addedElementIds: [],
    removedElementIds: [],
    retainedElementIds: [],
    addedBlockIds: [],
    removedBlockIds: [],
    retainedBlockIds: [],
    addedBodyIds: [],
    removedBodyIds: [],
    retainedBodyIds: [],
  };
}

function usedNodes(model: ElementModel): ReadonlySet<number> {
  const used = new Set<number>();
  for (const element of model.elements) {
    for (const nodeId of element.nodeIds) used.add(nodeId);
  }
  return used;
}

function difference<T extends number>(values: readonly T[], excluded: readonly T[]): T[] {
  const excludedSet = new Set(excluded);
  return values.filter((value) => !excludedSet.has(value)).sort((a, b) => a - b);
}

function intersection<T extends number>(first: ReadonlySet<T>, second: ReadonlySet<T>): T[] {
  return [...first].filter((value) => second.has(value)).sort((a, b) => a - b);
}
