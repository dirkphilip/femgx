import type { FaceIdRef } from "../elements/faces";
import { edgesOf, type ElementEdge } from "../elements/edges";
import type { Element, ElementId } from "../elements/element";
import type { ElementModel } from "../elements/model";
import {
  type BodyId,
  type ElementTessellation,
  type FaceSubset,
  type FaceTessellation,
  type GeometryBody,
  type GeometryElementBlock,
  type LineGeometry,
  type PointGeometry,
  type TriangleGeometry,
} from "./part";
import { tessellateFace } from "./face-tessellation";
import { LineMeshBuilder, TriangleMeshAssembler, type MeshVertex } from "./mesh-builder";
import { elementNodePosition } from "./node-position";
import {
  allFacesForElements,
  faceIdentity,
  faceNeighbors,
  validateManifoldFaceNeighbors,
  validateFaceSelectionForElements,
  type ElementRenderFace,
} from "./element-face-selection";

/** Inputs for one validated triangle-group geometry build. */
interface VolumeGeometryInput {
  readonly model: ElementModel;
  readonly elements: readonly Element[];
  readonly faceSubset: readonly FaceIdRef[] | undefined;
  readonly assignedBodies: ReadonlyMap<ElementId, BodyId>;
  readonly assignedBlocks: ReadonlyMap<ElementId, number>;
}

/** Builds triangle geometry for one or more compatible element shapes. */
export function volumeGeometry(input: VolumeGeometryInput): TriangleGeometry {
  const { model, elements, faceSubset, assignedBodies, assignedBlocks } = input;
  const selected =
    faceSubset === undefined
      ? undefined
      : validateFaceSelectionForElements(elements, faceSubset, "heterogeneous");
  const neighbors = faceNeighbors(elements);
  validateManifoldFaceNeighbors(neighbors);
  const faces = allFacesForElements(elements);
  const tessellation = tessellateVolumeFaces({
    model,
    faces,
    neighbors,
    bodyIds: assignedBodies,
    blockIds: assignedBlocks,
    selected,
  });
  const subset = selected === undefined ? undefined : { faceIds: tessellation.selectedFaceIds };
  return buildVolumeGeometry({
    ...tessellation,
    bodies: bodiesForElements(model, elements),
    blocks: blocksForElements(model, elements),
    faceSubset: subset,
  });
}

interface VolumeGeometryOptions {
  readonly mesh: TriangleMeshAssembler;
  readonly elements: readonly ElementTessellation[];
  readonly faces: readonly FaceTessellation[];
  readonly nodePositions: readonly number[];
  readonly bodies: readonly GeometryBody[] | undefined;
  readonly blocks: readonly GeometryElementBlock[] | undefined;
  readonly faceSubset: FaceSubset | undefined;
}

interface VolumeTessellation {
  readonly mesh: TriangleMeshAssembler;
  readonly elements: readonly ElementTessellation[];
  readonly faces: readonly FaceTessellation[];
  readonly nodePositions: readonly number[];
  readonly selectedFaceIds: readonly FaceIdRef[];
}

/** Inputs for one volume-face tessellation pass. */
interface VolumeFaceInput {
  readonly model: ElementModel;
  readonly faces: readonly ElementRenderFace[];
  readonly neighbors: ReadonlyMap<string, readonly ElementId[]>;
  readonly bodyIds: ReadonlyMap<ElementId, BodyId>;
  readonly blockIds: ReadonlyMap<ElementId, number>;
  readonly selected: ReadonlySet<string> | undefined;
}

function tessellateVolumeFaces(input: VolumeFaceInput): VolumeTessellation {
  const { model, faces, neighbors, bodyIds, blockIds, selected } = input;
  const mesh = new TriangleMeshAssembler();
  const elements: ElementTessellation[] = [];
  const faceTessellations: FaceTessellation[] = [];
  const nodePositions: number[] = [...model.nodes];
  const selectedFaceIds: FaceIdRef[] = [];
  let current: { readonly element: Element; readonly start: number } | undefined;
  const flush = (): void => {
    if (current === undefined) return;
    const tessellation: ElementTessellation = {
      id: current.element.id,
      primitiveStart: current.start,
      primitiveCount: mesh.triangleCount - current.start,
      shape: current.element.shape,
    };
    const bodyId = bodyIds.get(current.element.id);
    const blockId = blockIds.get(current.element.id);
    elements.push(withOwnership(tessellation, bodyId, blockId));
  };
  for (const { element, face, faceIndex } of faces) {
    if (current === undefined || current.element.id !== element.id) {
      flush();
      current = { element, start: mesh.triangleCount };
    }
    const primitiveStart = mesh.triangleCount;
    for (const triangle of tessellateFace(model, element, face)) mesh.append(triangle);
    const tessellation: FaceTessellation = {
      elementId: element.id,
      faceIndex,
      primitiveStart,
      primitiveCount: mesh.triangleCount - primitiveStart,
      key: face.key,
      nodeIds: face.nodeIds,
      neighborElementIds: (neighbors.get(face.key) ?? []).filter((id) => id !== element.id),
    };
    const bodyId = bodyIds.get(element.id);
    const blockId = blockIds.get(element.id);
    faceTessellations.push(withOwnership(tessellation, bodyId, blockId));
    if (selected?.has(faceIdentity(element.id, faceIndex))) {
      selectedFaceIds.push({ elementId: element.id, faceIndex });
    }
  }
  flush();
  return { mesh, elements, faces: faceTessellations, nodePositions, selectedFaceIds };
}

