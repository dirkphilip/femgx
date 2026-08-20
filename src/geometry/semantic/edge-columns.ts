import { ordinalForId } from "../../elements/model-storage";
import type { GeometryEdge, GeometryInput } from "../types";

export interface EdgeColumns {
  readonly edgeGeometryOrdinals: Uint8Array;
  readonly edgeNodeOffsets: Uint32Array;
  readonly edgeNodeIds: Uint32Array;
  readonly edgeIncidentOffsets: Uint32Array;
  readonly edgeIncidentElementOrdinals: Uint32Array;
  readonly edgeFaceOffsets: Uint32Array;
  readonly edgeFaceOwnerElementOrdinals: Uint32Array;
  readonly edgeFaceIndices: Uint32Array;
  readonly edgeIndexHeads: Int32Array;
  readonly edgeIndexNext: Int32Array;
  readonly edgeIndexHashes: Uint32Array;
}

/** Builds edge columns without retaining edge descriptor records. */
export function buildEdgeColumns(
  geometries: readonly GeometryInput[],
  elementIds: Uint32Array,
  elementIdOrdinals: Uint32Array,
): EdgeColumns {
  const sizes = edgeColumnSizes(geometries);
  const columns = allocateEdgeColumns(sizes.edges, sizes.nodes, sizes.incidents, sizes.faces);
  fillEdgeColumns(columns, geometries, elementIds, elementIdOrdinals);
  return completeEdgeColumns(columns);
}

/** Completes direct compiler edge columns with their typed lookup index. */
export function completeEdgeColumns(
  columns: Omit<EdgeColumns, "edgeIndexHeads" | "edgeIndexNext" | "edgeIndexHashes">,
): EdgeColumns {
  return { ...columns, ...edgeLookup(columns) };
}

function edgeLookup(
  columns: Omit<EdgeColumns, "edgeIndexHeads" | "edgeIndexNext" | "edgeIndexHashes">,
): {
  readonly edgeIndexHeads: Int32Array;
  readonly edgeIndexNext: Int32Array;
  readonly edgeIndexHashes: Uint32Array;
} {
  const count = columns.edgeNodeOffsets.length - 1;
  let capacity = 1;
  while (capacity < Math.max(1, Math.ceil(count / 0.7))) capacity *= 2;
  const edgeIndexHeads = new Int32Array(capacity).fill(-1);
  const edgeIndexNext = new Int32Array(count).fill(-1);
  const edgeIndexHashes = new Uint32Array(count);
  for (let edge = count - 1; edge >= 0; edge -= 1) {
    const hash = hashEdge(
      columns.edgeNodeIds,
      columns.edgeNodeOffsets[edge] ?? 0,
      columns.edgeNodeOffsets[edge + 1] ?? 0,
    );
    edgeIndexHashes[edge] = hash;
    const slot = hash & (capacity - 1);
    edgeIndexNext[edge] = edgeIndexHeads[slot] ?? -1;
    edgeIndexHeads[slot] = edge;
  }
  return { edgeIndexHeads, edgeIndexNext, edgeIndexHashes };
}

function hashEdge(ids: Uint32Array, first: number, last: number): number {
  let hash = 2_166_136_261;
  const firstId = ids[first] ?? 0;
  const secondId = ids[first + 1] ?? 0;
  const thirdId = last - first === 3 ? (ids[first + 2] ?? 0) : undefined;
  const low = Math.min(firstId, secondId, thirdId ?? firstId);
  const high = Math.max(firstId, secondId, thirdId ?? secondId);
  const middle = thirdId === undefined ? undefined : firstId + secondId + thirdId - low - high;
  hash = Math.imul(hash ^ low, 16_777_619) >>> 0;
  if (middle !== undefined) hash = Math.imul(hash ^ middle, 16_777_619) >>> 0;
  hash = Math.imul(hash ^ high, 16_777_619) >>> 0;
  return hash;
}

