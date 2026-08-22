import type { Element, ElementId, NodeId } from "./element";
import { ModelElements } from "./model-elements";
import { ModelBodies } from "./model-bodies";
import {
  ordinalForId,
  registerElementModelStorage,
  shapeCodeForElement,
  sortedOrdinals,
} from "./model-storage";
import { ElementModelValidationError } from "./model-validation";
import type { Body, ElementModelOptions } from "./model-types";
import { topologyFor } from "./shapes";
import type { ElementShape } from "./shapes";
import type { ElementModel } from "./model-contract";

export interface ElementModelColumns {
  readonly nodes: ArrayLike<number>;
  readonly nodeIds: ArrayLike<NodeId>;
  readonly elementIds: ArrayLike<ElementId>;
  readonly elementShapes: readonly ElementShape[];
  readonly elementNodeOffsets: ArrayLike<number>;
  readonly elementNodeIds: ArrayLike<NodeId>;
  readonly bodies?: readonly Body[];
}

interface BodyColumns {
  readonly elementBodyIds: Uint32Array;
  readonly bodyIds: Uint32Array;
  readonly bodyIdOrdinals: Uint32Array;
  readonly bodyNameDefined: Uint8Array;
  readonly bodyNameOffsets: Uint32Array;
  readonly bodyNameText: Uint16Array;
  readonly bodyElementOffsets: Uint32Array;
  readonly bodyElementOrdinals: Uint32Array;
}

/** Builds and publishes one immutable model from transient authoring records. */
export function buildElementModel(
  nodes: ArrayLike<number>,
  records: readonly Element[],
  options: ElementModelOptions,
): ElementModel {
  return buildModelFromRecords(
    nodes,
    options.nodeIds ?? sequentialIds(nodes.length / 3),
    records,
    options.bodies,
  );
}

/** Validates copied numeric columns and publishes one immutable model snapshot. */
export function buildElementModelFromColumns(input: ElementModelColumns): ElementModel {
  const nodes = copyNodeColumns(input.nodes, input.nodeIds);
  const elements = copyElementColumns({
    ...input,
    nodeIds: nodes.ids,
    nodeOrdinals: nodes.ordinals,
  });
  return publishModel(nodes, elements, input.bodies);
}

function buildModelFromRecords(
  nodes: ArrayLike<number>,
  nodeIds: ArrayLike<NodeId>,
  records: readonly Element[],
  bodies: readonly Body[] | undefined,
): ElementModel {
  const nodeColumns = copyNodeColumns(nodes, nodeIds);
  validateElementRecords(records, nodeColumns.ids, nodeColumns.ordinals);
  const offsets = new Uint32Array(records.length + 1);
  let connectivityCount = 0;
  for (let ordinal = 0; ordinal < records.length; ordinal += 1) {
    const element = records[ordinal];
    if (element === undefined) throw new Error(`Element model has no element ${ordinal}`);
    connectivityCount += element.nodeIds.length;
    offsets[ordinal + 1] = connectivityCount;
  }
  const ids = new Uint32Array(records.length);
  const shapes = new Uint8Array(records.length);
  const connectivity = new Uint32Array(connectivityCount);
  let cursor = 0;
  for (let ordinal = 0; ordinal < records.length; ordinal += 1) {
    const element = records[ordinal];
    if (element === undefined) throw new Error(`Element model has no element ${ordinal}`);
    ids[ordinal] = element.id;
    shapes[ordinal] = shapeCodeForElement(element.shape);
    connectivity.set(element.nodeIds, cursor);
    cursor += element.nodeIds.length;
  }
  return publishModel(nodeColumns, { ids, shapes, offsets, connectivity }, bodies);
}

function copyNodeColumns(
  nodes: ArrayLike<number>,
  nodeIds: ArrayLike<NodeId>,
): { readonly nodes: Float32Array; readonly ids: Uint32Array; readonly ordinals: Uint32Array } {
  if (nodes.length % 3 !== 0)
    throw new Error("Node coordinate array length must be a multiple of 3");
  const count = nodes.length / 3;
  if (nodeIds.length !== count) {
    throw new Error(`Node id count ${nodeIds.length} does not match coordinate rows ${count}`);
  }
  const copiedNodes = new Float32Array(nodes.length);
  const copiedIds = new Uint32Array(count);
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const id = nodeIds[ordinal];
    if (!isStableId(id))
      throw new Error(`Node id ${String(id)} must be an integer in [0, 4294967294]`);
    copiedIds[ordinal] = id;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = nodes[ordinal * 3 + axis] ?? Number.NaN;
      if (!Number.isFinite(value)) throw new Error(`Node ${id} has non-finite coordinates`);
      copiedNodes[ordinal * 3 + axis] = value;
      if (!Number.isFinite(copiedNodes[ordinal * 3 + axis])) {
        throw new Error(`Node ${id} cannot be represented as a Float32 value`);
      }
    }
  }
  return { nodes: copiedNodes, ids: copiedIds, ordinals: sortedOrdinals(copiedIds, "Node") };
}

