import {
  classifyFaces,
  facesOf,
  facesOfElement,
  type ElementFace,
  type FaceKey,
} from "../elements/faces";
import { edgesOf, uniqueEdges, type ElementEdge } from "../elements/edges";
import type { Element, ElementId, NodeId } from "../elements/element";
import type { ElementModel } from "../elements/model";
import type { ElementFamily } from "../elements/shapes";
import {
  computeBounds,
  type ElementTessellation,
  type FaceTessellation,
  type Geometry,
  type Part,
} from "./part";
import type { PartId } from "../scene/types";
import { tessellateFace } from "./face-tessellation";
import { LineMeshBuilder, TriangleMeshBuilder, type MeshVertex } from "./mesh-builder";
import { quadraticPoint, type Vec3 } from "./vec-math";

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
  const faces: ReadonlyArray<{
    readonly element: Element;
    readonly face: ElementFace;
    readonly faceIndex: number;
  }> = boundaryOnly ? boundaryFaces(model, family) : allFaces(model, family);
  const neighbors = faceNeighbors(elementsOf(model, family));
  const mesh = new TriangleMeshBuilder();
  const elements: ElementTessellation[] = [];
  const faceTessellations: FaceTessellation[] = [];
  const nodePositions: number[] = [...model.nodes];
  let current: { readonly id: ElementId; readonly start: number } | undefined;
  let faceId = 0;
  const flush = (): void => {
    if (current !== undefined) {
      elements.push({
        id: current.id,
        triangleStart: current.start,
        triangleCount: mesh.triangleCount - current.start,
      });
    }
  };
  for (const { element, face, faceIndex } of faces) {
    if (current === undefined || current.id !== element.id) {
      flush();
      current = { id: element.id, start: mesh.triangleCount };
    }
    for (const triangle of tessellateFace(model, element, face)) {
      mesh.append(triangle, faceId + 1);
    }
    faceTessellations.push({
      id: faceId,
      elementId: element.id,
      faceIndex,
      key: face.key,
      nodeIds: face.nodeIds,
      neighborElementIds: (neighbors.get(face.key) ?? []).filter((id) => id !== element.id),
    });
    faceId += 1;
  }
  flush();
  return mesh.build("triangles", elements, faceTessellations, nodePositions);
}

function allFaces(
  model: ElementModel,
  family: ElementFamily,
): ReadonlyArray<{
  readonly element: Element;
  readonly face: ElementFace;
  readonly faceIndex: number;
}> {
  const faces: Array<{
    readonly element: Element;
    readonly face: ElementFace;
    readonly faceIndex: number;
  }> = [];
  for (const element of elementsOf(model, family)) {
    for (const { face, faceIndex } of facesOfElement(element)) {
      faces.push({ element, face, faceIndex });
    }
  }
  return faces;
}

/** Maps every canonical face key to the elements incident to it. */
function faceNeighbors(elements: readonly Element[]): Map<FaceKey, ElementId[]> {
  const neighbors = new Map<FaceKey, ElementId[]>();
  for (const element of elements) {
    for (const face of facesOf(element)) {
      const list = neighbors.get(face.key);
      if (list === undefined) neighbors.set(face.key, [element.id]);
      else list.push(element.id);
    }
  }
  return neighbors;
}

/**
 * Returns the boundary faces of a volume family: faces shared by exactly one
 * element. Interior faces (shared by two elements) are culled so hidden
 * internal geometry is never drawn.
 */
function boundaryFaces(
  model: ElementModel,
  family: ElementFamily,
): ReadonlyArray<{
  readonly element: Element;
  readonly face: ElementFace;
  readonly faceIndex: number;
}> {
  const elements = elementsOf(model, family);
  const elementById = new Map<ElementId, Element>();
  const faceIndexByElement = new Map<ElementId, Map<FaceKey, number>>();
  for (const element of elements) {
    elementById.set(element.id, element);
    const indexByKey = new Map<FaceKey, number>();
    for (const { face, faceIndex } of facesOfElement(element)) {
      indexByKey.set(face.key, faceIndex);
    }
    faceIndexByElement.set(element.id, indexByKey);
  }
  const boundary: Array<{
    readonly element: Element;
    readonly face: ElementFace;
    readonly faceIndex: number;
  }> = [];
  for (const face of classifyFaces(elements)) {
    const element = elementById.get(face.elementId);
    if (!face.boundary || element === undefined) continue;
    const faceIndex = faceIndexByElement.get(element.id)?.get(face.key);
    if (faceIndex === undefined) {
      throw new Error(`Element ${element.id} has no face index for ${face.key}`);
    }
    boundary.push({ element, face: { key: face.key, nodeIds: face.nodeIds }, faceIndex });
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
  const nodePickIds: number[] = [];
  for (const element of elementsOf(model, "point")) {
    const nodeId = element.nodeIds[0];
    if (nodeId === undefined) {
      throw new Error("Point element must reference exactly one node");
    }
    const point = nodePosition(model, nodeId);
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
    nodePickIds.push(nodeId + 1, nodeId + 1, nodeId + 1, nodeId + 1);
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    primitive: "points",
    nodePickIds: new Uint32Array(nodePickIds),
  };
}

function elementsOf(model: ElementModel, family: ElementFamily): readonly Element[] {
  return model.elements.filter((element) => element.shape.family === family);
}

/**
 * Tessellates one element face into triangles in model space, each wound to
 * face outward. Shared with the picking subsystem so face picking resolves
 * against exactly the surface the renderer draws.
 */
export function faceTriangles(
  model: ElementModel,
  element: Element,
  face: ElementFace,
): ReadonlyArray<readonly [Vec3, Vec3, Vec3]> {
  return tessellateFace(model, element, face).map(
    (triangle) => [triangle[0].point, triangle[1].point, triangle[2].point] as const,
  );
}

/** Returns the interpolated control points of an edge (corners + mid node). */
function edgePoints(
  model: ElementModel,
  edge: ElementEdge,
  segments: number,
): readonly MeshVertex[] {
  const first = edge.nodeIds[0];
  const last = edge.nodeIds[edge.nodeIds.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error("Edge must have at least two nodes");
  }
  const a = nodePosition(model, first);
  const b = nodePosition(model, last);
  if (edge.nodeIds.length === 2) {
    return [
      { point: a, nodeId: first },
      { point: b, nodeId: last },
    ];
  }
  const midNodeId = edge.nodeIds[1];
  if (midNodeId === undefined) {
    throw new Error("Quadratic edge must carry its mid-edge node");
  }
  const mid = nodePosition(model, midNodeId);
  const count = Math.max(2, segments);
  const points: MeshVertex[] = [];
  for (let step = 0; step <= count; step += 1) {
    const t = step / count;
    let nodeId: number | undefined;
    if (step === 0) nodeId = first;
    else if (step === count) nodeId = last;
    else if (count % 2 === 0 && step === count / 2) nodeId = midNodeId;
    points.push({ point: quadraticPoint(a, mid, b, t), nodeId });
  }
  return points;
}

function nodePosition(model: ElementModel, nodeId: NodeId): Vec3 {
  const offset = nodeId * 3;
  const x = model.nodes[offset];
  if (x === undefined) {
    throw new Error(`Model has no position for node ${nodeId}`);
  }
  return [x, model.nodes[offset + 1] ?? 0, model.nodes[offset + 2] ?? 0];
}
