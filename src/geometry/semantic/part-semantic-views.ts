import { ElementShape } from "../../elements/shapes";
import { canonicalKey } from "../../elements/keys";
import type { ElementTessellation, FaceTessellation, GeometryBody, GeometryEdge } from "../types";
import { primitiveForCode, type PartSemanticGraph } from "./part-semantic-graph";

const SHAPES = Object.values(ElementShape);

/** Materializes one immutable element query result from dense graph columns. */
export function graphElementAt(
  graph: PartSemanticGraph,
  ordinal: number,
): ElementTessellation | undefined {
  const id = graph.elementIds[ordinal];
  const first = graph.elementRangeOffsets[ordinal];
  const last = graph.elementRangeOffsets[ordinal + 1];
  if (id === undefined || first === undefined || last === undefined) return undefined;
  const primitiveRanges = [];
  for (let range = first; range < last; range += 1) {
    const primitive = primitiveForCode(graph.elementRangePrimitiveCodes[range] ?? -1);
    if (primitive === undefined) throw new Error(`Part graph has invalid range ${range}`);
    primitiveRanges.push(
      Object.freeze({
        primitive,
        primitiveStart: graph.elementRangeStarts[range] ?? 0,
        primitiveCount: graph.elementRangeCounts[range] ?? 0,
      }),
    );
  }
  const shapeCode = graph.elementShapeCodes[ordinal] ?? 0;
  const shape = shapeCode === 0 ? undefined : SHAPES[shapeCode - 1];
  const bodyId = graph.elementBodyIds[ordinal] ?? 0;
  return Object.freeze({
    id,
    primitiveRanges: Object.freeze(primitiveRanges),
    ...(shape === undefined ? {} : { shape }),
    ...(bodyId === 0 ? {} : { bodyId }),
  });
}

/** Materializes one immutable body query result from typed name and CSR columns. */
export function graphBodyAt(graph: PartSemanticGraph, ordinal: number): GeometryBody | undefined {
  const id = graph.bodyIds[ordinal];
  const first = graph.bodyElementOffsets[ordinal];
  const last = graph.bodyElementOffsets[ordinal + 1];
  if (id === undefined || first === undefined || last === undefined) return undefined;
  const elementIds = new Uint32Array(last - first);
  for (let index = first; index < last; index += 1) {
    elementIds[index - first] = graph.elementIds[graph.bodyElementOrdinals[index] ?? 0] ?? 0;
  }
  const name = graphBodyName(graph, ordinal);
  return Object.freeze({
    id,
    ...(name === undefined ? {} : { name }),
    elementIds: Object.freeze(Array.from(elementIds)),
  });
}

/** Materializes one immutable face query result from typed face columns. */
export function graphFaceAt(
  graph: PartSemanticGraph,
  ordinal: number,
): FaceTessellation | undefined {
  const owner = graph.faceOwnerElementOrdinals[ordinal];
  const first = graph.faceNodeOffsets[ordinal];
  const last = graph.faceNodeOffsets[ordinal + 1];
  if (owner === undefined || first === undefined || last === undefined) return undefined;
  const elementId = graph.elementIds[owner];
  if (elementId === undefined) return undefined;
  const nodeIds = Array.from(graph.faceNodeIds.subarray(first, last));
  const neighborOrdinal = graph.faceNeighborElementOrdinals[ordinal] ?? 0;
  const neighborElementId =
    neighborOrdinal === 0
      ? (graph.faceNeighborMissingIds[ordinal] ?? 0) || undefined
      : graph.elementIds[neighborOrdinal - 1];
  const bodyId = graph.faceBodyIds[ordinal] ?? 0;
  return Object.freeze({
    elementId,
    faceIndex: graph.faceIndices[ordinal] ?? 0,
    primitiveStart: graph.facePrimitiveStarts[ordinal] ?? 0,
    primitiveCount: graph.facePrimitiveCounts[ordinal] ?? 0,
    key: canonicalKey(nodeIds),
    nodeIds: Object.freeze(nodeIds),
    ...(neighborElementId === undefined ? {} : { neighborElementId }),
    ...(bodyId === 0 ? {} : { bodyId }),
  });
}

/** Materializes one immutable authored-edge result from CSR columns. */
export function graphEdgeAt(graph: PartSemanticGraph, ordinal: number): GeometryEdge | undefined {
  const firstNode = graph.edgeNodeOffsets[ordinal];
  const lastNode = graph.edgeNodeOffsets[ordinal + 1];
  const firstIncident = graph.edgeIncidentOffsets[ordinal];
  const lastIncident = graph.edgeIncidentOffsets[ordinal + 1];
  const firstFace = graph.edgeFaceOffsets[ordinal];
  const lastFace = graph.edgeFaceOffsets[ordinal + 1];
  if (
    firstNode === undefined ||
    lastNode === undefined ||
    firstIncident === undefined ||
    lastIncident === undefined ||
    firstFace === undefined ||
    lastFace === undefined
  ) {
    return undefined;
  }
  const nodeIds = Array.from(graph.edgeNodeIds.subarray(firstNode, lastNode));
  const incidentElementIds = new Uint32Array(lastIncident - firstIncident);
  for (let index = firstIncident; index < lastIncident; index += 1) {
    incidentElementIds[index - firstIncident] =
      graph.elementIds[graph.edgeIncidentElementOrdinals[index] ?? 0] ?? 0;
  }
  const faceRefs = [];
  for (let index = firstFace; index < lastFace; index += 1) {
    faceRefs.push(
      Object.freeze({
        elementId: graph.elementIds[graph.edgeFaceOwnerElementOrdinals[index] ?? 0] ?? 0,
        faceIndex: graph.edgeFaceIndices[index] ?? 0,
      }),
    );
  }
  return Object.freeze({
    key: canonicalKey(nodeIds),
    nodeIds: Object.freeze(nodeIds),
    incidentElementIds: Object.freeze(Array.from(incidentElementIds)),
    faceRefs: Object.freeze(faceRefs),
  });
}

function graphBodyName(graph: PartSemanticGraph, ordinal: number): string | undefined {
  if (graph.bodyNameDefined[ordinal] !== 1) return undefined;
  const first = graph.bodyNameOffsets[ordinal] ?? 0;
  const last = graph.bodyNameOffsets[ordinal + 1] ?? first;
  let value = "";
  for (let index = first; index < last; index += 1) {
    value += String.fromCharCode(graph.bodyNameText[index] ?? 0);
  }
  return value;
}
