import type { Element, ElementId } from "./element";
import { validateElementModel } from "./model-validation";
import type { Body, BodyId, ElementModelOptions } from "./model-types";

export { ElementModelValidationError } from "./model-validation";
export type { ElementModelValidationCode } from "./model-validation";
export type { Body, BodyId, ElementModelOptions } from "./model-types";

/** Resolved authored ownership used while deriving primitive-group geometry. */
export interface ElementModelMembership {
  readonly bodyByElement: ReadonlyMap<ElementId, BodyId>;
}

const EMPTY_BODY_MEMBERSHIP = new Map<ElementId, BodyId>();

/**
 * A CPU-side finite-element model: node coordinates plus typed elements.
 *
 * `nodes` holds one xyz triple per node and is indexed directly by `NodeId`, so
 * node ids must be dense (`0 .. nodeCount - 1`). Element connectivity references
 * node ids into this array. The model is pure data with no renderer dependency;
 * {@link model.elementPart} tessellates it into reusable part geometry while
 * retaining the authored element ids. Optional bodies are direct ownership
 * metadata, not a second scene graph.
 * @category Elements and model editing
 */
export interface ElementModel {
  /** Flat xyz coordinates, three floats per node id. */
  readonly nodes: Float32Array;
  /** Authored elements with stable ids and canonical connectivity. */
  readonly elements: readonly Element[];
  /** Optional bodies with direct element membership. */
  readonly bodies?: readonly Body[];
}

/**
 * Creates an element model from node coordinates and elements.
 *
 * This is the FE authoring boundary before geometry compilation. It validates
 * dense node numbering, finite coordinates, element references, and optional
 * body ownership. Coordinates and connectivity are copied into the
 * returned model, so the model owns its CPU-side input and can be passed to
 * {@link model.elementPart} without a renderer or WebGPU device.
 * @example Build one renderable typed model.
 * ```ts
 * import { createElementModel, createElement, elementPart, ElementShape } from "femgx/model";
 *
 * const model = createElementModel(
 *   new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
 *   [createElement(100, ElementShape.Triangle, [0, 1, 2])],
 * );
 * const part = elementPart(10, model);
 * ```
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
  validateElementModel(elements, options.bodies);
  const copiedBodies = copyBodies(options.bodies);
  return {
    nodes: new Float32Array(nodes),
    elements: elements.map((element) => ({ ...element, nodeIds: [...element.nodeIds] })),
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

/** Resolves authored body ownership without allocating state for bodyless models. */
export function elementModelMembership(model: ElementModel): ElementModelMembership {
  if (model.bodies === undefined) return { bodyByElement: EMPTY_BODY_MEMBERSHIP };
  const bodyByElement = new Map<ElementId, BodyId>();
  for (const body of model.bodies) {
    for (const elementId of body.elementIds) bodyByElement.set(elementId, body.id);
  }
  return { bodyByElement };
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
    return { id: body.id, ...name, elementIds: [...body.elementIds] };
  });
}
