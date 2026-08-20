import type { SurfaceFacetColumns, SurfaceLineColumns } from "../explicit-topology/input";
import type { DirectEdgeSources } from "./direct-edge-columns";

export interface DirectEdgeCandidates {
  readonly nodeOffsets: Uint32Array;
  readonly nodeIds: Uint32Array;
  readonly incidentElementIds: Uint32Array;
  readonly faceOffsets: Uint32Array;
  readonly faceElementIds: Uint32Array;
  readonly faceIndices: Uint32Array;
}

/** Builds sorted, deduplicated facet edges without descriptor records. */
export function surfaceFacetEdgeSources(columns: SurfaceFacetColumns): DirectEdgeSources {
  let edges = 0;
  let nodes = 0;
  for (let record = 0; record < columns.count; record += 1) {
    const start = columns.nodeOffsets[record] ?? 0;
    const end = columns.nodeOffsets[record + 1] ?? start;
    const count = (end - start) / ((columns.quadratic[record] ?? 0) === 1 ? 2 : 1);
    edges += count;
    nodes += count * ((columns.quadratic[record] ?? 0) === 1 ? 3 : 2);
  }
  const candidates = createDirectEdgeCandidates(edges, nodes, edges);
  let edge = 0;
  let node = 0;
  for (let record = 0; record < columns.count; record += 1) {
    const start = columns.nodeOffsets[record] ?? 0;
    const end = columns.nodeOffsets[record + 1] ?? start;
    const length = end - start;
    const quadratic = (columns.quadratic[record] ?? 0) === 1;
    const stride = quadratic ? 2 : 1;
    for (let index = 0; index < length; index += stride) {
      const next = (index + stride) % length;
      candidates.nodeOffsets[edge] = node;
      node = quadratic
        ? appendQuadratic(
            candidates.nodeIds,
            node,
            columns.nodeIds[start + index] ?? 0,
            columns.nodeIds[start + index + 1] ?? 0,
            columns.nodeIds[start + next] ?? 0,
          )
        : appendLinear(
            candidates.nodeIds,
            node,
            columns.nodeIds[start + index] ?? 0,
            columns.nodeIds[start + next] ?? 0,
          );
      candidates.incidentElementIds[edge] = columns.elementIds[record] ?? 0;
      candidates.faceOffsets[edge] = edge;
      candidates.faceElementIds[edge] = columns.elementIds[record] ?? 0;
      candidates.faceIndices[edge] = columns.faceIndices[record] ?? 0;
      edge += 1;
    }
  }
  candidates.nodeOffsets[edge] = node;
  candidates.faceOffsets[edge] = edge;
  return directEdgeSources(candidates);
}

/** Builds sorted, deduplicated line edges without descriptor records. */
export function surfaceLineEdgeSources(columns: SurfaceLineColumns): DirectEdgeSources {
  const candidates = createDirectEdgeCandidates(columns.count, columns.nodeIds.length, 0);
  let node = 0;
  for (let edge = 0; edge < columns.count; edge += 1) {
    const start = columns.nodeOffsets[edge] ?? 0;
    const end = columns.nodeOffsets[edge + 1] ?? start;
    candidates.nodeOffsets[edge] = node;
    node = appendSequence(candidates.nodeIds, node, columns.nodeIds, start, end);
    candidates.incidentElementIds[edge] = columns.elementIds[edge] ?? 0;
  }
  candidates.nodeOffsets[columns.count] = node;
  return directEdgeSources(candidates);
}

/** Merges per-geometry typed edge sources into one Part graph source layout. */
export function mergeSurfaceEdgeSources(
  builds: readonly {
    readonly edges?: DirectEdgeSources;
    readonly edgeSources?: DirectEdgeSources;
  }[],
): DirectEdgeSources | undefined {
  let edges = 0;
  let nodes = 0;
  let incidents = 0;
  let faces = 0;
  for (const build of builds) {
    const source = build.edges ?? build.edgeSources;
    if (source === undefined) continue;
    edges += source.geometryOrdinals.length;
    nodes += source.nodeIds.length;
    incidents += source.incidentElementIds.length;
    faces += source.faceElementIds.length;
  }
  if (edges === 0) return undefined;
  const result = emptySources(edges, nodes, incidents, faces);
  let edge = 0;
  let node = 0;
  let incident = 0;
  let face = 0;
  for (let geometry = 0; geometry < builds.length; geometry += 1) {
    const source = builds[geometry]?.edges ?? builds[geometry]?.edgeSources;
    if (source === undefined) continue;
    for (let index = 0; index < source.geometryOrdinals.length; index += 1) {
      const nodeStart = source.nodeOffsets[index] ?? 0;
      const nodeEnd = source.nodeOffsets[index + 1] ?? nodeStart;
      const incidentStart = source.incidentOffsets[index] ?? 0;
      const incidentEnd = source.incidentOffsets[index + 1] ?? incidentStart;
      const faceStart = source.faceOffsets[index] ?? 0;
      const faceEnd = source.faceOffsets[index + 1] ?? faceStart;
      result.geometryOrdinals[edge] = geometry;
      result.nodeOffsets[edge] = node;
      result.nodeIds.set(source.nodeIds.subarray(nodeStart, nodeEnd), node);
      result.incidentOffsets[edge] = incident;
      result.incidentElementIds.set(
        source.incidentElementIds.subarray(incidentStart, incidentEnd),
        incident,
      );
      result.faceOffsets[edge] = face;
      result.faceElementIds.set(source.faceElementIds.subarray(faceStart, faceEnd), face);
      result.faceIndices.set(source.faceIndices.subarray(faceStart, faceEnd), face);
      node += nodeEnd - nodeStart;
      incident += incidentEnd - incidentStart;
      face += faceEnd - faceStart;
      edge += 1;
    }
  }
  result.nodeOffsets[edge] = node;
  result.incidentOffsets[edge] = incident;
  result.faceOffsets[edge] = face;
  return result;
}

