import type { Mat4 } from "../math/mat4";
import { viewProjectionMatrix, type Camera, type Vec3 } from "./camera";

/** A point in homogeneous clip space: x, y, z, w. */
type ClipPoint = readonly [number, number, number, number];

/** A projected screen point: pixel x, pixel y, and NDC depth in `[0, 1]`. */
export type ScreenPoint = readonly [number, number, number];

/**
 * The six planes of the WebGPU clip volume (`-w <= x,y <= w`, `0 <= z <= w`),
 * ordered so the near plane runs first: clipping against it removes every
 * vertex behind the camera before the other planes see a `w <= 0` point.
 */
const CLIP_PLANES: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 1, 0],
  [0, 0, -1, 1],
  [1, 0, 0, 1],
  [-1, 0, 0, 1],
  [0, 1, 0, 1],
  [0, -1, 0, 1],
];

/**
 * Projects a world-space polygon to screen space, clipping it against the
 * WebGPU clip volume first so faces that straddle the camera plane still
 * render instead of being dropped whole. Returns an empty list when no part of
 * the polygon remains visible.
 */
export function projectPolygon(camera: Camera, points: readonly Vec3[]): readonly ScreenPoint[] {
  if (points.length === 0) return [];
  const viewProjection = viewProjectionMatrix(camera);
  let polygon: readonly ClipPoint[] = points.map((point) => toClipPoint(viewProjection, point));
  for (const plane of CLIP_PLANES) {
    polygon = clipAgainstPlane(polygon, plane);
    if (polygon.length === 0) return [];
  }
  return polygon.map((point) => toScreenPoint(camera, point));
}

/** Transforms a world point by a column-major matrix into clip space. */
function toClipPoint(matrix: Mat4, point: Vec3): ClipPoint {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const cell = (row: number, column: number): number => matrix[column * 4 + row] ?? 0;
  return [
    cell(0, 0) * x + cell(0, 1) * y + cell(0, 2) * z + cell(0, 3),
    cell(1, 0) * x + cell(1, 1) * y + cell(1, 2) * z + cell(1, 3),
    cell(2, 0) * x + cell(2, 1) * y + cell(2, 2) * z + cell(2, 3),
    cell(3, 0) * x + cell(3, 1) * y + cell(3, 2) * z + cell(3, 3),
  ];
}

/** Cuts a polygon against one clip plane with the Sutherland-Hodgman pass. */
function clipAgainstPlane(
  polygon: readonly ClipPoint[],
  plane: readonly [number, number, number, number],
): readonly ClipPoint[] {
  const output: ClipPoint[] = [];
  const last = polygon[polygon.length - 1];
  if (last === undefined) return output;
  let previous = last;
  let previousDistance = signedDistance(plane, previous);
  for (const current of polygon) {
    const currentDistance = signedDistance(plane, current);
    if (previousDistance >= 0 !== currentDistance >= 0) {
      const t = previousDistance / (previousDistance - currentDistance);
      output.push(interpolate(previous, current, t));
    }
    if (currentDistance >= 0) output.push(current);
    previous = current;
    previousDistance = currentDistance;
  }
  return output;
}

function signedDistance(
  plane: readonly [number, number, number, number],
  point: ClipPoint,
): number {
  return plane[0] * point[0] + plane[1] * point[1] + plane[2] * point[2] + plane[3] * point[3];
}

function interpolate(a: ClipPoint, b: ClipPoint, t: number): ClipPoint {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

/** Maps a clip-space vertex inside the volume to its screen position. */
function toScreenPoint(camera: Camera, point: ClipPoint): ScreenPoint {
  const w = point[3] === 0 ? 1 : point[3];
  return [
    ((point[0] / w + 1) * camera.width) / 2,
    ((1 - point[1] / w) * camera.height) / 2,
    point[2] / w,
  ];
}
