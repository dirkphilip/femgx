import type { FaceIdRef } from "../elements/faces";
import { edgesOf, type ElementEdge } from "../elements/edges";
import type { Element, ElementId, NodeId } from "../elements/element";
import type { ElementModel } from "../elements/model";
import {
  type Body,
  type BodyId,
  type ElementTessellation,
  type FaceId,
  type FaceSubset,
  type FaceTessellation,
  type LineGeometry,
  type PointGeometry,
  type TriangleGeometry,
  validateBodies,
} from "./part";
import { tessellateFace } from "./face-tessellation";
import { LineMeshBuilder, TriangleMeshBuilder, type MeshVertex } from "./mesh-builder";
import type { Vec3 } from "../math/vec3";
import {
  allFacesForElements,
  faceIdentity,
  faceNeighbors,
  renderFacesForElements,
  validateManifoldFaces,
  validateFaceSelectionForElements,
  type ElementRenderFace,
} from "./element-face-selection";

/** Inputs for one validated triangle-group geometry build. */
interface VolumeGeometryInput {
  readonly model: ElementModel;
  readonly elements: readonly Element[];
  readonly bodies: readonly Body[] | undefined;
  readonly faceSubset: readonly FaceIdRef[] | undefined;
  readonly includeShapes: boolean;
  readonly family?: string;
  readonly assignedBodies?: ReadonlyMap<ElementId, BodyId>;
}

