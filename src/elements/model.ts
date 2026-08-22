import type { Element, NodeId } from "./element";
import type { ElementModel } from "./model-contract";
import {
  buildElementModel,
  buildElementModelFromColumns,
  type ElementModelColumns,
} from "./model-builder";
import { elementModelStorage, ordinalForId } from "./model-storage";
import type { ElementModelOptions } from "./model-types";

export { ElementModelValidationError } from "./model-validation";
export type { ElementModelValidationCode } from "./model-validation";
export type { Body, BodyId, ElementModelOptions } from "./model-types";
export type { ElementModel, ElementModelBodies, ElementModelElements } from "./model-contract";

/** Resolves an authored node id through its compact sparse-id index. */
export function elementModelNodeOrdinal(model: ElementModel, id: NodeId): number | undefined {
  return ordinalForId(model.nodeIds, elementModelStorage(model).nodeIdOrdinals, id);
}

/** Creates a packed model from transient ergonomic authoring records. */
export function createElementModel(
  nodes: ArrayLike<number>,
  elements: readonly Element[],
  options: ElementModelOptions = {},
): ElementModel {
  return buildElementModel(nodes, elements, options);
}

/**
 * Internal bulk column boundary used by typed interchange conversion.
 * @internal
 */
export function createElementModelFromColumns(input: ElementModelColumns): ElementModel {
  return buildElementModelFromColumns(input);
}