function copyElementColumns(
  input: ElementModelColumns & {
    readonly nodeIds: Uint32Array;
    readonly nodeOrdinals: Uint32Array;
  },
): {
  readonly ids: Uint32Array;
  readonly shapes: Uint8Array;
  readonly offsets: Uint32Array;
  readonly connectivity: Uint32Array;
} {
  const count = input.elementIds.length;
  if (input.elementShapes.length !== count || input.elementNodeOffsets.length !== count + 1) {
    throw new Error("Element model columns must have one shape and CSR range per element");
  }
  const ids = new Uint32Array(count);
  const shapes = new Uint8Array(count);
  const offsets = new Uint32Array(count + 1);
  let previous = 0;
  for (let ordinal = 0; ordinal < count; ordinal += 1) {
    const id = input.elementIds[ordinal];
    const start = input.elementNodeOffsets[ordinal] ?? Number.NaN;
    const end = input.elementNodeOffsets[ordinal + 1] ?? Number.NaN;
    const shape = input.elementShapes[ordinal];
    if (!isStableId(id)) throw new Error(`Element model has invalid element id ${id}`);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start !== previous ||
      end < start
    ) {
      throw new Error("Element model connectivity offsets must be contiguous and monotonic");
    }
    if (
      end > input.elementNodeIds.length ||
      shape === undefined ||
      end - start !== topologyFor(shape).nodeCount
    ) {
      throw new Error(`Element ${id} has invalid canonical connectivity`);
    }
    validateConnectivity({
      elementId: id,
      values: input.elementNodeIds,
      start,
      end,
      nodeIds: input.nodeIds,
      nodeOrdinals: input.nodeOrdinals,
    });
    ids[ordinal] = id;
    shapes[ordinal] = shapeCodeForElement(shape);
    offsets[ordinal] = start;
    previous = end;
  }
  if (previous !== input.elementNodeIds.length)
    throw new Error("Element model connectivity has trailing ids");
  offsets[count] = previous;
  return { ids, shapes, offsets, connectivity: new Uint32Array(input.elementNodeIds) };
}

function validateElementRecords(
  elements: readonly Element[],
  nodeIds: Uint32Array,
  nodeOrdinals: Uint32Array,
): void {
  for (const element of elements) {
    if (!isStableId(element.id))
      throw new Error(`Element model has invalid element id ${String(element.id)}`);
    if (element.nodeIds.length !== topologyFor(element.shape).nodeCount) {
      throw new Error(`Element ${element.id} has invalid canonical connectivity`);
    }
    validateConnectivity({
      elementId: element.id,
      values: element.nodeIds,
      start: 0,
      end: element.nodeIds.length,
      nodeIds,
      nodeOrdinals,
    });
  }
}

function validateConnectivity(input: {
  readonly elementId: number;
  readonly values: ArrayLike<number>;
  readonly start: number;
  readonly end: number;
  readonly nodeIds: Uint32Array;
  readonly nodeOrdinals: Uint32Array;
}): void {
  for (let index = input.start; index < input.end; index += 1) {
    const nodeId = input.values[index];
    for (let earlier = input.start; earlier < index; earlier += 1) {
      if (input.values[earlier] === nodeId)
        throw new Error(
          `Element ${input.elementId} references node ${String(nodeId)} more than once`,
        );
    }
    if (
      !isStableId(nodeId) ||
      ordinalForId(input.nodeIds, input.nodeOrdinals, nodeId) === undefined
    ) {
      throw new Error(`Element ${input.elementId} references invalid node ${String(nodeId)}`);
    }
  }
}

function publishModel(
  nodes: { readonly nodes: Float32Array; readonly ids: Uint32Array },
  elements: {
    readonly ids: Uint32Array;
    readonly shapes: Uint8Array;
    readonly offsets: Uint32Array;
    readonly connectivity: Uint32Array;
  },
  bodies: readonly Body[] | undefined,
): ElementModel {
  const nodeOrdinals = sortedOrdinals(nodes.ids, "Node");
  const elementOrdinals = elementOrdinalsFor(elements.ids);
  const bodyColumns = validateAndBuildBodyColumns(elements.ids, elementOrdinals, bodies);
  const published: ElementModel = {
    nodes: nodes.nodes,
    nodeIds: nodes.ids,
    elementIds: elements.ids,
    elementNodeOffsets: elements.offsets,
    elementNodeIds: elements.connectivity,
    ...(bodyColumns === undefined ? {} : { elementBodyIds: bodyColumns.elementBodyIds }),
    ...(bodyColumns === undefined ? {} : { bodies: new ModelBodies(() => published) }),
    elements: new ModelElements(() => published),
  };
  registerElementModelStorage(published, {
    shapeCodes: elements.shapes,
    nodeIdOrdinals: nodeOrdinals,
    elementIdOrdinals: elementOrdinals,
    ...(bodyColumns === undefined ? {} : bodyColumns),
  });
  return published;
}

