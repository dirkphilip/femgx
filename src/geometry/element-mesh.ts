import { classifyFaces, facesOf, type ElementFace } from "../elements/faces";
import { edgesOf, uniqueEdges, type ElementEdge } from "../elements/edges";
import type { Element, ElementId, NodeId } from "../elements/element";
import type { ElementModel } from "../elements/model";
import { topologyFor, type ElementFamily } from "../elements/shapes";
import { computeBounds, type ElementTessellation, type Geometry, type Part } from "./part";
import type { PartId } from "../scene/types";
import { LineMeshBuilder, TriangleMeshBuilder } from "./mesh-builder";
import { average, cross, dot, length, quadraticPoint, subtract, type Vec3 } from "./vec-math";

/**
 * Tessellates an {@link ElementModel} into reusable part geometry per render
 * mode. Quadratic elements (Tet10/Hex20/LINE3) are never silently reduced to
 * linear geometry: faces are subdivided around their mid-edge nodes and curved
 * edges are drawn through the mid-edge node (or finer quadratic interpolation),
 * see `wiki/element-rendering.md` for the trade-offs.
 */

/** How an element family is drawn. */
export type ElementRenderMode = "solid" | "surface" | "edges" | "lines" | "points";

/** Tessellation knobs for quadratic elements. */
export interface TessellationOptions {
  /**
   * Line segments per quadratic edge (default `2`). Values below 2 clamp to 2
   * so the mid-edge node is always honored; linear edges stay a single segment.
   */
  readonly edgeSegments?: number;
}

/** Returns the render modes supported by an element family. */
export function elementRenderModes(family: ElementFamily): readonly ElementRenderMode[] {
  switch (family) {
    case "tet":
    case "hex":
      return ["solid", "surface", "edges"];
    case "line":
      return ["lines"];
    case "point":
      return ["points"];
  }
}

/** Builds a reusable part for one family/mode, with computed bounds. */
export function elementPart(
  partId: PartId,
  model: ElementModel,
  family: ElementFamily,
  mode: ElementRenderMode,
  options: TessellationOptions = {},
): Part {
  const geometry = elementGeometry(model, family, mode, options);
  return { id: partId, geometry, bounds: computeBounds(geometry) };
}

/**
 * Generates renderable geometry for an element model in the given mode.
 * `mode` must be supported by `family` (see {@link elementRenderModes}).
 */
export function elementGeometry(
  model: ElementModel,
  family: ElementFamily,
  mode: ElementRenderMode,
  options: TessellationOptions = {},
): Geometry {
  if (!elementRenderModes(family).includes(mode)) {
    throw new Error(`Render mode ${mode} is not supported for ${family} elements`);
  }
  const segments = Math.max(1, options.edgeSegments ?? 2);
  switch (mode) {
    case "solid":
    case "surface":
      return volumeGeometry(model, family, mode === "surface");
    case "edges":
      return edgeGeometry(model, family, segments);
    case "lines":
      return lineGeometry(model, segments);
    case "points":
      return pointGeometry(model);
  }
}

function volumeGeometry(
  model: ElementModel,
  family: ElementFamily,
  boundaryOnly: boolean,
): Geometry {
  const faces: ReadonlyArray<{ readonly element: Element; readonly face: ElementFace }> =
    boundaryOnly ? boundaryFaces(model, family) : allFaces(model, family);
  const mesh = new TriangleMeshBuilder();
  const elements: ElementTessellation[] = [];
  let current: { readonly id: ElementId; readonly start: number } | undefined;
  const flush = (): void => {
    if (current !== undefined) {
      elements.push({
        id: current.id,
        triangleStart: current.start,
        triangleCount: mesh.triangleCount - current.start,
      });
    }
  };
  for (const { element, face } of faces) {
    if (current === undefined || current.id !== element.id) {
      flush();
      current = { id: element.id, start: mesh.triangleCount };
    }
    for (const triangle of tessellateFace(model, element, face)) {
      mesh.append(triangle);
    }
  }
  flush();
  return mesh.build("triangles", elements);
}

