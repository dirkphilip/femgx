import { canonicalKey } from "../../elements/keys";
import type { ElementId, NodeId } from "../../elements/element";
import type { FaceIdRef } from "../../elements/faces";
import type { EdgeKey } from "../../elements/edges";
import type { ElementShape } from "../../elements/shapes";
import type {
  ElementPrimitiveRange,
  ElementTessellation,
  FaceTessellation,
  GeometryBody,
  GeometryEdge,
  Primitive,
} from "../types";

/**
 * Internal packed semantic tables shared by dense producers and renderer
 * consumers. All ordinals are zero-based; public ids remain one-based.
 */
export interface PackedSemanticStorage {
  readonly primitive: Primitive;
  readonly elementIds: Uint32Array;
  readonly elementPrimitiveStarts: Uint32Array;
  readonly elementPrimitiveCounts: Uint32Array;
  /** Face ordinal ranges for each element; length is element count + 1. */
  readonly elementFaceOffsets?: Uint32Array;
  /** Optional sorted ordinals for arbitrary, non-contiguous element ids. */
  readonly elementIdOrdinalsSorted?: Uint32Array;
  /** Set by a validated producer only when ids are exactly ordinal + 1. */
  readonly elementIdsOneBasedContiguous?: boolean;
  readonly elementShape?: ElementShape;
  readonly elementShapes?: readonly ElementShape[];
  readonly elementBodyIds?: Uint32Array;
  readonly faceOwnerElementOrdinals: Uint32Array;
  readonly faceIndices: Uint32Array;
  readonly facePrimitiveStarts: Uint32Array;
  readonly facePrimitiveCounts: Uint32Array;
  /**
   * One-based neighboring element ordinals; zero is the no-neighbor sentinel.
   * Keeping this ordinal separate from element ids avoids a per-face id map.
   */
  readonly faceNeighborElementOrdinals: Uint32Array;
  readonly faceNodeOffsets: Uint32Array;
  readonly faceNodeIds: Uint32Array;
  readonly edgeNodeOffsets?: Uint32Array;
  readonly edgeNodeIds?: Uint32Array;
  readonly edgeIncidentOffsets?: Uint32Array;
  readonly edgeIncidentElementOrdinals?: Uint32Array;
  readonly edgeFaceOffsets?: Uint32Array;
  readonly edgeFaceOwnerElementOrdinals?: Uint32Array;
  readonly edgeFaceIndices?: Uint32Array;
  readonly faceSubsetOrdinals?: Uint32Array;
  readonly bodies?: readonly GeometryBody[];
  readonly nodeCount: number;
}

interface CachedDescriptors {
  readonly elements: Map<number, ElementTessellation>;
  readonly faces: Map<number, FaceTessellation>;
  readonly edges: Map<number, GeometryEdge>;
}

const storageByPart = new WeakMap<object, PackedSemanticStorage>();
const storageByGeometry = new WeakMap<object, PackedSemanticStorage>();
const descriptorsByStorage = new WeakMap<object, CachedDescriptors>();
const edgeOrdinalByKey = new WeakMap<PackedSemanticStorage, Map<string, number>>();

/** Associates packed semantic tables with one internal Part identity. */
export function registerPackedSemanticStorage(part: object, storage: PackedSemanticStorage): void {
  storageByPart.set(part, storage);
}

/** Returns packed semantic tables, when a Part was built by the internal factory. */
export function packedSemanticStorage(part: object): PackedSemanticStorage | undefined {
  return storageByPart.get(part);
}

/** Associates a packed table with its triangle geometry for renderer helpers. */
export function registerPackedSemanticGeometry(
  geometry: object,
  storage: PackedSemanticStorage,
): void {
  storageByGeometry.set(geometry, storage);
}

/** Returns packed tables for a geometry owned by an internal packed Part. */
export function packedSemanticStorageForGeometry(
  geometry: object,
): PackedSemanticStorage | undefined {
  return storageByGeometry.get(geometry);
}

/** Exposes allocation-free materialization state to focused internal tests. */
export function packedSemanticMaterializationCounts(storage: PackedSemanticStorage): {
  readonly elements: number;
  readonly faces: number;
  readonly edges: number;
} {
  const cached = descriptorsByStorage.get(storage);
  return {
    elements: cached?.elements.size ?? 0,
    faces: cached?.faces.size ?? 0,
    edges: cached?.edges.size ?? 0,
  };
}

/** Returns the stable descriptor cache used only by explicit public access. */
function descriptorCache(storage: PackedSemanticStorage): CachedDescriptors {
  const cached = descriptorsByStorage.get(storage);
  if (cached !== undefined) return cached;
  const next: CachedDescriptors = { elements: new Map(), faces: new Map(), edges: new Map() };
  descriptorsByStorage.set(storage, next);
  return next;
}

