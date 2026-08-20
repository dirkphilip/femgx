import { createElementModelFromColumns, type ElementModel } from "../../elements/model";
import type { Body } from "../../elements/model-types";
import { topologyFor, type ElementShape } from "../../elements/shapes";
import { IoError } from "../diagnostics";
import type { FemModel } from "../fem-model";
import { validateFemModel } from "../model-validation";

/**
 * Optional semantic ownership retained while converting an interchange model.
 * @category Import and export
 */
export interface ElementModelConversionOptions {
  /** Validated, non-overlapping bodies that directly own authored element ids. */
  readonly bodies?: readonly Body[];
}

/**
 * Converts one host-supplied serializable model into the dense render model
 * used by {@link model.createPartFromElementModel} tessellation.
 *
 * The interchange node table must already use ids in coordinate order
 * (`0..count - 1`). Validation is performed at the model boundary; errors are
 * reported as {@link IoError} rather than producing a partially renderable
 * part. The conversion preserves element ids and shape blocks while allocating
 * the renderer-facing `Float32Array` coordinate table once.
 * @example Complete host-model-to-part handoff.
 * ```ts
 * import { createElementModelFromFemModel } from "femgx/io";
 * import { createPartFromElementModel } from "femgx/model";
 *
 * const part = createPartFromElementModel(10, createElementModelFromFemModel(model));
 * ```
 * @category Import and export
 */
export function createElementModelFromFemModel(
  model: FemModel,
  options: ElementModelConversionOptions = {},
): ElementModel {
  const issues = validateFemModel(model);
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new IoError("Cannot convert FemModel to ElementModel", errors);
  }
  const columns = copyElementColumns(model);
  return createElementModelFromColumns({
    nodes: model.nodes.coordinates,
    nodeIds: model.nodes.ids,
    ...columns,
    ...(options.bodies === undefined ? {} : { bodies: options.bodies }),
  });
}

function copyElementColumns(model: FemModel): {
  readonly elementIds: Uint32Array;
  readonly elementShapes: readonly ElementShape[];
  readonly elementNodeOffsets: Uint32Array;
  readonly elementNodeIds: Uint32Array;
} {
  let count = 0;
  let connectivityCount = 0;
  for (const block of model.elementShapeBlocks) {
    count += block.count;
    connectivityCount += block.connectivity.length;
  }
  const elementIds = new Uint32Array(count);
  const elementShapes = new Array<ElementShape>(count);
  const elementNodeOffsets = new Uint32Array(count + 1);
  const elementNodeIds = new Uint32Array(connectivityCount);
  let element = 0;
  let connectivity = 0;
  for (const block of model.elementShapeBlocks) {
    const width = topologyFor(block.shape).nodeCount;
    for (let row = 0; row < block.count; row += 1) {
      elementIds[element] = block.ids[row] ?? 0;
      elementShapes[element] = block.shape;
      elementNodeOffsets[element] = connectivity;
      const start = row * width;
      elementNodeIds.set(block.connectivity.subarray(start, start + width), connectivity);
      connectivity += width;
      element += 1;
    }
  }
  elementNodeOffsets[element] = connectivity;
  return { elementIds, elementShapes, elementNodeOffsets, elementNodeIds };
}