function allFaces(
  model: ElementModel,
  family: ElementFamily,
): ReadonlyArray<{ readonly element: Element; readonly face: ElementFace }> {
  const faces: Array<{ readonly element: Element; readonly face: ElementFace }> = [];
  for (const element of elementsOf(model, family)) {
    for (const face of facesOf(element)) {
      faces.push({ element, face });
    }
  }
  return faces;
}

/**
 * Returns the boundary faces of a volume family: faces shared by exactly one
 * element. Interior faces (shared by two elements) are culled so hidden
 * internal geometry is never drawn.
 */
function boundaryFaces(
  model: ElementModel,
  family: ElementFamily,
): ReadonlyArray<{ readonly element: Element; readonly face: ElementFace }> {
  const elements = elementsOf(model, family);
  const elementById = new Map<ElementId, Element>();
  for (const element of elements) {
    elementById.set(element.id, element);
  }
  const boundary: Array<{ readonly element: Element; readonly face: ElementFace }> = [];
  for (const face of classifyFaces(elements)) {
    const element = elementById.get(face.elementId);
    if (face.boundary && element !== undefined) {
      boundary.push({ element, face });
    }
  }
  return boundary;
}

function edgeGeometry(model: ElementModel, family: ElementFamily, segments: number): Geometry {
  const mesh = new LineMeshBuilder();
  for (const edge of uniqueEdges(elementsOf(model, family))) {
    mesh.append(edgePoints(model, edge, segments));
  }
  return mesh.build("lines");
}

function lineGeometry(model: ElementModel, segments: number): Geometry {
  const mesh = new LineMeshBuilder();
  for (const element of elementsOf(model, "line")) {
    for (const edge of edgesOf(element)) {
      mesh.append(edgePoints(model, edge, segments));
    }
  }
  return mesh.build("lines");
}

function pointGeometry(model: ElementModel): Geometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const element of elementsOf(model, "point")) {
    const point = nodePosition(model, element.nodeIds[0] as NodeId);
    const base = positions.length / 3;
    positions.push(
      point[0],
      point[1],
      point[2],
      point[0],
      point[1],
      point[2],
      point[0],
      point[1],
      point[2],
      point[0],
      point[1],
      point[2],
    );
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    primitive: "points",
  };
}

function elementsOf(model: ElementModel, family: ElementFamily): readonly Element[] {
  return model.elements.filter((element) => element.shape.family === family);
}

/**
 * Splits an interleaved face loop (corners and mid-edge nodes alternating,
 * starting with a corner) into separate corner and mid-edge node arrays.
 */
function faceNodeIds(
  element: Element,
  face: ElementFace,
): { readonly cornerNodeIds: readonly NodeId[]; readonly midNodeIds: readonly NodeId[] } {
  const nodeIds = face.nodeIds;
  if (topologyFor(element.shape).order < 2) {
    return { cornerNodeIds: nodeIds, midNodeIds: [] };
  }
  const cornerNodeIds: NodeId[] = [];
  const midNodeIds: NodeId[] = [];
  nodeIds.forEach((nodeId, index) => {
    if (index % 2 === 0) {
      cornerNodeIds.push(nodeId);
    } else {
      midNodeIds.push(nodeId);
    }
  });
  return { cornerNodeIds, midNodeIds };
}

/** Subdivides a face into triangles, each wound to face outward. */
function tessellateFace(
  model: ElementModel,
  element: Element,
  face: ElementFace,
): ReadonlyArray<readonly [Vec3, Vec3, Vec3]> {
  const { cornerNodeIds, midNodeIds } = faceNodeIds(element, face);
  const corners = cornerNodeIds.map((id) => nodePosition(model, id));
  const outward = outwardDirection(model, element, corners);
  if (midNodeIds.length === 0) {
    const triangles: Array<readonly [Vec3, Vec3, Vec3]> = [];
    for (let i = 1; i < corners.length - 1; i += 1) {
      triangles.push(
        orient(outward, corners[0] as Vec3, corners[i] as Vec3, corners[i + 1] as Vec3),
      );
    }
    return triangles;
  }
  const mids = midNodeIds.map((id) => nodePosition(model, id));
  if (corners.length === 3) {
    return quadraticTriangle(corners, mids, outward);
  }
  return quadraticQuad(corners, mids, outward);
}

