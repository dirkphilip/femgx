import type { ElementModel } from "../../elements/model";
import { elementModelStorage } from "../../elements/model-storage";

/**
 * Canonical typed body columns shared by direct semantic compilers.
 * @internal
 */
export interface PartBodyColumns {
  readonly bodyIds: Uint32Array;
  readonly bodyIdOrdinals: Uint32Array;
  readonly bodyNameDefined: Uint8Array;
  readonly bodyNameOffsets: Uint32Array;
  readonly bodyNameText: Uint16Array;
  readonly bodyElementOffsets: Uint32Array;
  readonly bodyElementOrdinals: Uint32Array;
}

/**
 * Returns a model's immutable body columns without public-record projection.
 * @internal
 */
export function modelBodyColumns(model: ElementModel): PartBodyColumns | undefined {
  const storage = elementModelStorage(model);
  if (
    storage.bodyIds === undefined ||
    storage.bodyIdOrdinals === undefined ||
    storage.bodyNameDefined === undefined ||
    storage.bodyNameOffsets === undefined ||
    storage.bodyNameText === undefined ||
    storage.bodyElementOffsets === undefined ||
    storage.bodyElementOrdinals === undefined
  ) {
    return undefined;
  }
  if (model.elementBodyIds === undefined)
    throw new Error("Element model body columns have no per-element ownership");
  return {
    bodyIds: storage.bodyIds,
    bodyIdOrdinals: storage.bodyIdOrdinals,
    bodyNameDefined: storage.bodyNameDefined,
    bodyNameOffsets: storage.bodyNameOffsets,
    bodyNameText: storage.bodyNameText,
    bodyElementOffsets: storage.bodyElementOffsets,
    bodyElementOrdinals: storage.bodyElementOrdinals,
  };
}
