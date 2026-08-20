import type { Primitive } from "../types";

/** Private canonical dense semantic columns owned by an FE-aware Part. */
export interface PartSemanticGraph {
  readonly elementIds: Uint32Array;
  readonly elementIdOrdinals: Uint32Array;
  readonly elementShapeCodes: Uint8Array;
  readonly elementBodyIds: Uint32Array;
  /** Sorted body ids with at least one triangle-owned element range. */
  readonly surfaceBodyIds: Uint32Array;
  readonly elementRangeOffsets: Uint32Array;
  readonly elementRangeGeometryOrdinals: Uint8Array;
  readonly elementRangePrimitiveCodes: Uint8Array;
  readonly elementRangeStarts: Uint32Array;
  readonly elementRangeCounts: Uint32Array;
  readonly bodyIds: Uint32Array;
  readonly bodyIdOrdinals: Uint32Array;
  readonly bodyNameDefined: Uint8Array;
  readonly bodyNameOffsets: Uint32Array;
  readonly bodyNameText: Uint16Array;
  readonly bodyElementOffsets: Uint32Array;
  readonly bodyElementOrdinals: Uint32Array;
  readonly faceGeometryOrdinals: Uint8Array;
  /** CSR rows grouping graph faces by retained geometry ordinal. */
  readonly faceGeometryOffsets: Uint32Array;
  readonly faceOwnerElementOrdinals: Uint32Array;
  readonly faceIndices: Uint32Array;
  readonly facePrimitiveStarts: Uint32Array;
  readonly facePrimitiveCounts: Uint32Array;
  readonly faceNeighborElementOrdinals: Uint32Array;
  /** A face named a non-local neighbor; retained to preserve dense fallback rules. */
  readonly faceNeighborMissing: Uint8Array;
  /** Stable neighbor ids that are external to this Part's element table. */
  readonly faceNeighborMissingIds: Uint32Array;
  readonly faceBodyIds: Uint32Array;
  readonly faceNodeOffsets: Uint32Array;
  readonly faceNodeIds: Uint32Array;
  /** Face rows sorted by owner element ordinal and authored face index. */
  readonly faceLookupOrdinals: Uint32Array;
  readonly edgeGeometryOrdinals: Uint8Array;
  /** CSR rows grouping graph edges by retained geometry ordinal. */
  readonly edgeGeometryOffsets: Uint32Array;
  readonly edgeNodeOffsets: Uint32Array;
  readonly edgeNodeIds: Uint32Array;
  readonly edgeIncidentOffsets: Uint32Array;
  readonly edgeIncidentElementOrdinals: Uint32Array;
  readonly edgeFaceOffsets: Uint32Array;
  readonly edgeFaceOwnerElementOrdinals: Uint32Array;
  readonly edgeFaceIndices: Uint32Array;
  /** Collision-resolving typed edge lookup; graph owns one immutable index. */
  readonly edgeIndexHeads: Int32Array;
  readonly edgeIndexNext: Int32Array;
  readonly edgeIndexHashes: Uint32Array;
  readonly faceSubsetOffsets: Uint32Array;
  readonly faceSubsetOrdinals: Uint32Array;
  readonly faceSubsetDefined: Uint8Array;
}

const graphByPart = new WeakMap<object, PartSemanticGraph>();
const graphByGeometry = new WeakMap<object, PartGeometrySemantic>();

/** Private semantic ownership for one retained geometry leaf. */
export interface PartGeometrySemantic {
  readonly graph: PartSemanticGraph;
  readonly geometryOrdinal: number;
}

/** Registers the only retained FE semantic representation for a validated Part. */
export function registerPartSemanticGraph(part: object, graph: PartSemanticGraph): void {
  graphByPart.set(part, graph);
}

/** Returns the canonical graph, absent for raw display/GLB Parts. */
export function partSemanticGraph(part: object): PartSemanticGraph | undefined {
  return graphByPart.get(part);
}

/** Associates one retained geometry leaf with its owning part graph row. */
export function registerPartGeometrySemantic(
  geometry: object,
  graph: PartSemanticGraph,
  geometryOrdinal: number,
): void {
  graphByGeometry.set(geometry, { graph, geometryOrdinal });
}

/** Returns the graph owner for a geometry leaf, absent for raw display geometry. */
export function geometrySemanticGraph(geometry: object): PartGeometrySemantic | undefined {
  return graphByGeometry.get(geometry);
}

/** Converts primitive names into compact per-range codes. */
export function primitiveCode(primitive: Primitive): number {
  switch (primitive) {
    case "triangles":
      return 0;
    case "lines":
      return 1;
    case "points":
      return 2;
  }
}

