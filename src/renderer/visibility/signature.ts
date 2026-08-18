import type { ElementTessellation, Part } from "../../geometry/part";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import type { InteractionStateData } from "../../interaction/state";
import type { PartOccurrenceId } from "../../scene/types";
import { packedSemanticStorage } from "../../geometry/packed/packed-semantic";
import type { VisibilitySignature } from "./types";

/** Cached semantic fields needed to classify one occurrence's visibility. */
export interface VisibilityPartMetadata {
  readonly elements: {
    readonly size: number;
    get(id: number): ElementTessellation | undefined;
    has(id: number): boolean;
  };
  readonly elementOrdinalCount: number;
  readonly elementOrdinalById: { get(id: number): number | undefined };
  readonly knownBodies: ReadonlySet<number>;
  readonly supportsOrdinalWords: boolean;
}

/** Returns immutable part metadata already owned by the semantic index. */
export function visibilityPartMetadata(part: Part): VisibilityPartMetadata {
  const metadata = getPartSemanticIndex(part);
  const packed = packedSemanticStorage(part);
  return {
    elements: metadata.elements,
    elementOrdinalCount: metadata.elements.size,
    elementOrdinalById: metadata.elementOrdinalById,
    knownBodies: metadata.visibilityBodyIds,
    supportsOrdinalWords: packed?.primitive === "triangles",
  };
}

/** Builds one deterministic sparse identity plus optional dense membership. */
export function visibilitySignature(
  instanceId: PartOccurrenceId,
  data: InteractionStateData,
  metadata: VisibilityPartMetadata,
): VisibilitySignature {
  const bodyIds = relevantIds(data.hiddenBodyIds.get(instanceId), metadata.knownBodies);
  const { ids: elementIds, words: elementWords } = relevantElements(
    data.hiddenElementIds.get(instanceId),
    metadata,
  );
  if (bodyIds.length === 0 && elementIds.length === 0) return EMPTY_SIGNATURE;
  return {
    hash: signatureHash(bodyIds, elementIds),
    bodyIds,
    elementIds,
    ...(elementWords === undefined ? {} : { elementWords }),
    hasHidden: true,
  };
}

/** Compares the authored visibility identity without re-reading interaction state. */
export function visibilitySignaturesEqual(
  left: VisibilitySignature,
  right: VisibilitySignature,
): boolean {
  return arraysEqual(left.bodyIds, right.bodyIds) && arraysEqual(left.elementIds, right.elementIds);
}

const EMPTY_SIGNATURE: VisibilitySignature = {
  hash: 0,
  bodyIds: [],
  elementIds: [],
  hasHidden: false,
};

function relevantElements(
  ids: ReadonlySet<number> | undefined,
  metadata: VisibilityPartMetadata,
): { readonly ids: readonly number[] | Uint32Array; readonly words?: Uint32Array } {
  if (ids === undefined || ids.size === 0) return { ids: [] };
  let count = 0;
  for (const id of ids) if (isSurfaceElement(id, metadata)) count += 1;
  if (count === 0) return { ids: [] };
  if (!metadata.supportsOrdinalWords) return { ids: relevantSurfaceIds(ids, metadata) };
  const wordCount = Math.ceil(metadata.elementOrdinalCount / 32);
  if (!usesOrdinalWords(wordCount, count)) return { ids: relevantSurfaceIds(ids, metadata) };
  const result = new Uint32Array(count);
  let index = 0;
  for (const id of ids) if (isSurfaceElement(id, metadata)) result[index++] = id;
  result.sort();
  return { ids: result, words: elementWords(result, wordCount, metadata) };
}

function isSurfaceElement(id: number, metadata: VisibilityPartMetadata): boolean {
  if (metadata.supportsOrdinalWords) return metadata.elements.has(id);
  return (
    metadata.elements.get(id)?.primitiveRanges.some((range) => range.primitive === "triangles") ===
    true
  );
}

function relevantSurfaceIds(
  ids: ReadonlySet<number>,
  metadata: VisibilityPartMetadata,
): readonly number[] {
  return [...ids]
    .filter((id) => isSurfaceElement(id, metadata))
    .sort((left, right) => left - right);
}

function usesOrdinalWords(wordCount: number, selectedCount: number): boolean {
  // The sorted ids remain the cache identity; words are an additional lookup
  // index and pay off only when they replace several binary-search probes.
  return wordCount < selectedCount;
}

function elementWords(
  elementIds: Uint32Array,
  wordCount: number,
  metadata: VisibilityPartMetadata,
): Uint32Array {
  const words = new Uint32Array(wordCount);
  for (const id of elementIds) {
    const ordinal = metadata.elementOrdinalById.get(id);
    if (ordinal === undefined) continue;
    const bit = ordinal - 1;
    words[bit >> 5] = (words[bit >> 5] ?? 0) | (1 << (bit & 31));
  }
  return words;
}

function relevantIds(
  ids: ReadonlySet<number> | undefined,
  known: { has(id: number): boolean },
): readonly number[] {
  if (ids === undefined || ids.size === 0) return [];
  const result = [...ids].filter((id) => known.has(id));
  return result.sort((left, right) => left - right);
}

function arraysEqual(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function signatureHash(bodyIds: Iterable<number>, elementIds: Iterable<number>): number {
  let hash = 2166136261;
  for (const id of bodyIds) hash = mixHash(hash, 1, id);
  for (const id of elementIds) hash = mixHash(hash, 2, id);
  return hash >>> 0;
}

function mixHash(hash: number, kind: number, id: number): number {
  let next = Math.imul(hash ^ kind, 16777619);
  next ^= id;
  return Math.imul(next, 16777619);
}
