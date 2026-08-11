import { type FaceIdRef, type ElementFace } from "../elements/faces";
import { edgesOf, uniqueEdges, type ElementEdge } from "../elements/edges";
import type { Element, ElementId, NodeId } from "../elements/element";
import type { ElementModel } from "../elements/model";
import type { ElementFamily } from "../elements/shapes";
import {
  computeBounds,
  type FaceId,
  type FaceSubset,
  type ElementTessellation,
  type Body,
  type BodyId,
  type FaceTessellation,
  type Geometry,
  type Part,
  validateElements,
  validatePickIds,
  validateBodies,
} from "./part";
import type { PartId } from "../scene/types";
import { tessellateFace } from "./face-tessellation";
import { LineMeshBuilder, TriangleMeshBuilder, type MeshVertex } from "./mesh-builder";
import { quadraticPoint, type Vec3 } from "./vec-math";
import {
  allFaces,
  boundaryFaces,
  elementsOf,
  faceIdentity,
  faceNeighbors,
  validateFaceSelection,
  type ElementRenderFace,
} from "./element-face-selection";

/**
 * Tessellates an {@link ElementModel} into reusable part geometry per render
 * mode. Quadratic elements (Tet10/Hex20/LINE3) are never silently reduced to
 * linear geometry: faces are subdivided around their mid-edge nodes and curved
 * edges are drawn through the mid-edge node (or finer quadratic interpolation),
 * see `wiki/element-rendering.md` for the trade-offs.
 */

/** How an element family is drawn. Filled surface shapes accept solid/surface. */
export type ElementRenderMode = "solid" | "surface" | "edges" | "lines" | "points";

/** Tessellation knobs for quadratic elements. */
export interface TessellationOptions {
  /**
   * Line segments per quadratic edge (default `2`). Values below 2 clamp to 2
   * so the mid-edge node is always honored; linear edges stay a single segment.
   */
  readonly edgeSegments?: number;
  /** Optional stable body metadata for the generated triangle part. */
  readonly bodies?: readonly Body[];
  /** Optional element-face identities to draw in solid/surface modes. */
  readonly faceSubset?: readonly FaceIdRef[];
}

/** Returns the render modes supported by an element family. */
export function elementRenderModes(family: ElementFamily): readonly ElementRenderMode[] {
  switch (family) {
    case "triangle":
    case "quad":
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
  if (options.faceSubset !== undefined && mode !== "solid" && mode !== "surface") {
    throw new Error("faceSubset is supported only for solid and surface modes");
  }
  const segments = Math.max(1, options.edgeSegments ?? 2);
  switch (mode) {
    case "solid":
    case "surface":
      return volumeGeometry(model, family, options.bodies, options.faceSubset);
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
  bodies: readonly Body[] | undefined,
  faceSubset: readonly FaceIdRef[] | undefined,
): Geometry {
  const bodyIds = bodyAssignments(model, bodies);
  const selected =
    faceSubset === undefined ? undefined : validateFaceSelection(model, family, faceSubset);
  const faces = selected === undefined ? boundaryFaces(model, family) : allFaces(model, family);
  const neighbors = faceNeighbors(elementsOf(model, family));
  const tessellation = tessellateVolumeFaces(model, faces, neighbors, bodyIds, selected);
  const subset = selected === undefined ? undefined : { faceIds: tessellation.selectedFaceIds };
  return buildVolumeGeometry({
    ...tessellation,
    bodies,
    faceSubset: subset,
  });
}

interface VolumeGeometryOptions {
  readonly mesh: TriangleMeshBuilder;
  readonly elements: readonly ElementTessellation[];
  readonly faces: readonly FaceTessellation[];
  readonly nodePositions: readonly number[];
  readonly bodies: readonly Body[] | undefined;
  readonly faceSubset: FaceSubset | undefined;
}

interface VolumeTessellation {
  readonly mesh: TriangleMeshBuilder;
  readonly elements: readonly ElementTessellation[];
  readonly faces: readonly FaceTessellation[];
  readonly nodePositions: readonly number[];
  readonly selectedFaceIds: readonly FaceId[];
}

function tessellateVolumeFaces(
  model: ElementModel,
  faces: readonly ElementRenderFace[],
  neighbors: ReadonlyMap<string, readonly ElementId[]>,
  bodyIds: ReadonlyMap<ElementId, BodyId>,
  selected: ReadonlySet<string> | undefined,
): VolumeTessellation {
  const mesh = new TriangleMeshBuilder();
  const elements: ElementTessellation[] = [];
  const faceTessellations: FaceTessellation[] = [];
  const nodePositions: number[] = [...model.nodes];
  const selectedFaceIds: FaceId[] = [];
  let current: { readonly id: ElementId; readonly start: number } | undefined;
  let faceId = 0;
  const flush = (): void => {
    if (current === undefined) return;
    const tessellation: ElementTessellation = {
      id: current.id,
      triangleStart: current.start,
      triangleCount: mesh.triangleCount - current.start,
    };
    const bodyId = bodyIds.get(current.id);
    elements.push(bodyId === undefined ? tessellation : { ...tessellation, bodyId });
  };
  for (const { element, face, faceIndex } of faces) {
    if (current === undefined || current.id !== element.id) {
      flush();
      current = { id: element.id, start: mesh.triangleCount };
    }
    for (const triangle of tessellateFace(model, element, face)) {
      mesh.append(triangle, faceId + 1);
    }
    const tessellation: FaceTessellation = {
      id: faceId,
      elementId: element.id,
      faceIndex,
      key: face.key,
      nodeIds: face.nodeIds,
      neighborElementIds: (neighbors.get(face.key) ?? []).filter((id) => id !== element.id),
    };
    const bodyId = bodyIds.get(element.id);
    faceTessellations.push(bodyId === undefined ? tessellation : { ...tessellation, bodyId });
    if (selected?.has(faceIdentity(element.id, faceIndex))) selectedFaceIds.push(faceId);
    faceId += 1;
  }
  flush();
  return { mesh, elements, faces: faceTessellations, nodePositions, selectedFaceIds };
}

function buildVolumeGeometry(options: VolumeGeometryOptions): Geometry {
  const { mesh, elements, faces, nodePositions, bodies, faceSubset } = options;
  const renderedElementIds = new Set(elements.map((element) => element.id));
  const renderedBodies = bodies?.flatMap((body) => {
    const elementIds = body.elementIds.filter((id) => renderedElementIds.has(id));
    return elementIds.length === 0 ? [] : [{ ...body, elementIds }];
  });
  const base = mesh.build("triangles", elements, faces, nodePositions, renderedBodies);
  const geometry = faceSubset === undefined ? base : { ...base, faceSubset };
  validateElements(geometry);
  validatePickIds(geometry);
  validateBodies(geometry);
  return geometry;
}

function bodyAssignments(
  model: ElementModel,
  bodies: readonly Body[] | undefined,
): ReadonlyMap<ElementId, BodyId> {
  if (bodies === undefined || bodies.length === 0) return new Map();
  const assignments = new Map<ElementId, BodyId>();
  for (const body of bodies) {
    for (const elementId of body.elementIds) assignments.set(elementId, body.id);
  }
  validateBodies({
    elements: model.elements.map((element) => {
      const tessellation: ElementTessellation = {
        id: element.id,
        triangleStart: 0,
        triangleCount: 1,
      };
      const bodyId = assignments.get(element.id);
      return bodyId === undefined ? tessellation : { ...tessellation, bodyId };
    }),
    bodies,
  });
  return assignments;
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