function quadraticTriangle(
  corners: readonly Vec3[],
  mids: readonly Vec3[],
  outward: Vec3,
): ReadonlyArray<readonly [Vec3, Vec3, Vec3]> {
  const [a, b, c] = corners as readonly [Vec3, Vec3, Vec3];
  const [mab, mbc, mca] = mids as readonly [Vec3, Vec3, Vec3];
  return [
    orient(outward, a, mab, mca),
    orient(outward, b, mbc, mab),
    orient(outward, c, mca, mbc),
    orient(outward, mab, mbc, mca),
  ];
}

function quadraticQuad(
  corners: readonly Vec3[],
  mids: readonly Vec3[],
  outward: Vec3,
): ReadonlyArray<readonly [Vec3, Vec3, Vec3]> {
  const [a, b, c, d] = corners as readonly [Vec3, Vec3, Vec3, Vec3];
  const [mab, mbc, mcd, mda] = mids as readonly [Vec3, Vec3, Vec3, Vec3];
  const center = average([...corners, ...mids]);
  const pairs: ReadonlyArray<readonly [Vec3, Vec3]> = [
    [a, mab],
    [mab, b],
    [b, mbc],
    [mbc, c],
    [c, mcd],
    [mcd, d],
    [d, mda],
    [mda, a],
  ];
  return pairs.map(([from, to]) => orient(outward, center, from, to));
}

/** Returns the interpolated control points of an edge (corners + mid node). */
function edgePoints(model: ElementModel, edge: ElementEdge, segments: number): readonly Vec3[] {
  const first = edge.nodeIds[0];
  const last = edge.nodeIds[edge.nodeIds.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error("Edge must have at least two nodes");
  }
  const a = nodePosition(model, first);
  const b = nodePosition(model, last);
  if (edge.nodeIds.length === 2) {
    return [a, b];
  }
  const midNodeId = edge.nodeIds[1];
  if (midNodeId === undefined) {
    throw new Error("Quadratic edge must carry its mid-edge node");
  }
  const mid = nodePosition(model, midNodeId);
  const count = Math.max(2, segments);
  const points: Vec3[] = [];
  for (let step = 0; step <= count; step += 1) {
    const t = step / count;
    points.push(quadraticPoint(a, mid, b, t));
  }
  return points;
}

/** Direction from the element interior toward the face (for outward winding). */
function outwardDirection(model: ElementModel, element: Element, corners: readonly Vec3[]): Vec3 {
  const elementCentroid = average(element.nodeIds.map((id) => nodePosition(model, id)));
  const faceCentroid = average(corners);
  const outward = subtract(faceCentroid, elementCentroid);
  return length(outward) > 0 ? outward : faceNormal(corners);
}

/** Wraps a triangle so its geometric normal aligns with `outward`. */
function orient(outward: Vec3, a: Vec3, b: Vec3, c: Vec3): readonly [Vec3, Vec3, Vec3] {
  return dot(cross(subtract(b, a), subtract(c, a)), outward) < 0 ? [a, c, b] : [a, b, c];
}

function nodePosition(model: ElementModel, nodeId: NodeId): Vec3 {
  const offset = nodeId * 3;
  const x = model.nodes[offset];
  if (x === undefined) {
    throw new Error(`Model has no position for node ${nodeId}`);
  }
  return [x, model.nodes[offset + 1] ?? 0, model.nodes[offset + 2] ?? 0];
}

function faceNormal(corners: readonly Vec3[]): Vec3 {
  const [a, b, c] = corners as readonly [Vec3, Vec3, Vec3];
  return cross(subtract(b, a), subtract(c, a));
}
