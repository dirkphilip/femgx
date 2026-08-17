import type { ElementTessellation, GeometryEdge } from "../types";
import type { BodyId } from "../part";
import { faceIdentity } from "../element-face-selection";
import type { FaceMetadata, PartSemanticIndex, SemanticMap } from "../part-semantic-types";
import {
  packedEdge,
  packedEdgeOrdinal,
  packedElement,
  packedElementOrdinal,
  packedFace,
  packedFaceOrdinal,
  type PackedSemanticStorage,
} from "./packed-semantic";
import { buildPackedTriangleSemanticCsr } from "./packed-semantic-csr";

type ElementId = ElementTessellation["id"];

/** Builds the allocation-free lookup views over packed semantic tables. */
export function buildPackedSemanticIndex(storage: PackedSemanticStorage): PartSemanticIndex {
  const elements = new PackedElementMap(storage);
  const elementOrdinalById = new PackedOrdinalMap(storage);
  const bodies = new Map((storage.bodies ?? []).map((body) => [body.id, body]));
  const bodyByElement = new PackedBodyMap(storage);
  const faces = new PackedFaceMap(storage);
  const edges = new PackedEdgeMap(storage);
  const triangle = buildPackedTriangleSemanticCsr(storage);
  return {
    elements,
    elementOrdinalById,
    bodies,
    bodyByElement,
    faces,
    edges,
    nodeCount: storage.nodeCount,
    nodeTriangleFaceOffsets: triangle.nodeTriangleFaceOffsets,
    nodeTriangleFaceIds: triangle.nodeTriangleFaceIds,
    neighborTriangleFaceOffsets: triangle.neighborTriangleFaceOffsets,
    neighborTriangleFaceIds: triangle.neighborTriangleFaceIds,
    nonTriangleElementOrdinals: new Uint32Array(0),
    hasBoundaryFaceSubset: triangle.hasBoundaryFaceSubset,
    hasCompleteNeighborTriangleIndex: triangle.hasCompleteNeighborTriangleIndex,
  };
}

class PackedElementMap implements SemanticMap<ElementId, ElementTessellation> {
  readonly size: number;

  constructor(private readonly storage: PackedSemanticStorage) {
    this.size = storage.elementIds.length;
  }

  get(key: ElementId): ElementTessellation | undefined {
    const ordinal = packedElementOrdinal(this.storage, key);
    return ordinal === undefined ? undefined : packedElement(this.storage, ordinal);
  }

  has(key: ElementId): boolean {
    return packedElementOrdinal(this.storage, key) !== undefined;
  }

  *entries(): IterableIterator<[ElementId, ElementTessellation]> {
    for (let ordinal = 0; ordinal < this.size; ordinal += 1) {
      const element = packedElement(this.storage, ordinal);
      yield [element.id, element];
    }
  }

  *keys(): IterableIterator<ElementId> {
    yield* this.storage.elementIds;
  }

  *values(): IterableIterator<ElementTessellation> {
    for (let ordinal = 0; ordinal < this.size; ordinal += 1) {
      yield packedElement(this.storage, ordinal);
    }
  }

  forEach(
    callbackfn: (
      value: ElementTessellation,
      key: ElementId,
      map: SemanticMap<ElementId, ElementTessellation>,
    ) => void,
  ): void {
    for (const [key, value] of this.entries()) {
      callbackfn(value, key, this);
    }
  }

  [Symbol.iterator](): IterableIterator<[ElementId, ElementTessellation]> {
    return this.entries();
  }
}

class PackedOrdinalMap implements SemanticMap<ElementId, number> {
  readonly size: number;

  constructor(private readonly storage: PackedSemanticStorage) {
    this.size = storage.elementIds.length;
  }

  get(key: ElementId): number | undefined {
    const ordinal = packedElementOrdinal(this.storage, key);
    return ordinal === undefined ? undefined : ordinal + 1;
  }

  has(key: ElementId): boolean {
    return packedElementOrdinal(this.storage, key) !== undefined;
  }

  *entries(): IterableIterator<[ElementId, number]> {
    for (let ordinal = 0; ordinal < this.size; ordinal += 1) {
      const id = this.storage.elementIds[ordinal];
      if (id !== undefined) yield [id, ordinal + 1];
    }
  }

  *keys(): IterableIterator<ElementId> {
    yield* this.storage.elementIds;
  }

  *values(): IterableIterator<number> {
    for (let ordinal = 0; ordinal < this.size; ordinal += 1) yield ordinal + 1;
  }

  forEach(
    callbackfn: (value: number, key: ElementId, map: SemanticMap<ElementId, number>) => void,
  ): void {
    for (const [key, value] of this.entries()) {
      callbackfn(value, key, this);
    }
  }

  [Symbol.iterator](): IterableIterator<[ElementId, number]> {
    return this.entries();
  }
}

class PackedBodyMap implements SemanticMap<ElementId, BodyId> {
  readonly size: number;