/** Materializes one element descriptor for a public array/map access. */
export function packedElement(
  storage: PackedSemanticStorage,
  ordinal: number,
): ElementTessellation {
  const cached = descriptorCache(storage).elements.get(ordinal);
  if (cached !== undefined) return cached;
  const descriptor = packedElementDescriptor(storage, ordinal);
  descriptorCache(storage).elements.set(ordinal, descriptor);
  return descriptor;
}

/** Builds one public element view without retaining it in the descriptor cache. */
export function packedElementTransient(
  storage: PackedSemanticStorage,
  ordinal: number,
): ElementTessellation {
  return packedElementDescriptor(storage, ordinal);
}

function packedElementDescriptor(
  storage: PackedSemanticStorage,
  ordinal: number,
): ElementTessellation {
  const id = storage.elementIds[ordinal] ?? 0;
  const primitiveRanges: readonly ElementPrimitiveRange[] = [
    {
      primitive: storage.primitive,
      primitiveStart: storage.elementPrimitiveStarts[ordinal] ?? 0,
      primitiveCount: storage.elementPrimitiveCounts[ordinal] ?? 0,
    },
  ];
  const bodyId = storage.elementBodyIds?.[ordinal];
  const shape = storage.elementShapes?.[ordinal] ?? storage.elementShape;
  return {
    id,
    primitiveRanges,
    ...(shape === undefined ? {} : { shape }),
    ...(bodyId === undefined || bodyId === 0 ? {} : { bodyId }),
  };
}

/** Materializes one face descriptor for a public array/map access. */
export function packedFace(storage: PackedSemanticStorage, ordinal: number): FaceTessellation {
  const cached = descriptorCache(storage).faces.get(ordinal);
  if (cached !== undefined) return cached;
  const ownerOrdinal = storage.faceOwnerElementOrdinals[ordinal] ?? 0;
  const elementId = storage.elementIds[ownerOrdinal] ?? 0;
  const nodeStart = storage.faceNodeOffsets[ordinal] ?? 0;
  const nodeEnd = storage.faceNodeOffsets[ordinal + 1] ?? nodeStart;
  const nodeIds = Array.from(storage.faceNodeIds.subarray(nodeStart, nodeEnd)) as readonly NodeId[];
  const neighborOrdinal = storage.faceNeighborElementOrdinals[ordinal] ?? 0;
  const neighborElementId =
    neighborOrdinal === 0 ? undefined : (storage.elementIds[neighborOrdinal - 1] ?? undefined);
  const bodyId = storage.elementBodyIds?.[ownerOrdinal];
  const descriptor: FaceTessellation = {
    elementId,
    faceIndex: storage.faceIndices[ordinal] ?? 0,
    primitiveStart: storage.facePrimitiveStarts[ordinal] ?? 0,
    primitiveCount: storage.facePrimitiveCounts[ordinal] ?? 0,
    key: canonicalKey(Array.from(nodeIds)),
    nodeIds,
    ...(neighborElementId === undefined ? {} : { neighborElementId }),
    ...(bodyId === undefined || bodyId === 0 ? {} : { bodyId }),
  };
  descriptorCache(storage).faces.set(ordinal, descriptor);
  return descriptor;
}

/** Materializes one edge descriptor for explicit authored-edge access. */
export function packedEdge(storage: PackedSemanticStorage, ordinal: number): GeometryEdge {
  const cached = descriptorCache(storage).edges.get(ordinal);
  if (cached !== undefined) return cached;
  const nodeStart = storage.edgeNodeOffsets?.[ordinal] ?? 0;
  const nodeEnd = storage.edgeNodeOffsets?.[ordinal + 1] ?? nodeStart;
  const nodeIds = Array.from(
    storage.edgeNodeIds?.subarray(nodeStart, nodeEnd) ?? new Uint32Array(),
  ) as readonly NodeId[];
  const incidentStart = storage.edgeIncidentOffsets?.[ordinal] ?? 0;
  const incidentEnd = storage.edgeIncidentOffsets?.[ordinal + 1] ?? incidentStart;
  const faceStart = storage.edgeFaceOffsets?.[ordinal] ?? 0;
  const faceEnd = storage.edgeFaceOffsets?.[ordinal + 1] ?? faceStart;
  const incidentElementIds = Array.from(
    storage.edgeIncidentElementOrdinals?.subarray(incidentStart, incidentEnd) ?? [],
    (elementOrdinal) => storage.elementIds[elementOrdinal] ?? 0,
  );
  const faceRefs = Array.from({ length: faceEnd - faceStart }, (_, index) => {
    const reference = faceStart + index;
    const ownerOrdinal = storage.edgeFaceOwnerElementOrdinals?.[reference] ?? 0;
    return {
      elementId: storage.elementIds[ownerOrdinal] ?? 0,
      faceIndex: storage.edgeFaceIndices?.[reference] ?? 0,
    };
  });
  const descriptor: GeometryEdge = {
    key: canonicalKey(Array.from(nodeIds)),
    nodeIds,
    incidentElementIds,
    faceRefs,
  };
  descriptorCache(storage).edges.set(ordinal, descriptor);
  return descriptor;
}

