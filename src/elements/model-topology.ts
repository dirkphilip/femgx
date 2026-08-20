import type { ElementModel } from "./model";
import { elementModelStorage, elementShapeForCode } from "./model-storage";
import { topologyFor, type ElementTopology } from "./shapes";

/**
 * Internal zero-allocation access to the topology owned by a dense model row.
 *
 * Geometry compilers use this rather than projecting an `Element` record and a
 * connectivity array for every authored row.
 * @internal
 */
export function elementModelTopologyAt(model: ElementModel, ordinal: number): ElementTopology {
  const code = elementModelStorage(model).shapeCodes[ordinal];
  if (code === undefined) throw new Error(`Element model has invalid row ${ordinal}`);
  return topologyFor(elementShapeForCode(code));
}

/**
 * Reads one stable node id directly from a model row's CSR connectivity.
 * @internal
 */
export function elementModelNodeIdAt(
  model: ElementModel,
  ordinal: number,
  localNode: number,
): number {
  const start = model.elementNodeOffsets[ordinal];
  const id = model.elementNodeIds[(start ?? 0) + localNode];
  if (start === undefined || id === undefined)
    throw new Error(`Element model has invalid connectivity at row ${ordinal}`);
  return id;
}

/**
 * Reads the stable id owned by one dense model row.
 * @internal
 */
export function elementModelIdAt(model: ElementModel, ordinal: number): number {
  const id = model.elementIds[ordinal];
  if (id === undefined) throw new Error(`Element model has invalid row ${ordinal}`);
  return id;
}
