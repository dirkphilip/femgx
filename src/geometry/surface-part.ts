import type { ElementId, NodeId } from "../elements/element";
import { at } from "../elements/indices";
import { canonicalKey } from "../elements/keys";
import { mergeAuthoredEdges, type AuthoredEdgeOccurrence } from "./authored-edges";
import { bodyAssignments } from "./part-validation";
import {
  createPart,
  type ElementPrimitiveRange,
  type ElementTessellation,
  type FaceTessellation,
  type Geometry,
  type GeometryEdge,
  type LineGeometry,
  type Part,
  type PartId,
  type PointGeometry,
  type Primitive,
  type TriangleGeometry,
} from "./part";
import {
  validateSurfacePartInput,
  type SurfaceFacetRecord,
  type SurfaceLineRecord,
  type SurfacePartInput,
} from "./surface-part-input";

interface MutableElement {
  readonly id: ElementId;
  readonly primitiveRanges: ElementPrimitiveRange[];
}

export { SurfacePartError } from "./polygon-triangulation";
export type { SurfacePartValidationCode } from "./polygon-triangulation";
export type { SurfacePartInput } from "./surface-part-input";

/**
 * Compiles compact host-reduced facets, lines, and points into one mixed Part.
 * Connectivity is copied into renderer-owned typed buffers and may be released
 * by the caller after this function returns.
 * @category Scene and geometry
 */
export function surfacePart(partId: PartId, input: SurfacePartInput): Part {
  const { positions, facets, lines, points } = validateSurfacePartInput(input);
  const bodyByElement = bodyAssignments(elementIds(facets, lines, points), input.bodies);
  const elements = new Map<ElementId, MutableElement>();
  const geometries: Geometry[] = [];
  if (facets.length > 0) {
    geometries.push(buildFacetGeometry(facets, positions, elements, bodyByElement));
  }
  if (lines.length > 0) geometries.push(buildLineGeometry(lines, positions, elements));
  if (points.length > 0) geometries.push(buildPointGeometry(points, positions, elements));
  if (geometries.length === 0) geometries.push(emptyTriangleGeometry());
  return createPart(partId, {
    geometries,
    elements: finalizeElements(elements, bodyByElement),
    nodePositions: positions,
    bodies: input.bodies ?? [],
  });
}

function buildFacetGeometry(
  records: readonly SurfaceFacetRecord[],
  positions: Float32Array,
  elements: Map<ElementId, MutableElement>,
  bodyByElement: ReadonlyMap<ElementId, number>,
): TriangleGeometry {
  const nodeIndices = new Uint32Array(
    records.reduce((count, record) => count + record.triangles.length * 3, 0),
  );
  let indexOffset = 0;
  const faces: FaceTessellation[] = [];
  for (const record of records) {
    const primitiveStart = indexOffset / 3;
    for (const triangle of record.triangles) {
      for (const nodeId of triangle) nodeIndices[indexOffset++] = nodeId;
    }
    const primitiveCount = indexOffset / 3 - primitiveStart;
    addElementRange(elements, record.elementId, "triangles", primitiveStart, primitiveCount);
    const face: FaceTessellation = {
      elementId: record.elementId,
      faceIndex: record.faceIndex,
      primitiveStart,
      primitiveCount,
      key: canonicalKey(record.nodeIds),
      nodeIds: record.nodeIds,
      neighborElementIds: record.neighbors,
    };
    const bodyId = bodyByElement.get(record.elementId);
    faces.push(bodyId === undefined ? face : { ...face, bodyId });
  }
  return {
    ...compactGeometry("triangles", nodeIndices, positions),
    faces,
    edges: edgesForFacets(records),
  };
}

function buildLineGeometry(
  records: readonly SurfaceLineRecord[],
  positions: Float32Array,
  elements: Map<ElementId, MutableElement>,
): LineGeometry {
  const nodeIndices = new Uint32Array(
    records.reduce((count, record) => count + (record.nodeIds.length - 1) * 2, 0),
  );
  let indexOffset = 0;
  for (const record of records) {
    const primitiveStart = indexOffset / 2;
    for (let index = 0; index < record.nodeIds.length - 1; index += 1) {
      nodeIndices[indexOffset++] = at(record.nodeIds, index);
      nodeIndices[indexOffset++] = at(record.nodeIds, index + 1);
    }
    addElementRange(
      elements,
      record.elementId,
      "lines",
      primitiveStart,
      indexOffset / 2 - primitiveStart,
    );
  }
  return { ...compactGeometry("lines", nodeIndices, positions), edges: edgesForLines(records) };
}