/** Returns the public face subset, materializing only the usually small subset. */
export function packedFaceSubset(storage: PackedSemanticStorage): readonly FaceIdRef[] {
  return Array.from(storage.faceSubsetOrdinals ?? [], (ordinal) => {
    return packedFaceIdentity(storage, ordinal);
  });
}

/** Creates an array-compatible lazy descriptor view for public Part access. */
export function lazyPackedArray<T>(length: number, get: (ordinal: number) => T): readonly T[] {
  const target: T[] = [];
  target.length = length;
  const isIndex = (property: PropertyKey): property is string =>
    typeof property === "string" && /^(?:0|[1-9]\d*)$/u.test(property);
  return new Proxy(target, {
    get(array, property, receiver) {
      if (isIndex(property)) {
        const ordinal = Number(property);
        if (ordinal >= length) return undefined;
        return get(ordinal);
      }
      const value: unknown = Reflect.get(array, property, receiver);
      return value;
    },
    has(array, property) {
      if (isIndex(property)) return Number(property) < length;
      return Reflect.has(array, property);
    },
    ownKeys() {
      if (!Reflect.isExtensible(target)) return ["length"];
      return ["length", ...Array.from({ length }, (_, ordinal) => String(ordinal))];
    },
    getOwnPropertyDescriptor(array, property) {
      if (property === "length") return Reflect.getOwnPropertyDescriptor(array, property);
      if (Reflect.isExtensible(array) && isIndex(property) && Number(property) < length) {
        return { enumerable: true, configurable: true };
      }
      return undefined;
    },
  });
}

/** Finds a packed face ordinal by its stable element/face identity. */
export function packedFaceOrdinal(
  storage: PackedSemanticStorage,
  elementId: ElementId,
  faceIndex: number,
): number | undefined {
  const elementOrdinal = packedElementOrdinal(storage, elementId);
  if (elementOrdinal === undefined) return undefined;
  const first = storage.elementFaceOffsets?.[elementOrdinal] ?? 0;
  const last =
    storage.elementFaceOffsets?.[elementOrdinal + 1] ?? storage.faceOwnerElementOrdinals.length;
  for (let ordinal = first; ordinal < last; ordinal += 1) {
    const owner = storage.faceOwnerElementOrdinals[ordinal] ?? 0;
    if (owner === elementOrdinal && storage.faceIndices[ordinal] === faceIndex) {
      return ordinal;
    }
  }
  return undefined;
}

/** Finds a packed edge ordinal, building its string index only on edge use. */
export function packedEdgeOrdinal(
  storage: PackedSemanticStorage,
  key: EdgeKey,
): number | undefined {
  let index = edgeOrdinalByKey.get(storage);
  if (index === undefined) {
    index = new Map<string, number>();
    const edgeCount = Math.max(0, (storage.edgeNodeOffsets?.length ?? 1) - 1);
    for (let ordinal = 0; ordinal < edgeCount; ordinal += 1) {
      const start = storage.edgeNodeOffsets?.[ordinal] ?? 0;
      const end = storage.edgeNodeOffsets?.[ordinal + 1] ?? start;
      const nodeIds = Array.from(storage.edgeNodeIds?.subarray(start, end) ?? []);
      index.set(canonicalKey(nodeIds), ordinal);
    }
    edgeOrdinalByKey.set(storage, index);
  }
  return index.get(key);
}

/** Returns an element ordinal without retaining a numeric id map. */
export function packedElementOrdinal(
  storage: PackedSemanticStorage,
  elementId: ElementId,
): number | undefined {
  if (storage.elementIdsOneBasedContiguous === true) {
    const ordinal = elementId - 1;
    return ordinal >= 0 && ordinal < storage.elementIds.length ? ordinal : undefined;
  }
  const sorted = storage.elementIdOrdinalsSorted;
  if (sorted !== undefined) {
    let low = 0;
    let high = sorted.length - 1;
    while (low <= high) {
      const middle = low + Math.floor((high - low) / 2);
      const ordinal = sorted[middle] ?? 0;
      const candidate = storage.elementIds[ordinal] ?? 0;
      if (candidate === elementId) return ordinal;
      if (candidate < elementId) low = middle + 1;
      else high = middle - 1;
    }
    return undefined;
  }
  for (let ordinal = 0; ordinal < storage.elementIds.length; ordinal += 1) {
    if (storage.elementIds[ordinal] === elementId) return ordinal;
  }
  return undefined;
}

/** Returns a stable packed face identity without allocating a descriptor. */
export function packedFaceIdentity(
  storage: PackedSemanticStorage,
  faceOrdinal: number,
): { readonly elementId: ElementId; readonly faceIndex: number } {
  const owner = storage.faceOwnerElementOrdinals[faceOrdinal] ?? 0;
  return {
    elementId: storage.elementIds[owner] ?? 0,
    faceIndex: storage.faceIndices[faceOrdinal] ?? 0,
  };
}
