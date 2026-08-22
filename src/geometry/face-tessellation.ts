import { at } from "../elements/indices";
import type { ElementModel } from "../elements/model";
import { elementModelNodeIdAt, elementModelTopologyAt } from "../elements/model-topology";
import type { MeshVertex, TriangleMeshAssembler } from "./mesh-builder";
import { average, cross, dot, length, subtract, type Vec3 } from "../math/vec3";
import { elementNodePosition } from "./node-position";
import { edgeIndexOf } from "../elements/topology-helpers";

/** Returns the canonical Tri6 or Quad8 subdivision for interleaved nodes. */
export function quadraticSubdivision<T>(nodes: readonly T[]): ReadonlyArray<readonly [T, T, T]> {
  if (nodes.length === 6) {
    const a = at(nodes, 0);
    const ab = at(nodes, 1);
    const b = at(nodes, 2);
    const bc = at(nodes, 3);
    const c = at(nodes, 4);
    const ca = at(nodes, 5);
    return [
      [a, ab, ca],
      [b, bc, ab],
      [c, ca, bc],
      [ab, bc, ca],
    ];
  }
  if (nodes.length === 8) {
    const a = at(nodes, 0);
    const ab = at(nodes, 1);
    const b = at(nodes, 2);
    const bc = at(nodes, 3);
    const c = at(nodes, 4);
    const cd = at(nodes, 5);
    const d = at(nodes, 6);
    const da = at(nodes, 7);
    return [
      [a, ab, da],
      [b, bc, ab],
      [c, cd, bc],
      [d, da, cd],
      [ab, bc, cd],
      [ab, cd, da],
    ];
  }
  throw new Error(`Quadratic subdivision requires six or eight nodes, got ${nodes.length}`);
}

/**
 * Appends one model-row face without projecting an `Element` descriptor.
 *
 * The bounded local vertex arrays are face-local (at most eight entries); no
 * model-sized object collection is created while compiling a dense model.
 */
export function appendModelFace(
  mesh: TriangleMeshAssembler,
  model: ElementModel,
  ordinal: number,
  faceCorners: readonly number[],
): void {
  const topology = elementModelTopologyAt(model, ordinal);
  const stride = topology.order >= 2 ? 2 : 1;
  const vertices = new Array<MeshVertex>(faceCorners.length * stride);
  for (let index = 0; index < faceCorners.length; index += 1) {
    const corner = faceCorners[index];
    if (corner === undefined) throw new Error("Element face has no corner");
    const cornerId = elementModelNodeIdAt(model, ordinal, corner);
    vertices[index * stride] = { point: elementNodePosition(model, cornerId), nodeId: cornerId };
    if (stride === 2) {
      const next = faceCorners[(index + 1) % faceCorners.length];
      if (next === undefined) throw new Error("Element face has no corner");
      const edge = edgeIndexOf(topology, corner, next);
      const middle = topology.edgeNodes[edge];
      if (middle === undefined) throw new Error("Quadratic face has no mid-edge node");
      const middleId = elementModelNodeIdAt(model, ordinal, middle);
      vertices[index * stride + 1] = {
        point: elementNodePosition(model, middleId),
        nodeId: middleId,
      };
    }
  }
  const corners = new Array<MeshVertex>(faceCorners.length);
  for (let index = 0; index < corners.length; index += 1) {
    const vertex = vertices[index * stride];
    if (vertex === undefined) throw new Error("Element face has no vertex");
    corners[index] = vertex;
  }
  const outward = outwardDirectionForRow(model, ordinal, topology.family, corners);
  if (stride === 1) {
    for (let index = 1; index < corners.length - 1; index += 1) {
      const first = corners[0];
      const second = corners[index];
      const third = corners[index + 1];
      if (first === undefined || second === undefined || third === undefined)
        throw new Error("Element face has no triangle vertex");
      mesh.append(orient(outward, first, second, third));
    }
    return;
  }
  for (const triangle of quadraticSubdivision<MeshVertex>(vertices)) {
    mesh.append(orient(outward, triangle[0], triangle[1], triangle[2]));
  }
}

function outwardDirectionForRow(
  model: ElementModel,
  ordinal: number,
  family: ReturnType<typeof elementModelTopologyAt>["family"],
  corners: readonly MeshVertex[],
): Vec3 {
  const points = corners.map((corner) => corner.point);
  if (family === "triangle" || family === "quad") return faceNormal(points);
  const topology = elementModelTopologyAt(model, ordinal);
  let x = 0;
  let y = 0;
  let z = 0;
  for (let local = 0; local < topology.nodeCount; local += 1) {
    const position = elementNodePosition(model, elementModelNodeIdAt(model, ordinal, local));
    x += position[0];
    y += position[1];
    z += position[2];
  }
  const elementCentroid: Vec3 = [
    x / topology.nodeCount,
    y / topology.nodeCount,
    z / topology.nodeCount,
  ];
  const faceCentroid = average(points);
  const outward = subtract(faceCentroid, elementCentroid);
  return length(outward) > 0 ? outward : faceNormal(points);
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
  const a = at(corners, 0);
  const b = at(corners, 1);
  const c = at(corners, 2);
  return cross(subtract(b, a), subtract(c, a));
}
