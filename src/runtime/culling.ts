import { transformPoint, type Mat4 } from "../math/mat4";
import type { Part } from "../geometry/part";
import type { Instance } from "../scene/types";

/** A normalized plane in view-frustum space. */
export interface FrustumPlane {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly distance: number;
}

/** Six clipping planes extracted from a column-major view-projection matrix. */
export interface Frustum {
  readonly planes: readonly FrustumPlane[];
}

/**
 * Extracts left/right/bottom/top/near/far planes from a clip matrix using the
 * WebGPU `[0, 1]` depth convention. The near plane is satisfied when `clip.z`
 * is non-negative, so it is the third row alone; the far plane when
 * `clip.z <= clip.w`.
 */
export function extractFrustum(matrix: Mat4): Frustum {
  const row = (rowIndex: number, columnIndex: number): number =>
    matrix[columnIndex * 4 + rowIndex] ?? 0;
  const planes = [
    plane(
      row(3, 0) + row(0, 0),
      row(3, 1) + row(0, 1),
      row(3, 2) + row(0, 2),
      row(3, 3) + row(0, 3),
    ),
    plane(
      row(3, 0) - row(0, 0),
      row(3, 1) - row(0, 1),
      row(3, 2) - row(0, 2),
      row(3, 3) - row(0, 3),
    ),
    plane(
      row(3, 0) + row(1, 0),
      row(3, 1) + row(1, 1),
      row(3, 2) + row(1, 2),
      row(3, 3) + row(1, 3),
    ),
    plane(
      row(3, 0) - row(1, 0),
      row(3, 1) - row(1, 1),
      row(3, 2) - row(1, 2),
      row(3, 3) - row(1, 3),
    ),
    plane(
      row(2, 0),
      row(2, 1),
      row(2, 2),
      row(2, 3),
    ),
    plane(
      row(3, 0) - row(2, 0),
      row(3, 1) - row(2, 1),
      row(3, 2) - row(2, 2),
      row(3, 3) - row(2, 3),
    ),
  ];
  return { planes };
}

/** Returns whether a sphere intersects or is inside every frustum plane. */
export function isSphereVisible(
  frustum: Frustum,
  center: readonly [number, number, number],
  radius: number,
): boolean {
  return frustum.planes.every(
    (current) =>
      current.x * center[0] + current.y * center[1] + current.z * center[2] + current.distance >=
      -radius,
  );
}

/** Culls instances with transformed part bounding spheres outside the frustum. */
export function cullInstances(
  instances: readonly Instance[],
  parts: ReadonlyMap<number, Part>,
  viewProjection: Mat4,
): readonly Instance[] {
  const frustum = extractFrustum(viewProjection);
  const visible: Instance[] = [];
  for (const instance of instances) {
    const part = parts.get(instance.partId);
    if (part === undefined || isInstanceVisible(instance, part, frustum)) {
      visible.push({ ...instance, index: visible.length });
    }
  }
  return visible;
}

function isInstanceVisible(instance: Instance, part: Part, frustum: Frustum): boolean {
  const bounds = part.bounds;
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.minZ)
  ) {
    return true;
  }
  const center = transformPoint(
    instance.worldTransform,
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  );
  const radius =
    Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ) / 2;
  const scale = Math.max(
    columnLength(instance.worldTransform, 0),
    columnLength(instance.worldTransform, 1),
    columnLength(instance.worldTransform, 2),
  );
  return isSphereVisible(frustum, center, radius * scale);
}

function columnLength(matrix: Mat4, column: number): number {
  return Math.hypot(
    matrix[column * 4] ?? 0,
    matrix[column * 4 + 1] ?? 0,
    matrix[column * 4 + 2] ?? 0,
  );
}

function plane(x: number, y: number, z: number, distance: number): FrustumPlane {
  const length = Math.hypot(x, y, z);
  return length === 0
    ? { x, y, z, distance }
    : { x: x / length, y: y / length, z: z / length, distance: distance / length };
}