/** Deduplicates typed candidate rows through a sorted ordinal index and CSR columns. */
export function directEdgeSources(candidates: DirectEdgeCandidates): DirectEdgeSources {
  const order = sortedCandidates(candidates);
  const sizes = sourceSizes(candidates, order);
  const result = emptySources(sizes.edges, sizes.nodes, sizes.incidents, sizes.faces);
  fillSources(result, candidates, order);
  return result;
}

/** Allocates transient typed candidate columns for one direct edge producer. */
export function createDirectEdgeCandidates(
  edges: number,
  nodes: number,
  faces: number,
): DirectEdgeCandidates {
  return {
    nodeOffsets: new Uint32Array(edges + 1),
    nodeIds: new Uint32Array(nodes),
    incidentElementIds: new Uint32Array(edges),
    faceOffsets: new Uint32Array(edges + 1),
    faceElementIds: new Uint32Array(faces),
    faceIndices: new Uint32Array(faces),
  };
}

function appendLinear(target: Uint32Array, offset: number, first: number, last: number): number {
  target[offset] = first <= last ? first : last;
  target[offset + 1] = first <= last ? last : first;
  return offset + 2;
}

function appendQuadratic(
  target: Uint32Array,
  offset: number,
  first: number,
  middle: number,
  last: number,
): number {
  target[offset] = first <= last ? first : last;
  target[offset + 1] = middle;
  target[offset + 2] = first <= last ? last : first;
  return offset + 3;
}

function appendSequence(
  target: Uint32Array,
  offset: number,
  nodes: Uint32Array,
  start: number,
  end: number,
): number {
  const length = end - start;
  const first = nodes[start] ?? 0;
  const last = nodes[end - 1] ?? 0;
  if (first <= last) target.set(nodes.subarray(start, end), offset);
  else {
    target[offset] = last;
    for (let index = 1; index < length - 1; index += 1)
      target[offset + index] = nodes[start + index] ?? 0;
    target[offset + length - 1] = first;
  }
  return offset + length;
}

function sortedCandidates(candidates: DirectEdgeCandidates): Uint32Array {
  const result = new Uint32Array(candidates.incidentElementIds.length);
  const scratch = new Uint32Array(result.length);
  for (let index = 0; index < result.length; index += 1) result[index] = index;
  for (let width = 1; width < result.length; width *= 2) {
    for (let start = 0; start < result.length; start += width * 2) {
      const middle = Math.min(start + width, result.length);
      const end = Math.min(start + width * 2, result.length);
      let left = start;
      let right = middle;
      for (let output = start; output < end; output += 1) {
        const leftValue = result[left] ?? 0;
        const rightValue = result[right] ?? 0;
        if (
          left < middle &&
          (right >= end || compareCandidates(candidates, leftValue, rightValue) <= 0)
        ) {
          scratch[output] = leftValue;
          left += 1;
        } else {
          scratch[output] = rightValue;
          right += 1;
        }
      }
    }
    result.set(scratch);
  }
  return result;
}

function compareCandidates(candidates: DirectEdgeCandidates, left: number, right: number): number {
  const nodes = compareNodes(candidates, left, right);
  if (nodes !== 0) return nodes;
  const incidents =
    (candidates.incidentElementIds[left] ?? 0) - (candidates.incidentElementIds[right] ?? 0);
  if (incidents !== 0) return incidents;
  const leftFace = candidates.faceOffsets[left] ?? 0;
  const rightFace = candidates.faceOffsets[right] ?? 0;
  return (
    (candidates.faceElementIds[leftFace] ?? 0) - (candidates.faceElementIds[rightFace] ?? 0) ||
    (candidates.faceIndices[leftFace] ?? 0) - (candidates.faceIndices[rightFace] ?? 0)
  );
}