function buildPointGeometry(
  records: readonly SurfaceLineRecord[],
  positions: Float32Array,
  elements: Map<ElementId, MutableElement>,
): PointGeometry {
  const nodeIndices = Uint32Array.from(records, (record) => at(record.nodeIds, 0));
  records.forEach((record, index) => {
    addElementRange(elements, record.elementId, "points", index, 1);
  });
  return compactGeometry("points", nodeIndices, positions);
}

function compactGeometry(
  primitive: "triangles",
  nodeIndices: Uint32Array,
  nodePositions: Float32Array,
): TriangleGeometry;
function compactGeometry(
  primitive: "lines",
  nodeIndices: Uint32Array,
  nodePositions: Float32Array,
): LineGeometry;
function compactGeometry(
  primitive: "points",
  nodeIndices: Uint32Array,
  nodePositions: Float32Array,
): PointGeometry;
function compactGeometry(
  primitive: Primitive,
  nodeIndices: Uint32Array,
  nodePositions: Float32Array,
): Geometry {
  const vertexByNode = new Map<NodeId, number>();
  for (const nodeId of nodeIndices) {
    if (!vertexByNode.has(nodeId)) vertexByNode.set(nodeId, vertexByNode.size);
  }
  const positions = new Float32Array(vertexByNode.size * 3);
  const nodePickIds = new Uint32Array(vertexByNode.size);
  for (const [nodeId, vertex] of vertexByNode) {
    positions.set(nodePositions.subarray(nodeId * 3, nodeId * 3 + 3), vertex * 3);
    nodePickIds[vertex] = nodeId + 1;
  }
  const indices = Uint32Array.from(nodeIndices, (nodeId) => {
    const vertex = vertexByNode.get(nodeId);
    if (vertex === undefined) throw new Error(`Surface node ${nodeId} has no compact vertex`);
    return vertex;
  });
  if (primitive === "triangles") return { primitive, positions, indices, nodePickIds };
  if (primitive === "lines") return { primitive, positions, indices, nodePickIds };
  return { primitive, positions, indices, nodePickIds };
}

function addElementRange(
  elements: Map<ElementId, MutableElement>,
  id: ElementId,
  primitive: Primitive,
  primitiveStart: number,
  primitiveCount: number,
): void {
  const element = elements.get(id) ?? { id, primitiveRanges: [] };
  const previous = element.primitiveRanges.at(-1);
  if (
    previous?.primitive === primitive &&
    previous.primitiveStart + previous.primitiveCount === primitiveStart
  ) {
    element.primitiveRanges[element.primitiveRanges.length - 1] = {
      ...previous,
      primitiveCount: previous.primitiveCount + primitiveCount,
    };
  } else {
    element.primitiveRanges.push({ primitive, primitiveStart, primitiveCount });
  }
  elements.set(id, element);
}

function finalizeElements(
  elements: ReadonlyMap<ElementId, MutableElement>,
  bodyByElement: ReadonlyMap<ElementId, number>,
): readonly ElementTessellation[] {
  const ordered = [...elements.values()].sort((left, right) => left.id - right.id);
  return ordered.map((element) => {
    const bodyId = bodyByElement.get(element.id);
    return bodyId === undefined ? element : { ...element, bodyId };
  });
}

function edgesForFacets(records: readonly SurfaceFacetRecord[]): readonly GeometryEdge[] {
  const edges: AuthoredEdgeOccurrence[] = [];
  for (const record of records) {
    const step = record.quadratic ? 2 : 1;
    for (let index = 0; index < record.nodeIds.length; index += step) {
      const next = (index + step) % record.nodeIds.length;
      const nodeIds = record.quadratic
        ? [at(record.nodeIds, index), at(record.nodeIds, index + 1), at(record.nodeIds, next)]
        : [at(record.nodeIds, index), at(record.nodeIds, next)];
      edges.push({
        nodeIds,
        elementId: record.elementId,
        faceRefs: [{ elementId: record.elementId, faceIndex: record.faceIndex }],
      });
    }
  }
  return mergeAuthoredEdges(edges);
}

function elementIds(
  facets: readonly SurfaceFacetRecord[],
  lines: readonly SurfaceLineRecord[],
  points: readonly SurfaceLineRecord[],
): readonly Pick<ElementTessellation, "id">[] {
  return [...new Set([...facets, ...lines, ...points].map((record) => record.elementId))]
    .sort((left, right) => left - right)
    .map((id) => ({ id }));
}

function edgesForLines(records: readonly SurfaceLineRecord[]): readonly GeometryEdge[] {
  return mergeAuthoredEdges(
    records.map((record) => ({ nodeIds: record.nodeIds, elementId: record.elementId })),
  );
}

function emptyTriangleGeometry(): TriangleGeometry {
  return {
    primitive: "triangles",
    positions: new Float32Array(),
    indices: new Uint32Array(),
    nodePickIds: new Uint32Array(),
  };
}