/** Builds triangle geometry for one or more compatible element shapes. */
export function volumeGeometry(input: VolumeGeometryInput): TriangleGeometry {
  const {
    model,
    elements,
    bodies,
    faceSubset,
    includeShapes,
    family = "heterogeneous",
    assignedBodies = bodyAssignments(model.elements, bodies),
  } = input;
  const selected =
    faceSubset === undefined
      ? undefined
      : validateFaceSelectionForElements(elements, faceSubset, family);
  if (selected !== undefined) validateManifoldFaces(elements);
  const faces =
    selected === undefined
      ? renderFacesForElements(elements, assignedBodies)
      : allFacesForElements(elements);
  const tessellation = tessellateVolumeFaces({
    model,
    faces,
    neighbors: faceNeighbors(elements),
    bodyIds: assignedBodies,
    selected,
    includeShapes,
  });
  const subset = selected === undefined ? undefined : { faceIds: tessellation.selectedFaceIds };
  return buildVolumeGeometry({
    ...tessellation,
    bodies: bodiesForElements(elements, bodies),
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

/** Inputs for one volume-face tessellation pass. */
interface VolumeFaceInput {
  readonly model: ElementModel;
  readonly faces: readonly ElementRenderFace[];
  readonly neighbors: ReadonlyMap<string, readonly ElementId[]>;
  readonly bodyIds: ReadonlyMap<ElementId, BodyId>;
  readonly selected: ReadonlySet<string> | undefined;
  readonly includeShapes: boolean;
}

function tessellateVolumeFaces(input: VolumeFaceInput): VolumeTessellation {
  const { model, faces, neighbors, bodyIds, selected, includeShapes } = input;
  const mesh = new TriangleMeshBuilder();
  const elements: ElementTessellation[] = [];
  const faceTessellations: FaceTessellation[] = [];
  const nodePositions: number[] = [...model.nodes];
  const selectedFaceIds: FaceId[] = [];
  let current: { readonly element: Element; readonly start: number } | undefined;
  let faceId = 0;
  const flush = (): void => {
    if (current === undefined) return;
    const tessellation: ElementTessellation = {
      id: current.element.id,
      primitiveStart: current.start,
      primitiveCount: mesh.triangleCount - current.start,
      ...(includeShapes ? { shape: current.element.shape } : {}),
    };
    const bodyId = bodyIds.get(current.element.id);
    elements.push(bodyId === undefined ? tessellation : { ...tessellation, bodyId });
  };
  for (const { element, face, faceIndex } of faces) {
    if (current === undefined || current.element.id !== element.id) {
      flush();
      current = { element, start: mesh.triangleCount };
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

function buildVolumeGeometry(options: VolumeGeometryOptions): TriangleGeometry {
  const { mesh, elements, faces, nodePositions, bodies, faceSubset } = options;
  const renderedElementIds = new Set(elements.map((element) => element.id));
  const renderedBodies = bodies?.flatMap((body) => {
    const elementIds = body.elementIds.filter((id) => renderedElementIds.has(id));
    return elementIds.length === 0 ? [] : [{ ...body, elementIds }];
  });
  const base = mesh.build("triangles", elements, faces, nodePositions, renderedBodies);
  const geometry = faceSubset === undefined ? base : { ...base, faceSubset };
  return geometry;
}

/** Builds element-pickable line geometry for authored line elements. */
export function lineGeometry(
  model: ElementModel,
  elements: readonly Element[],
  bodyIds: ReadonlyMap<ElementId, BodyId>,
  bodies: readonly Body[] | undefined,
): LineGeometry {
  const mesh = new LineMeshBuilder();
  const descriptors: ElementTessellation[] = [];
  for (const element of elements) {
    const primitiveStart = mesh.indices.length / 2;
    for (const edge of edgesOf(element)) mesh.append(edgePoints(model, edge));
    const descriptor: ElementTessellation = {
      id: element.id,
      primitiveStart,
      primitiveCount: mesh.indices.length / 2 - primitiveStart,
      shape: element.shape,
    };
    const bodyId = bodyIds.get(element.id);
    descriptors.push(bodyId === undefined ? descriptor : { ...descriptor, bodyId });
  }
  const renderedBodies = bodiesForElements(elements, bodies);
  const geometry = {
    ...mesh.build("lines", descriptors, model.nodes),
    ...(renderedBodies === undefined ? {} : { bodies: renderedBodies }),
  };
  return geometry;
}

/** Builds element-pickable point sprites for authored point elements. */
export function pointGeometry(
  model: ElementModel,
  elements: readonly Element[],
  bodyIds: ReadonlyMap<ElementId, BodyId>,
  bodies: readonly Body[] | undefined,
): PointGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const nodePickIds: number[] = [];
  const descriptors: ElementTessellation[] = [];
  for (const element of elements) {
    const nodeId = element.nodeIds[0];
    if (nodeId === undefined) throw new Error("Point element must reference exactly one node");
    const point = nodePosition(model, nodeId);
    const primitiveStart = positions.length / 3;
    const base = positions.length / 3;
    positions.push(point[0], point[1], point[2]);
    nodePickIds.push(nodeId + 1);
    indices.push(base);
    const descriptor: ElementTessellation = {
      id: element.id,
      primitiveStart,
      primitiveCount: 1,
      shape: element.shape,
    };
    const bodyId = bodyIds.get(element.id);
    descriptors.push(bodyId === undefined ? descriptor : { ...descriptor, bodyId });
  }
  const renderedBodies = bodiesForElements(elements, bodies);
  const geometry: PointGeometry = {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    primitive: "points",
    elements: descriptors,
    nodePickIds: new Uint32Array(nodePickIds),
    nodePositions: new Float32Array(model.nodes),
    ...(renderedBodies === undefined ? {} : { bodies: renderedBodies }),
  };
  return geometry;
}

/** Resolves body ownership once against the complete source model. */
export function bodyAssignments(
  elements: readonly Element[],
  bodies: readonly Body[] | undefined,
): ReadonlyMap<ElementId, BodyId> {
  if (bodies === undefined || bodies.length === 0) return new Map();
  const assignments = new Map<ElementId, BodyId>();
  for (const body of bodies) {
    for (const elementId of body.elementIds) assignments.set(elementId, body.id);
  }
  validateBodies({
    elements: elements.map((element) => {
      const tessellation: ElementTessellation = {
        id: element.id,
        primitiveStart: 0,
        primitiveCount: 1,
      };
      const bodyId = assignments.get(element.id);
      return bodyId === undefined ? tessellation : { ...tessellation, bodyId };
    }),
    bodies,
  });
  return assignments;
}

function bodiesForElements(
  elements: readonly Element[],
  bodies: readonly Body[] | undefined,
): readonly Body[] | undefined {
  if (bodies === undefined) return undefined;
  const ids = new Set(elements.map((element) => element.id));
  return bodies.flatMap((body) => {
    const elementIds = body.elementIds.filter((id) => ids.has(id));
    return elementIds.length === 0 ? [] : [{ ...body, elementIds }];
  });
}

function edgePoints(model: ElementModel, edge: ElementEdge): readonly MeshVertex[] {
  const first = edge.nodeIds[0];
  const last = edge.nodeIds[edge.nodeIds.length - 1];
  if (first === undefined || last === undefined)
    throw new Error("Edge must have at least two nodes");
  const a = nodePosition(model, first);
  const b = nodePosition(model, last);
  if (edge.nodeIds.length === 2) {
    return [
      { point: a, nodeId: first },
      { point: b, nodeId: last },
    ];
  }
  const midNodeId = edge.nodeIds[1];
  if (midNodeId === undefined) throw new Error("Quadratic edge must carry its mid-edge node");
  const mid = nodePosition(model, midNodeId);
  return [
    { point: a, nodeId: first },
    { point: mid, nodeId: midNodeId },
    { point: b, nodeId: last },
  ];
}

function nodePosition(model: ElementModel, nodeId: NodeId): Vec3 {
  const offset = nodeId * 3;
  const x = model.nodes[offset];
  if (x === undefined) throw new Error(`Model has no position for node ${nodeId}`);
  return [x, model.nodes[offset + 1] ?? 0, model.nodes[offset + 2] ?? 0];
}
