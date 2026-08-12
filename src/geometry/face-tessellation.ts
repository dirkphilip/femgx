import type { Element, NodeId } from "../elements/element";
import type { ElementFace } from "../elements/faces";
import type { ElementModel } from "../elements/model";
import { topologyFor } from "../elements/shapes";
import { type MeshVertex } from "./mesh-builder";
import { average, cross, dot, length, subtract, type Vec3 } from "../math/vec3";
import { elementNodePosition } from "./node-position";

/**
 * Subdivides an oriented element face into triangles, each wound to face
 * outward. Linear faces fan from the first corner; quadratic faces are
 * subdivided through their mid-edge nodes. Every vertex keeps the authored
 * model node it came from, which the renderer uses to make the mesh
 * node-pickable and deformation-attached.
 */

/** Splits an interleaved face loop into separate corner and mid-edge nodes. */
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
export function tessellateFace(
  model: ElementModel,
  element: Element,
  face: ElementFace,
): ReadonlyArray<readonly [MeshVertex, MeshVertex, MeshVertex]> {
  const { cornerNodeIds, midNodeIds } = faceNodeIds(element, face);
  const corners = cornerNodeIds.map((id) => ({
    point: elementNodePosition(model, id),
    nodeId: id,
  }));
  const outward = outwardDirection(
    model,
    element,
    corners.map((corner) => corner.point),
  );
  if (midNodeIds.length === 0) {
    const triangles: Array<readonly [MeshVertex, MeshVertex, MeshVertex]> = [];
    for (let i = 1; i < corners.length - 1; i += 1) {
      triangles.push(
        orient(
          outward,
          corners[0] as MeshVertex,
          corners[i] as MeshVertex,
          corners[i + 1] as MeshVertex,
        ),
      );
    }
    return triangles;
  }
  const mids = midNodeIds.map((id) => ({ point: elementNodePosition(model, id), nodeId: id }));
  if (corners.length === 3) {
    return quadraticTriangle(corners, mids, outward);
  }
  return quadraticQuad(corners, mids, outward);
}

function quadraticTriangle(
  corners: readonly MeshVertex[],
  mids: readonly MeshVertex[],
  outward: Vec3,
): ReadonlyArray<readonly [MeshVertex, MeshVertex, MeshVertex]> {
  const [a, b, c] = corners as readonly [MeshVertex, MeshVertex, MeshVertex];
  const [mab, mbc, mca] = mids as readonly [MeshVertex, MeshVertex, MeshVertex];
  return [
    orient(outward, a, mab, mca),
    orient(outward, b, mbc, mab),
    orient(outward, c, mca, mbc),
    orient(outward, mab, mbc, mca),
  ];
}

function quadraticQuad(
  corners: readonly MeshVertex[],
  mids: readonly MeshVertex[],
  outward: Vec3,
): ReadonlyArray<readonly [MeshVertex, MeshVertex, MeshVertex]> {
  const [a, b, c, d] = corners as readonly [MeshVertex, MeshVertex, MeshVertex, MeshVertex];
  const [mab, mbc, mcd, mda] = mids as readonly [MeshVertex, MeshVertex, MeshVertex, MeshVertex];
  return [
    orient(outward, a, mab, mda),
    orient(outward, b, mbc, mab),
    orient(outward, c, mcd, mbc),
    orient(outward, d, mda, mcd),
    orient(outward, mab, mbc, mcd),
    orient(outward, mab, mcd, mda),
  ];
}

/** Direction from the element interior toward the face (for outward winding). */
function outwardDirection(model: ElementModel, element: Element, corners: readonly Vec3[]): Vec3 {
  if (element.shape.family === "triangle" || element.shape.family === "quad") {
    return faceNormal(corners);
  }
  const elementCentroid = average(element.nodeIds.map((id) => elementNodePosition(model, id)));
  const faceCentroid = average(corners);
  const outward = subtract(faceCentroid, elementCentroid);
  return length(outward) > 0 ? outward : faceNormal(corners);
}

/** Wraps a triangle so its geometric normal aligns with `outward`. */
function orient(
  outward: Vec3,
  a: MeshVertex,
  b: MeshVertex,
  c: MeshVertex,
): readonly [MeshVertex, MeshVertex, MeshVertex] {
  return dot(cross(subtract(b.point, a.point), subtract(c.point, a.point)), outward) < 0
    ? [a, c, b]
    : [a, b, c];
}

function faceNormal(corners: readonly Vec3[]): Vec3 {
  const [a, b, c] = corners as readonly [Vec3, Vec3, Vec3];
  return cross(subtract(b, a), subtract(c, a));
}
