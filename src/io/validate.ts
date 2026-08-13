import { topologyFor } from "../elements/shapes";
import type { Issue } from "./diagnostics";
import type { ElementId, NodeId } from "../elements/element";
import type { FemModel, ModelElementShapeBlock, ModelSet, ModelResultField } from "./model";

/**
 * Validates an interchange model and returns typed diagnostics. Checks cover
 * node/element id uniqueness, connectivity against the node table, set
 * references, and result field shapes. Issues are reported, never thrown.
 */
export function validateModel(model: FemModel): readonly Issue[] {
  const issues: Issue[] = [];
  const nodeIds = new Set<NodeId>();
  const elementIds = new Set<ElementId>();
  validateNodes(model, nodeIds, issues);
  for (const block of model.elementShapeBlocks) {
    validateBlock(block, nodeIds, elementIds, issues);
  }
  for (const set of model.sets) {
    validateSet(set, nodeIds, elementIds, issues);
  }
  for (const result of model.results) {
    validateResult(result, nodeIds, elementIds, issues);
  }
  return issues;
}

function validateNodes(model: FemModel, nodeIds: Set<NodeId>, issues: Issue[]): void {
  if (model.nodes.ids.length !== model.nodes.count) {
    issues.push({
      code: "node-table-shape",
      severity: "error",
      message: `Node table holds ${model.nodes.ids.length} ids for ${model.nodes.count} nodes`,
    });
  }
  for (const id of model.nodes.ids) {
    if (nodeIds.has(id)) {
      issues.push({
        code: "duplicate-node-id",
        severity: "error",
        message: `Duplicate node id ${id}`,
      });
    }
    nodeIds.add(id);
  }
  if (model.nodes.coordinates.length !== model.nodes.count * 3) {
    issues.push({
      code: "node-table-shape",
      severity: "error",
      message:
        `Node coordinates hold ${model.nodes.coordinates.length} values for ` +
        `${model.nodes.count} nodes`,
    });
  }
}

function validateBlock(
  block: ModelElementShapeBlock,
  nodeIds: Set<NodeId>,
  elementIds: Set<ElementId>,
  issues: Issue[],
): void {
  const nodeCount = topologyFor(block.shape).nodeCount;
  if (block.ids.length !== block.count) {
    issues.push({
      code: "element-block-shape",
      severity: "error",
      message:
        `Element shape block ${block.shape.family} order ${block.shape.order} holds ` +
        `${block.ids.length} ids for ${block.count} elements`,
    });
    return;
  }
  if (block.connectivity.length !== block.count * nodeCount) {
    issues.push({
      code: "element-block-shape",
      severity: "error",
      message:
        `Element shape block ${block.shape.family} order ${block.shape.order} holds ` +
        `${block.connectivity.length} connectivity values for ${block.count} elements`,
    });
    return;
  }
  for (let element = 0; element < block.count; element++) {
    const id = block.ids[element] ?? 0;
    if (elementIds.has(id)) {
      issues.push({
        code: "duplicate-element-id",
        severity: "error",
        message: `Duplicate element id ${id}`,
      });
    }
    elementIds.add(id);
    for (let node = 0; node < nodeCount; node++) {
      const nodeId = block.connectivity[element * nodeCount + node] ?? 0;
      if (!nodeIds.has(nodeId)) {
        issues.push({
          code: "missing-node",
          severity: "error",
          message: `Element ${id} references unknown node ${nodeId}`,
        });
      }
    }
  }
}

function validateSet(
  set: ModelSet,
  nodeIds: Set<NodeId>,
  elementIds: Set<ElementId>,
  issues: Issue[],
): void {
  if (set.name.length === 0) {
    issues.push({ code: "empty-set-name", severity: "error", message: "A set has an empty name" });
  }
  const known = set.kind === "node" ? nodeIds : elementIds;
  for (const id of set.ids) {
    if (!known.has(id)) {
      issues.push({
        code: "missing-set-id",
        severity: "error",
        message: `${set.kind} set ${set.name} references unknown ${set.kind} id ${id}`,
      });
    }
  }
}

function validateResult(
  result: ModelResultField,
  nodeIds: Set<NodeId>,
  elementIds: Set<ElementId>,
  issues: Issue[],
): void {
  const known = result.location === "node" ? nodeIds : elementIds;
  if (!Number.isInteger(result.components) || result.components < 1) {
    issues.push({
      code: "result-components",
      severity: "error",
      message: `Result ${result.name} has invalid component count ${String(result.components)}`,
    });
  }
  if (result.values.length !== result.ids.length * result.components) {
    issues.push({
      code: "result-shape",
      severity: "error",
      message:
        `Result ${result.name} holds ${result.values.length} values for ` +
        `${result.ids.length} ids with ${result.components} components`,
    });
  }
  for (const id of result.ids) {
    if (!known.has(id)) {
      issues.push({
        code: "missing-result-id",
        severity: "error",
        message: `Result ${result.name} references unknown ${result.location} id ${id}`,
      });
    }
  }
}