function edgeColumnSizes(geometries: readonly GeometryInput[]): {
  readonly edges: number;
  readonly nodes: number;
  readonly incidents: number;
  readonly faces: number;
} {
  let edges = 0;
  let nodes = 0;
  let incidents = 0;
  let faces = 0;
  for (const geometry of geometries) {
    for (const edge of geometry.edges ?? []) {
      edges += 1;
      nodes += edge.nodeIds.length;
      incidents += edge.incidentElementIds.length;
      faces += edge.faceRefs.length;
    }
  }
  return { edges, nodes, incidents, faces };
}

function allocateEdgeColumns(
  edgeCount: number,
  nodeCount: number,
  incidentCount: number,
  faceCount: number,
): Omit<EdgeColumns, "edgeIndexHeads" | "edgeIndexNext" | "edgeIndexHashes"> {
  return {
    edgeGeometryOrdinals: new Uint8Array(edgeCount),
    edgeNodeOffsets: new Uint32Array(edgeCount + 1),
    edgeNodeIds: new Uint32Array(nodeCount),
    edgeIncidentOffsets: new Uint32Array(edgeCount + 1),
    edgeIncidentElementOrdinals: new Uint32Array(incidentCount),
    edgeFaceOffsets: new Uint32Array(edgeCount + 1),
    edgeFaceOwnerElementOrdinals: new Uint32Array(faceCount),
    edgeFaceIndices: new Uint32Array(faceCount),
  };
}

function fillEdgeColumns(
  columns: Omit<EdgeColumns, "edgeIndexHeads" | "edgeIndexNext" | "edgeIndexHashes">,
  geometries: readonly GeometryInput[],
  elementIds: Uint32Array,
  elementIdOrdinals: Uint32Array,
): void {
  const cursor = { edge: 0, node: 0, incident: 0, face: 0 };
  for (let geometryOrdinal = 0; geometryOrdinal < geometries.length; geometryOrdinal += 1) {
    for (const edge of geometries[geometryOrdinal]?.edges ?? []) {
      fillEdge(columns, cursor, geometryOrdinal, edge, {
        ids: elementIds,
        ordinals: elementIdOrdinals,
      });
    }
  }
  columns.edgeNodeOffsets[cursor.edge] = cursor.node;
  columns.edgeIncidentOffsets[cursor.edge] = cursor.incident;
  columns.edgeFaceOffsets[cursor.edge] = cursor.face;
}

function fillEdge(
  columns: Omit<EdgeColumns, "edgeIndexHeads" | "edgeIndexNext" | "edgeIndexHashes">,
  cursor: { edge: number; node: number; incident: number; face: number },
  geometryOrdinal: number,
  edge: GeometryEdge,
  lookup: { readonly ids: Uint32Array; readonly ordinals: Uint32Array },
): void {
  columns.edgeGeometryOrdinals[cursor.edge] = geometryOrdinal;
  columns.edgeNodeOffsets[cursor.edge] = cursor.node;
  columns.edgeNodeIds.set(edge.nodeIds, cursor.node);
  cursor.node += edge.nodeIds.length;
  columns.edgeIncidentOffsets[cursor.edge] = cursor.incident;
  for (const id of edge.incidentElementIds) {
    const ordinal = ordinalForId(lookup.ids, lookup.ordinals, id);
    if (ordinal === undefined) throw new Error(`Edge references unknown element ${id}`);
    columns.edgeIncidentElementOrdinals[cursor.incident] = ordinal;
    cursor.incident += 1;
  }
  columns.edgeFaceOffsets[cursor.edge] = cursor.face;
  for (const reference of edge.faceRefs) {
    const ordinal = ordinalForId(lookup.ids, lookup.ordinals, reference.elementId);
    if (ordinal === undefined)
      throw new Error(`Edge references unknown element ${reference.elementId}`);
    columns.edgeFaceOwnerElementOrdinals[cursor.face] = ordinal;
    columns.edgeFaceIndices[cursor.face] = reference.faceIndex;
    cursor.face += 1;
  }
  cursor.edge += 1;
}
