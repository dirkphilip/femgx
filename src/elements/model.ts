import type { Element, ElementId, NodeId } from "./element";
import type { ElementModel } from "./model-contract";
import {
  buildElementModel,
  buildElementModelFromColumns,
  type ElementModelColumns,
} from "./model-builder";
import { elementShapeForCode, elementModelStorage, ordinalForId } from "./model-storage";
import type { Body, BodyId, ElementModelOptions } from "./model-types";

export { ElementModelValidationError } from "./model-validation";
export type { ElementModelValidationCode } from "./model-validation";
export type { Body, BodyId, ElementModelOptions } from "./model-types";
export type { ElementModel, ElementModelBodies, ElementModelElements } from "./model-contract";

/** Number of dense authored element rows. */
export function elementModelElementCount(model: ElementModel): number {
  return model.elementIds.length;
}

/** Resolves an authored element id through its compact sparse-id index. */
export function elementModelElementOrdinal(model: ElementModel, id: ElementId): number | undefined {
  return ordinalForId(model.elementIds, elementModelStorage(model).elementIdOrdinals, id);
}

/** Resolves an authored node id through its compact sparse-id index. */
export function elementModelNodeOrdinal(model: ElementModel, id: NodeId): number | undefined {
  return ordinalForId(model.nodeIds, elementModelStorage(model).nodeIdOrdinals, id);
}

/** Returns one fresh immutable descriptor for a dense authored element row. */
export function elementModelElementAt(model: ElementModel, ordinal: number): Element | undefined {
  const id = model.elementIds[ordinal];
  const code = elementModelStorage(model).shapeCodes[ordinal];
  const start = model.elementNodeOffsets[ordinal];
  const end = model.elementNodeOffsets[ordinal + 1];
  if (id === undefined || code === undefined || start === undefined || end === undefined)
    return undefined;
  return Object.freeze({
    id,
    shape: elementShapeForCode(code),
    nodeIds: Object.freeze(Array.from(model.elementNodeIds.subarray(start, end))),
  });
}

/**
 * Iterates fresh descriptors in deterministic authored input order.
 * @yields {Element} Descriptor.
 */
export function* elementModelElements(model: ElementModel): IterableIterator<Element> {
  yield* model.elements;
}

/** Returns direct body ownership for one element row, when authored. */
export function elementModelBodyId(model: ElementModel, ordinal: number): BodyId | undefined {
  const id = model.elementBodyIds?.[ordinal] ?? 0;
  return id === 0 ? undefined : id;
}

/** Returns one fresh immutable descriptor for a packed authored body row. */
export function elementModelBodyAt(model: ElementModel, ordinal: number): Body | undefined {
  const storage = elementModelStorage(model);
  const ids = storage.bodyIds;
  const names = storage.bodyNameDefined;
  const nameOffsets = storage.bodyNameOffsets;
  const nameText = storage.bodyNameText;
  const elementOffsets = storage.bodyElementOffsets;
  const elementOrdinals = storage.bodyElementOrdinals;
  const id = ids?.[ordinal];
  const start = elementOffsets?.[ordinal];
  const end = elementOffsets?.[ordinal + 1];
  if (
    id === undefined ||
    start === undefined ||
    end === undefined ||
    names === undefined ||
    nameOffsets === undefined ||
    nameText === undefined ||
    elementOrdinals === undefined
  ) {
    return undefined;
  }
  const elementIds = new Array<number>(end - start);
  for (let index = start; index < end; index += 1) {
    const elementOrdinal = elementOrdinals[index];
    const elementId = model.elementIds[elementOrdinal ?? -1];
    if (elementId === undefined) throw new Error(`Body ${id} references invalid element row`);
    elementIds[index - start] = elementId;
  }
  const nameStart = nameOffsets[ordinal] ?? 0;
  const nameEnd = nameOffsets[ordinal + 1] ?? nameStart;
  const name =
    names[ordinal] === 0
      ? undefined
      : String.fromCharCode(...nameText.subarray(nameStart, nameEnd));
  return Object.freeze({
    id,
    ...(name === undefined ? {} : { name }),
    elementIds: Object.freeze(elementIds),
  });
}

/** Resolves an authored body id through its compact sparse-id index. */
export function elementModelBodyOrdinal(model: ElementModel, id: BodyId): number | undefined {
  const storage = elementModelStorage(model);
  return storage.bodyIds === undefined || storage.bodyIdOrdinals === undefined
    ? undefined
    : ordinalForId(storage.bodyIds, storage.bodyIdOrdinals, id);
}

/** Resolves direct ownership without a retained object map. */
export function elementModelMembership(model: ElementModel): {
  readonly bodyIdForElement: (elementId: ElementId) => BodyId | undefined;
} {
  return {
    bodyIdForElement: (elementId) => {
      const ordinal = elementModelElementOrdinal(model, elementId);
      return ordinal === undefined ? undefined : elementModelBodyId(model, ordinal);
    },
  };
}

/** Creates a packed model from transient ergonomic authoring records. */
export function createElementModel(
  nodes: ArrayLike<number>,
  elements: readonly Element[],
  options: ElementModelOptions = {},
): ElementModel {
  return buildElementModel(nodes, elements, options, modelQueries);
}

/**
 * Internal bulk column boundary used by typed interchange conversion.
 * @internal
 */
export function createElementModelFromColumns(input: ElementModelColumns): ElementModel {
  return buildElementModelFromColumns(input, modelQueries);
}

/**
 * Internal entry for the same packed authoring boundary.
 * @internal
 */
export function createElementModelFromOwnedElements(
  nodes: ArrayLike<number>,
  elements: readonly Element[],
  options: ElementModelOptions = {},
): ElementModel {
  return buildElementModel(nodes, elements, options, modelQueries);
}

const modelQueries = {
  elementOrdinal: elementModelElementOrdinal,
  elementAt: elementModelElementAt,
  bodyOrdinal: elementModelBodyOrdinal,
  bodyAt: elementModelBodyAt,
};
