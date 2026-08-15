import type { Element, ElementId } from "./element";
import { validateElementModel } from "./model-validation";
import type {
  Body,
  BodyId,
  ElementBlock,
  ElementBlockId,
  ElementModelOptions,
} from "./model-types";

export { ElementModelValidationError } from "./model-validation";
export type { ElementModelValidationCode } from "./model-validation";
export type {
  Body,
  BodyId,
  ElementBlock,
  ElementBlockId,
  ElementModelOptions,
} from "./model-types";

/** Resolved authored ownership used while deriving primitive-group geometry. */
export interface ElementModelMembership {
  readonly bodyByElement: ReadonlyMap<ElementId, BodyId>;
  readonly blockByElement: ReadonlyMap<ElementId, ElementBlockId>;
}

const EMPTY_BLOCK_MEMBERSHIP = new Map<ElementId, ElementBlockId>();

/**
 * A CPU-side finite-element model: node coordinates plus typed elements.
 *
 * `nodes` holds one xyz triple per node and is indexed directly by `NodeId`, so
 * node ids must be dense (`0 .. nodeCount - 1`). Element connectivity references
 * node ids into this array. The model is pure data with no renderer dependency;
 * the renderer path tessellates it into reusable part geometry.
 * @category Elements and model editing
 */
export interface ElementModel {
  /** Flat xyz coordinates, three floats per node id. */
  readonly nodes: Float32Array;
  readonly elements: readonly Element[];
  /** Optional semantic blocks; omitted models take the blockless fast path. */
  readonly blocks?: readonly ElementBlock[];
  /** Optional bodies using either direct element or block membership. */
  readonly bodies?: readonly Body[];
}

/**
 * Creates an element model from node coordinates and elements, validating that
 * node ids are dense and that every element reference is in range.
 * @category Elements and model editing
 */
export function createElementModel(
  nodes: ArrayLike<number>,
  elements: readonly Element[],
  options: ElementModelOptions = {},
): ElementModel {
  if (nodes.length % 3 !== 0) {
    throw new Error("Node coordinate array length must be a multiple of 3");
  }
  const nodeCount = nodes.length / 3;
  validateNodeCoordinates(nodes, nodeCount);
  for (const element of elements) {
    for (const nodeId of element.nodeIds) {
      if (!Number.isInteger(nodeId) || nodeId < 0 || nodeId >= nodeCount) {
        throw new Error(`Element ${element.id} references out-of-range node ${nodeId}`);
      }
    }
  }
  validateElementModel(elements, options.blocks, options.bodies);
  const copiedBlocks = copyBlocks(options.blocks);
  const copiedBodies = copyBodies(options.bodies);
  return {
    nodes: new Float32Array(nodes),
    elements: elements.map((element) => ({ ...element, nodeIds: [...element.nodeIds] })),
    ...(copiedBlocks === undefined ? {} : { blocks: copiedBlocks }),
    ...(copiedBodies === undefined ? {} : { bodies: copiedBodies }),
  };
}

/**
 * Reifies a model from elements whose ids, shapes, connectivity, and ownership
 * have already been validated by an internal importer. This keeps the importer
 * handoff from copying each owned connectivity collection a second time.
 * @internal
 */
export function createElementModelFromOwnedElements(
  nodes: ArrayLike<number>,
  elements: readonly Element[],
): ElementModel {
  if (nodes.length % 3 !== 0) {
    throw new Error("Node coordinate array length must be a multiple of 3");
  }
  validateNodeCoordinates(nodes, nodes.length / 3);
  return { nodes: new Float32Array(nodes), elements };
}

/** Resolves authored block and body ownership without allocating block state for empty models. */
export function elementModelMembership(model: ElementModel): ElementModelMembership {
  const blockByElement =
    model.blocks === undefined ? EMPTY_BLOCK_MEMBERSHIP : new Map<ElementId, ElementBlockId>();
  for (const block of model.blocks ?? []) {
    for (const elementId of block.elementIds) blockByElement.set(elementId, block.id);
  }
  const bodyByElement = new Map<ElementId, BodyId>();
  const blocks =
    model.blocks === undefined
      ? undefined
      : new Map(model.blocks.map((block) => [block.id, block] as const));
  for (const body of model.bodies ?? []) {
    if ("elementIds" in body) {
      for (const elementId of body.elementIds) bodyByElement.set(elementId, body.id);
      continue;
    }
    for (const blockId of body.blockIds) {
      for (const elementId of blocks?.get(blockId)?.elementIds ?? []) {
        bodyByElement.set(elementId, body.id);
      }
    }
  }
  return { bodyByElement, blockByElement };
}

function copyBlocks(
  blocks: readonly ElementBlock[] | undefined,
): readonly ElementBlock[] | undefined {
  return blocks?.map((block) => ({
    ...block,
    elementIds: [...block.elementIds],
  }));
}

function validateNodeCoordinates(nodes: ArrayLike<number>, nodeCount: number): void {
  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    const x = nodes[nodeId * 3] ?? 0;
    const y = nodes[nodeId * 3 + 1] ?? 0;
    const z = nodes[nodeId * 3 + 2] ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error(`Node ${nodeId} has non-finite coordinates`);
    }
  }
}

function copyBodies(bodies: readonly Body[] | undefined): readonly Body[] | undefined {
  return bodies?.map((body): Body => {
    const name = body.name === undefined ? {} : { name: body.name };
    return "elementIds" in body
      ? { id: body.id, ...name, elementIds: [...body.elementIds] }
      : { id: body.id, ...name, blockIds: [...body.blockIds] };
  });
}
