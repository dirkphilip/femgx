import { createElement } from "../elements/element";
import { createElementModel, type ElementModel } from "../elements/model";
import { topologyFor } from "../elements/shapes";
import { IoError, type Issue } from "./diagnostics";
import type { FemModel } from "./model";
import { validateModel } from "./validate";

/**
 * Converts one serializable interchange model into the dense render model used
 * by element tessellation. The interchange node table must already use ids in
 * coordinate order (`0..count - 1`); the conversion preserves element ids and
 * shape blocks while allocating the renderer's Float32 coordinate table once.
 * @category Import and export
 */
export function createElementModelFromFemModel(model: FemModel): ElementModel {
  const issues = [...validateModel(model), ...nonDenseNodeIssues(model)];
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new IoError("Cannot convert FemModel to ElementModel", errors);
  }
  const elements = model.elementShapeBlocks.flatMap((block) => {
    const nodeCount = topologyFor(block.shape).nodeCount;
    return Array.from({ length: block.count }, (_, index) => {
      const start = index * nodeCount;
      return createElement(
        block.ids[index] ?? index,
        block.shape,
        Array.from(block.connectivity.slice(start, start + nodeCount)),
      );
    });
  });
  return createElementModel(model.nodes.coordinates, elements);
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
