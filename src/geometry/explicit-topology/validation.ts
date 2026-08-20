import type { NodeId } from "../../elements/element";
import { quadraticSubdivision } from "../face-tessellation";
import { ExplicitTopologyError, triangulatePolygon } from "../polygon-triangulation";

/** Writes one validated facet directly into its preallocated triangle column. */
export function writeSurfaceFacetTriangles(
  input: ArrayLike<number>,
  offset: number,
  count: number,
  positions: Float32Array,
  output: SurfaceTriangleOutput,
): void {
  if (count === 3) {
    writeTriangle(input, offset, positions, output);
    return;
  }
  const nodeIds = new Array<NodeId>(Math.abs(count));
  for (let node = 0; node < nodeIds.length; node += 1)
    nodeIds[node] = input[offset + node] ?? Number.NaN;
  if (count > 0) {
    writeTriangles(triangulatePolygon(nodeIds, positions), output);
    return;
  }
  validateSurfaceNodes(nodeIds, 0, nodeIds.length, positions.length / 3, "Quadratic facet");
  const corners = new Array<NodeId>(nodeIds.length / 2);
  for (let corner = 0; corner < corners.length; corner += 1)
    corners[corner] = nodeIds[corner * 2] ?? 0;
  triangulatePolygon(corners, positions);
  writeTriangles(quadraticSubdivision(nodeIds), output);
}

/** Validates a compact node sequence without a model-scaled membership table. */
export function validateSurfaceNodes(
  input: ArrayLike<number>,
  offset: number,
  count: number,
  nodeCount: number,
  label: string,
): void {
  for (let index = 0; index < count; index += 1) {
    const nodeId = input[offset + index] ?? Number.NaN;
    if (!Number.isSafeInteger(nodeId) || nodeId < 0 || nodeId >= nodeCount) {
      throw new ExplicitTopologyError(
        "invalid-node-id",
        `${label} references node ${String(nodeId)}, outside 0..${Math.max(0, nodeCount - 1)}`,
      );
    }
    for (let previous = 0; previous < index; previous += 1) {
      if (input[offset + previous] === nodeId) {
        throw new ExplicitTopologyError(
          "duplicate-node",
          `${label} references node ${nodeId} twice`,
        );
      }
    }
  }
}

interface SurfaceTriangleOutput {
  readonly target: Uint32Array;
  readonly offset: number;
}

function writeTriangle(
  input: ArrayLike<number>,
  offset: number,
  positions: Float32Array,
  output: SurfaceTriangleOutput,
): void {
  validateSurfaceNodes(input, offset, 3, positions.length / 3, "Polygon");
  const first = input[offset] ?? 0;
  const second = input[offset + 1] ?? 0;
  const third = input[offset + 2] ?? 0;
  const ax = positions[first * 3] ?? 0;
  const ay = positions[first * 3 + 1] ?? 0;
  const az = positions[first * 3 + 2] ?? 0;
  const bx = positions[second * 3] ?? 0;
  const by = positions[second * 3 + 1] ?? 0;
  const bz = positions[second * 3 + 2] ?? 0;
  const cx = positions[third * 3] ?? 0;
  const cy = positions[third * 3 + 1] ?? 0;
  const cz = positions[third * 3 + 2] ?? 0;
  const scale = Math.max(
    1,
    Math.abs(ax),
    Math.abs(ay),
    Math.abs(az),
    Math.abs(bx),
    Math.abs(by),
    Math.abs(bz),
    Math.abs(cx),
    Math.abs(cy),
    Math.abs(cz),
  );
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (Math.hypot(nx, ny, nz) <= 1e-9 * scale * scale) {
    throw new ExplicitTopologyError("degenerate", "Polygon points are collinear");
  }
  output.target[output.offset] = first;
  output.target[output.offset + 1] = second;
  output.target[output.offset + 2] = third;
}

function writeTriangles(
  triangles: readonly (readonly [NodeId, NodeId, NodeId])[],
  output: SurfaceTriangleOutput,
): void {
  let offset = output.offset;
  for (let triangle = 0; triangle < triangles.length; triangle += 1) {
    const nodes = triangles[triangle];
    if (nodes === undefined) throw new Error(`Surface triangle ${triangle} is missing`);
    output.target[offset] = nodes[0];
    output.target[offset + 1] = nodes[1];
    output.target[offset + 2] = nodes[2];
    offset += 3;
  }
}