/** Resolves a compact primitive code without exposing graph storage. */
export function primitiveForCode(code: number): Primitive | undefined {
  switch (code) {
    case 0:
      return "triangles";
    case 1:
      return "lines";
    case 2:
      return "points";
    default:
      return undefined;
  }
}

/** Resolves a stable element id through the graph's compact sorted index. */
export function graphElementOrdinal(graph: PartSemanticGraph, id: number): number | undefined {
  let low = 0;
  let high = graph.elementIdOrdinals.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const ordinal = graph.elementIdOrdinals[middle] ?? 0;
    const candidate = graph.elementIds[ordinal] ?? 0;
    if (candidate === id) return ordinal;
    if (candidate < id) low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
}

/** Resolves one authored face through the graph's element/face lookup order. */
export function graphFaceOrdinal(
  graph: PartSemanticGraph,
  elementId: number,
  faceIndex: number,
): number | undefined {
  const elementOrdinal = graphElementOrdinal(graph, elementId);
  if (elementOrdinal === undefined) return undefined;
  let low = 0;
  let high = graph.faceLookupOrdinals.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const face = graph.faceLookupOrdinals[middle] ?? 0;
    const owner = graph.faceOwnerElementOrdinals[face] ?? 0;
    const candidateIndex = graph.faceIndices[face] ?? 0;
    if (owner === elementOrdinal && candidateIndex === faceIndex) return face;
    if (owner < elementOrdinal || (owner === elementOrdinal && candidateIndex < faceIndex))
      low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
}

/** Resolves an authored edge through the immutable collision-resolving graph index. */
export function graphEdgeOrdinal(graph: PartSemanticGraph, key: string): number | undefined {
  const hash = hashEdgeKey(key);
  for (
    let ordinal = graph.edgeIndexHeads[hash & (graph.edgeIndexHeads.length - 1)] ?? -1;
    ordinal !== -1;
    ordinal = graph.edgeIndexNext[ordinal] ?? -1
  ) {
    if (graph.edgeIndexHashes[ordinal] === hash && graphEdgeKeyMatches(graph, ordinal, key)) {
      return ordinal;
    }
  }
  return undefined;
}

function graphEdgeKeyMatches(graph: PartSemanticGraph, ordinal: number, key: string): boolean {
  const first = graph.edgeNodeOffsets[ordinal] ?? 0;
  const last = graph.edgeNodeOffsets[ordinal + 1] ?? first;
  const parsed = parseEdgeKey(key);
  if (parsed === undefined || last - first !== parsed.count) return false;
  const firstId = graph.edgeNodeIds[first] ?? 0;
  const secondId = graph.edgeNodeIds[first + 1] ?? 0;
  const thirdId = parsed.count === 3 ? (graph.edgeNodeIds[first + 2] ?? 0) : undefined;
  const low = Math.min(firstId, secondId, thirdId ?? firstId);
  const high = Math.max(firstId, secondId, thirdId ?? secondId);
  const middle = thirdId === undefined ? undefined : firstId + secondId + thirdId - low - high;
  return (
    low === parsed.low && high === parsed.high && (middle === undefined || middle === parsed.middle)
  );
}

function hashEdgeKey(key: string): number {
  const parsed = parseEdgeKey(key);
  if (parsed === undefined) return 0;
  let hash = Math.imul(2_166_136_261 ^ parsed.low, 16_777_619) >>> 0;
  if (parsed.middle !== undefined) hash = Math.imul(hash ^ parsed.middle, 16_777_619) >>> 0;
  return Math.imul(hash ^ parsed.high, 16_777_619) >>> 0;
}

function parseEdgeKey(key: string):
  | {
      readonly count: number;
      readonly low: number;
      readonly middle?: number;
      readonly high: number;
    }
  | undefined {
  const firstEnd = key.indexOf(",");
  if (firstEnd <= 0) return undefined;
  const secondEnd = key.indexOf(",", firstEnd + 1);
  const first = Number(key.slice(0, firstEnd));
  const second = Number(key.slice(firstEnd + 1, secondEnd === -1 ? key.length : secondEnd));
  const third = secondEnd === -1 ? undefined : Number(key.slice(secondEnd + 1));
  if (
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(second) ||
    (third !== undefined && !Number.isSafeInteger(third))
  ) {
    return undefined;
  }
  const low = Math.min(first, second, third ?? first);
  const high = Math.max(first, second, third ?? second);
  return {
    count: third === undefined ? 2 : 3,
    low,
    ...(third === undefined ? {} : { middle: first + second + third - low - high }),
    high,
  };
}