function elementOrdinalsFor(ids: Uint32Array): Uint32Array {
  try {
    return sortedOrdinals(ids, "Element");
  } catch (error) {
    if (error instanceof Error && error.message === "Element ids must be unique") {
      throw new ElementModelValidationError("duplicate-element-id", error.message);
    }
    throw error;
  }
}

function validateAndBuildBodyColumns(
  elementIds: Uint32Array,
  ordinals: Uint32Array,
  bodies: readonly Body[] | undefined,
): BodyColumns | undefined {
  if (bodies === undefined) return undefined;
  const columns = allocateBodyColumns(elementIds.length, bodies);
  let previousBody = 0;
  let text = 0;
  let membership = 0;
  for (let bodyOrdinal = 0; bodyOrdinal < bodies.length; bodyOrdinal += 1) {
    const body = bodies[bodyOrdinal];
    if (body === undefined) throw new Error(`Element model has no body ${bodyOrdinal}`);
    validateBody(body, previousBody);
    columns.bodyIds[bodyOrdinal] = body.id;
    columns.bodyNameDefined[bodyOrdinal] = body.name === undefined ? 0 : 1;
    columns.bodyNameOffsets[bodyOrdinal] = text;
    for (let character = 0; character < (body.name?.length ?? 0); character += 1) {
      columns.bodyNameText[text + character] = body.name?.charCodeAt(character) ?? 0;
    }
    text += body.name?.length ?? 0;
    columns.bodyElementOffsets[bodyOrdinal] = membership;
    previousBody = body.id;
    membership = writeBodyMembership(columns, body, elementIds, ordinals, membership);
  }
  columns.bodyNameOffsets[bodies.length] = text;
  columns.bodyElementOffsets[bodies.length] = membership;
  return { ...columns, bodyIdOrdinals: sortedOrdinals(columns.bodyIds, "Body") };
}

function allocateBodyColumns(
  elementCount: number,
  bodies: readonly Body[],
): Omit<BodyColumns, "bodyIdOrdinals"> {
  let nameLength = 0;
  let membershipCount = 0;
  for (const body of bodies) {
    nameLength += body.name?.length ?? 0;
    membershipCount += body.elementIds.length;
  }
  return {
    elementBodyIds: new Uint32Array(elementCount),
    bodyIds: new Uint32Array(bodies.length),
    bodyNameDefined: new Uint8Array(bodies.length),
    bodyNameOffsets: new Uint32Array(bodies.length + 1),
    bodyNameText: new Uint16Array(nameLength),
    bodyElementOffsets: new Uint32Array(bodies.length + 1),
    bodyElementOrdinals: new Uint32Array(membershipCount),
  };
}

function validateBody(body: Body, previous: number): void {
  if (!Number.isSafeInteger(body.id) || body.id < 1 || body.id > 0xffff_fffe) {
    throw new ElementModelValidationError(
      "invalid-body-id",
      `Body id ${body.id} must be a finite integer in [1, 4294967294]`,
    );
  }
  if (body.id <= previous)
    throw new ElementModelValidationError(
      body.id === previous ? "duplicate-body-id" : "body-order",
      `Body ids must be strictly ascending; ${body.id} follows ${previous}`,
    );
  if (body.elementIds.length === 0)
    throw new ElementModelValidationError("empty-body", `Body ${body.id} has no elements`);
}

function writeBodyMembership(
  columns: Omit<BodyColumns, "bodyIdOrdinals">,
  body: Body,
  elementIds: Uint32Array,
  ordinals: Uint32Array,
  cursor: number,
): number {
  let previous = -1;
  for (const elementId of body.elementIds) {
    if (elementId <= previous)
      throw new ElementModelValidationError(
        "body-order",
        `Body ${body.id} element ids must be strictly ascending`,
      );
    const ordinal = ordinalForId(elementIds, ordinals, elementId);
    if (ordinal === undefined)
      throw new ElementModelValidationError(
        "unknown-body-element",
        `Body ${body.id} references unknown element ${elementId}`,
      );
    if (columns.elementBodyIds[ordinal] !== 0)
      throw new ElementModelValidationError(
        "duplicate-body-membership",
        `Element ${elementId} belongs to more than one body`,
      );
    columns.elementBodyIds[ordinal] = body.id;
    columns.bodyElementOrdinals[cursor++] = ordinal;
    previous = elementId;
  }
  return cursor;
}

function sequentialIds(count: number): Uint32Array {
  const ids = new Uint32Array(count);
  for (let index = 0; index < count; index += 1) ids[index] = index;
  return ids;
}

function isStableId(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_fffe
  );
}
