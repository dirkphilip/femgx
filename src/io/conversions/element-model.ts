import { createOwnedElement, type Element, type NodeId } from "../../elements/element";
import { createElementModelFromOwnedElements, type ElementModel } from "../../elements/model";
import { topologyFor } from "../../elements/shapes";
import { IoError, type Issue } from "../diagnostics";
import type { FemModel } from "../fem-model";
import { validateModel } from "../model-validation";

/**
 * Converts one host-supplied serializable model into the dense render model
 * used by {@link model.elementPart} tessellation.
 *
 * The interchange node table must already use ids in coordinate order
 * (`0..count - 1`). Validation is performed at the model boundary; errors are
 * reported as {@link IoError} rather than producing a partially renderable
 * part. The conversion preserves element ids and shape blocks while allocating
 * the renderer-facing `Float32Array` coordinate table once.
 * @example Complete host-model-to-part handoff.
 * ```ts
 * import { createElementModelFromFemModel } from "femgx/io";
 * import { elementPart } from "femgx/model";
 *
 * const part = elementPart(10, createElementModelFromFemModel(model));
 * ```
 * @category Import and export
 */
export function createElementModelFromFemModel(model: FemModel): ElementModel {
  const issues = [...validateModel(model), ...nonDenseNodeIssues(model)];
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new IoError("Cannot convert FemModel to ElementModel", errors);
  }
  const elements: Element[] = [];
  for (const block of model.elementShapeBlocks) {
    const nodeCount = topologyFor(block.shape).nodeCount;
    for (let index = 0; index < block.count; index += 1) {
      const start = index * nodeCount;
      const nodeIds = new Array<NodeId>(nodeCount);
      for (let node = 0; node < nodeCount; node += 1) {
        nodeIds[node] = block.connectivity[start + node] ?? 0;
      }
      elements.push(createOwnedElement(block.ids[index] ?? index, block.shape, nodeIds));
    }
  }
  return createElementModelFromOwnedElements(model.nodes.coordinates, elements);
}

function nonDenseNodeIssues(model: FemModel): readonly Issue[] {
  const issues: Issue[] = [];
  for (let index = 0; index < model.nodes.ids.length; index += 1) {
    if (model.nodes.ids[index] !== index) {
      issues.push({
        code: "non-dense-node-ids",
        severity: "error",
        message:
          `ElementModel conversion requires node ids 0..${String(model.nodes.count - 1)} ` +
          `in coordinate order; node row ${String(index)} has id ${String(model.nodes.ids[index])}`,
      });
      break;
    }
  }
  return issues;
}