  constructor(private readonly storage: PackedSemanticStorage) {
    this.size = this.countEntries();
  }

  get(key: ElementId): BodyId | undefined {
    const ordinal = packedElementOrdinal(this.storage, key);
    if (ordinal === undefined) return undefined;
    const bodyId = this.storage.elementBodyIds?.[ordinal] ?? 0;
    return bodyId === 0 ? undefined : bodyId;
  }

  has(key: ElementId): boolean {
    return this.get(key) !== undefined;
  }

  *entries(): IterableIterator<[ElementId, BodyId]> {
    for (let ordinal = 0; ordinal < this.storage.elementIds.length; ordinal += 1) {
      const bodyId = this.storage.elementBodyIds?.[ordinal] ?? 0;
      const elementId = this.storage.elementIds[ordinal];
      if (bodyId !== 0 && elementId !== undefined) yield [elementId, bodyId];
    }
  }

  *keys(): IterableIterator<ElementId> {
    for (const [key] of this.entries()) yield key;
  }

  *values(): IterableIterator<BodyId> {
    for (const [, value] of this.entries()) yield value;
  }

  forEach(
    callbackfn: (value: BodyId, key: ElementId, map: SemanticMap<ElementId, BodyId>) => void,
  ): void {
    for (const [key, value] of this.entries()) {
      callbackfn(value, key, this);
    }
  }

  [Symbol.iterator](): IterableIterator<[ElementId, BodyId]> {
    return this.entries();
  }

  private countEntries(): number {
    let count = 0;
    for (let ordinal = 0; ordinal < this.storage.elementIds.length; ordinal += 1) {
      if ((this.storage.elementBodyIds?.[ordinal] ?? 0) !== 0) count += 1;
    }
    return count;
  }
}

class PackedFaceMap implements SemanticMap<string, FaceMetadata> {
  readonly size: number;

  constructor(private readonly storage: PackedSemanticStorage) {
    this.size = storage.faceOwnerElementOrdinals.length;
  }

  get(key: string): FaceMetadata | undefined {
    const [elementId, faceIndex] = parseFaceIdentity(key);
    if (elementId === undefined || faceIndex === undefined) return undefined;
    const faceId = packedFaceOrdinal(this.storage, elementId, faceIndex);
    return faceId === undefined ? undefined : { face: packedFace(this.storage, faceId), faceId };
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  *entries(): IterableIterator<[string, FaceMetadata]> {
    for (let faceId = 0; faceId < this.size; faceId += 1) {
      const face = packedFace(this.storage, faceId);
      yield [faceIdentity(face.elementId, face.faceIndex), { face, faceId }];
    }
  }

  *keys(): IterableIterator<string> {
    for (const [key] of this.entries()) yield key;
  }

  *values(): IterableIterator<FaceMetadata> {
    for (const [, value] of this.entries()) yield value;
  }

  forEach(
    callbackfn: (value: FaceMetadata, key: string, map: SemanticMap<string, FaceMetadata>) => void,
  ): void {
    for (const [key, value] of this.entries()) {
      callbackfn(value, key, this);
    }
  }

  [Symbol.iterator](): IterableIterator<[string, FaceMetadata]> {
    return this.entries();
  }
}

class PackedEdgeMap implements SemanticMap<string, GeometryEdge> {
  readonly size: number;

  constructor(private readonly storage: PackedSemanticStorage) {
    this.size = Math.max(0, (storage.edgeNodeOffsets?.length ?? 1) - 1);
  }

  get(key: string): GeometryEdge | undefined {
    const ordinal = packedEdgeOrdinal(this.storage, key);
    return ordinal === undefined ? undefined : packedEdge(this.storage, ordinal);
  }

  has(key: string): boolean {
    return packedEdgeOrdinal(this.storage, key) !== undefined;
  }

  *entries(): IterableIterator<[string, GeometryEdge]> {
    for (let ordinal = 0; ordinal < this.size; ordinal += 1) {
      const edge = packedEdge(this.storage, ordinal);
      yield [edge.key, edge];
    }
  }

  *keys(): IterableIterator<string> {
    for (const [key] of this.entries()) yield key;
  }

  *values(): IterableIterator<GeometryEdge> {
    for (const [, value] of this.entries()) yield value;
  }

  forEach(
    callbackfn: (value: GeometryEdge, key: string, map: SemanticMap<string, GeometryEdge>) => void,
  ): void {
    for (const [key, value] of this.entries()) {
      callbackfn(value, key, this);
    }
  }

  [Symbol.iterator](): IterableIterator<[string, GeometryEdge]> {
    return this.entries();
  }
}

function parseFaceIdentity(key: string): readonly [number | undefined, number | undefined] {
  const separator = key.indexOf("/");
  if (separator < 1) return [undefined, undefined];
  const elementId = Number(key.slice(0, separator));
  const faceIndex = Number(key.slice(separator + 1));
  return Number.isInteger(elementId) && Number.isInteger(faceIndex)
    ? [elementId, faceIndex]
    : [undefined, undefined];
}