function compareNodes(candidates: DirectEdgeCandidates, left: number, right: number): number {
  const leftStart = candidates.nodeOffsets[left] ?? 0;
  const leftEnd = candidates.nodeOffsets[left + 1] ?? leftStart;
  const rightStart = candidates.nodeOffsets[right] ?? 0;
  const rightEnd = candidates.nodeOffsets[right + 1] ?? rightStart;
  const length = Math.min(leftEnd - leftStart, rightEnd - rightStart);
  for (let offset = 0; offset < length; offset += 1) {
    const difference =
      (candidates.nodeIds[leftStart + offset] ?? 0) -
      (candidates.nodeIds[rightStart + offset] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftEnd - leftStart - (rightEnd - rightStart);
}

function sourceSizes(
  candidates: DirectEdgeCandidates,
  order: Uint32Array,
): {
  readonly edges: number;
  readonly nodes: number;
  readonly incidents: number;
  readonly faces: number;
} {
  let edges = 0;
  let nodes = 0;
  let incidents = 0;
  let faces = 0;
  let previous = -1;
  let previousIncident = -1;
  let previousFaceElement = -1;
  let previousFaceIndex = -1;
  for (const candidate of order) {
    if (previous < 0 || compareNodes(candidates, previous, candidate) !== 0) {
      edges += 1;
      const start = candidates.nodeOffsets[candidate] ?? 0;
      const end = candidates.nodeOffsets[candidate + 1] ?? start;
      nodes += end - start;
      previousIncident = -1;
      previousFaceElement = -1;
      previousFaceIndex = -1;
    }
    const incident = candidates.incidentElementIds[candidate] ?? 0;
    if (incident !== previousIncident) incidents += 1;
    const firstFace = candidates.faceOffsets[candidate] ?? 0;
    const lastFace = candidates.faceOffsets[candidate + 1] ?? firstFace;
    for (let face = firstFace; face < lastFace; face += 1) {
      const element = candidates.faceElementIds[face] ?? 0;
      const index = candidates.faceIndices[face] ?? 0;
      if (element !== previousFaceElement || index !== previousFaceIndex) faces += 1;
      previousFaceElement = element;
      previousFaceIndex = index;
    }
    previousIncident = incident;
    previous = candidate;
  }
  return { edges, nodes, incidents, faces };
}

function fillSources(
  result: DirectEdgeSources,
  candidates: DirectEdgeCandidates,
  order: Uint32Array,
): void {
  let edge = 0;
  let node = 0;
  let incident = 0;
  let face = 0;
  let previous = -1;
  let previousIncident = -1;
  let previousFaceElement = -1;
  let previousFaceIndex = -1;
  for (const candidate of order) {
    const newEdge = previous < 0 || compareNodes(candidates, previous, candidate) !== 0;
    if (newEdge) {
      if (edge > 0) {
        result.nodeOffsets[edge] = node;
        result.incidentOffsets[edge] = incident;
        result.faceOffsets[edge] = face;
      }
      const start = candidates.nodeOffsets[candidate] ?? 0;
      const end = candidates.nodeOffsets[candidate + 1] ?? start;
      result.nodeIds.set(candidates.nodeIds.subarray(start, end), node);
      node += end - start;
      edge += 1;
      previousIncident = -1;
      previousFaceElement = -1;
      previousFaceIndex = -1;
    }
    const candidateIncident = candidates.incidentElementIds[candidate] ?? 0;
    if (candidateIncident !== previousIncident)
      result.incidentElementIds[incident++] = candidateIncident;
    const firstFace = candidates.faceOffsets[candidate] ?? 0;
    const lastFace = candidates.faceOffsets[candidate + 1] ?? firstFace;
    for (let candidateFace = firstFace; candidateFace < lastFace; candidateFace += 1) {
      const element = candidates.faceElementIds[candidateFace] ?? 0;
      const index = candidates.faceIndices[candidateFace] ?? 0;
      if (element !== previousFaceElement || index !== previousFaceIndex) {
        result.faceElementIds[face] = element;
        result.faceIndices[face] = index;
        face += 1;
      }
      previousFaceElement = element;
      previousFaceIndex = index;
    }
    previousIncident = candidateIncident;
    previous = candidate;
  }
  result.nodeOffsets[edge] = node;
  result.incidentOffsets[edge] = incident;
  result.faceOffsets[edge] = face;
}

function emptySources(
  edges: number,
  nodes: number,
  incidents: number,
  faces: number,
): DirectEdgeSources {
  return {
    geometryOrdinals: new Uint8Array(edges),
    nodeOffsets: new Uint32Array(edges + 1),
    nodeIds: new Uint32Array(nodes),
    incidentOffsets: new Uint32Array(edges + 1),
    incidentElementIds: new Uint32Array(incidents),
    faceOffsets: new Uint32Array(edges + 1),
    faceElementIds: new Uint32Array(faces),
    faceIndices: new Uint32Array(faces),
  };
}