function buildVolumeGeometry(options: VolumeGeometryOptions): TriangleGeometry {
  const { mesh, elements, faces, nodePositions, bodies, blocks, faceSubset } = options;
  const base = mesh.build("triangles", {
    elements,
    faces,
    nodePositions,
    ...(bodies === undefined ? {} : { bodies }),
    ...(blocks === undefined ? {} : { blocks }),
  });
  const geometry = faceSubset === undefined ? base : { ...base, faceSubset };
  return geometry;
}

/** Builds element-pickable line geometry for authored line elements. */
export function lineGeometry(
  model: ElementModel,
  elements: readonly Element[],
  bodyIds: ReadonlyMap<ElementId, BodyId>,
  blockIds: ReadonlyMap<ElementId, number>,
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
    descriptors.push(withOwnership(descriptor, bodyId, blockIds.get(element.id)));
  }
  const renderedBodies = bodiesForElements(model, elements);
  const renderedBlocks = blocksForElements(model, elements);
  const geometry = {
    ...mesh.build("lines", descriptors, model.nodes),
    ...(renderedBodies === undefined ? {} : { bodies: renderedBodies }),
    ...(renderedBlocks === undefined ? {} : { blocks: renderedBlocks }),
  };
  return geometry;
}

/** Builds element-pickable point sprites for authored point elements. */
export function pointGeometry(
  model: ElementModel,
  elements: readonly Element[],
  bodyIds: ReadonlyMap<ElementId, BodyId>,
  blockIds: ReadonlyMap<ElementId, number>,
): PointGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const nodePickIds: number[] = [];
  const descriptors: ElementTessellation[] = [];
  for (const element of elements) {
    const nodeId = element.nodeIds[0];
    if (nodeId === undefined) throw new Error("Point element must reference exactly one node");
    const point = elementNodePosition(model, nodeId);
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
    descriptors.push(withOwnership(descriptor, bodyId, blockIds.get(element.id)));
  }
  const renderedBodies = bodiesForElements(model, elements);
  const renderedBlocks = blocksForElements(model, elements);
  const geometry: PointGeometry = {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    primitive: "points",
    elements: descriptors,
    nodePickIds: new Uint32Array(nodePickIds),
    nodePositions: new Float32Array(model.nodes),
    ...(renderedBodies === undefined ? {} : { bodies: renderedBodies }),
    ...(renderedBlocks === undefined ? {} : { blocks: renderedBlocks }),
  };
  return geometry;
}

function withOwnership<T extends { readonly bodyId?: BodyId; readonly blockId?: number }>(
  value: T,
  bodyId: BodyId | undefined,
  blockId: number | undefined,
): T {
  return bodyId === undefined && blockId === undefined
    ? value
    : {
        ...value,
        ...(bodyId === undefined ? {} : { bodyId }),
        ...(blockId === undefined ? {} : { blockId }),
      };
}

function bodiesForElements(
  model: ElementModel,
  elements: readonly Element[],
): readonly GeometryBody[] | undefined {
  const bodies = model.bodies;
  if (bodies === undefined) return undefined;
  const ids = new Set(elements.map((element) => element.id));
  const blocks =
    model.blocks === undefined
      ? undefined
      : new Map(model.blocks.map((block) => [block.id, block] as const));
  return bodies.flatMap((body) => {
    const authoredIds =
      "elementIds" in body
        ? body.elementIds
        : body.blockIds.flatMap((blockId) => blocks?.get(blockId)?.elementIds ?? []);
    const elementIds = authoredIds.filter((id) => ids.has(id));
    return elementIds.length === 0
      ? []
      : [{ id: body.id, ...(body.name === undefined ? {} : { name: body.name }), elementIds }];
  });
}

function blocksForElements(
  model: ElementModel,
  elements: readonly Element[],
): readonly GeometryElementBlock[] | undefined {
  if (model.blocks === undefined) return undefined;
  const ids = new Set(elements.map((element) => element.id));
  return model.blocks.flatMap((block) => {
    const elementIds = block.elementIds.filter((id) => ids.has(id));
    return elementIds.length === 0 ? [] : [{ ...block, elementIds }];
  });
}

function edgePoints(model: ElementModel, edge: ElementEdge): readonly MeshVertex[] {
  const first = edge.nodeIds[0];
  const last = edge.nodeIds[edge.nodeIds.length - 1];
  if (first === undefined || last === undefined)
    throw new Error("Edge must have at least two nodes");
  const a = elementNodePosition(model, first);
  const b = elementNodePosition(model, last);
  if (edge.nodeIds.length === 2) {
    return [
      { point: a, nodeId: first },
      { point: b, nodeId: last },
    ];
  }
  const midNodeId = edge.nodeIds[1];
  if (midNodeId === undefined) throw new Error("Quadratic edge must carry its mid-edge node");
  const mid = elementNodePosition(model, midNodeId);
  return [
    { point: a, nodeId: first },
    { point: mid, nodeId: midNodeId },
    { point: b, nodeId: last },
  ];
}
