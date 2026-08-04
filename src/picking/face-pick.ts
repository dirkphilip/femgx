import type { Element, ElementId } from "../elements/element";
import type { ElementFace, FaceKey } from "../elements/faces";
import { facesOf } from "../elements/faces";
import type { ElementModel } from "../elements/model";
import { faceTriangles } from "../geometry/element-mesh";
import { transformPoint } from "../math/mat4";
import { intersectRayTriangle, type Ray, type Vec3 } from "./ray";
import { requestRay, type PickRequest, type PickScene } from "./pick-scene";
import type { ElementPick } from "./element-pick";

/**
 * Resolves which element face a CPU element hit passed through, exposing the
 * oriented world-space face loop, its outward normal, and face ownership
 * (boundary vs shared, plus the adjacent elements).
 */

/** A stable face hit: the element face the ray hit first, in world space. */
export interface FacePick {
  readonly kind: "face";
  readonly slot: number;
  readonly instanceId: string;
  readonly partId: number;
  readonly elementId: ElementId;
  readonly faceKey: FaceKey;
  /** World-space vertices of the face loop, in oriented order. */
  readonly vertices: readonly Vec3[];
  /** World-space outward-oriented face normal. */
  readonly normal: Vec3;
  readonly position: Vec3;
  readonly adjacentElementIds: readonly ElementId[];
  readonly boundary: boolean;
}

/** Resolves which face of the hit element the ray passed through. */
export function resolveFacePick(
  scene: PickScene,
  request: PickRequest,
  hit: ElementPick,
): FacePick | undefined {
  const model = scene.elementModels.get(hit.partId);
  if (model === undefined) return undefined;
  const element = model.elements.find((candidate) => candidate.id === hit.elementId);
  if (element === undefined) return undefined;
  const inspection = scene.inspections.get(hit.partId);
  if (inspection === undefined) return undefined;
  const transform = request.runtime.instanceWorldTransforms.subarray(
    hit.slot * 16,
    hit.slot * 16 + 16,
  );
  const ray = requestRay(request);
  const nearest = nearestFace(ray, transform, model, element);
  if (nearest === undefined) return undefined;
  const ownership = inspection.faceElements.get(nearest.face.key);
  const vertices = nearest.face.nodeIds.map((nodeId) =>
    transformPoint(
      transform,
      model.nodes[nodeId * 3] ?? 0,
      model.nodes[nodeId * 3 + 1] ?? 0,
      model.nodes[nodeId * 3 + 2] ?? 0,
    ),
  );
  return {
    kind: "face",
    slot: hit.slot,
    instanceId: hit.instanceId,
    partId: hit.partId,
    elementId: hit.elementId,
    faceKey: nearest.face.key,
    vertices,
    normal: nearest.normal,
    position: hit.position,
    adjacentElementIds: ownership?.elementIds ?? [],
    boundary: ownership?.boundary ?? true,
  };
}

/** Returns the face the ray passes through first, with its world normal. */
function nearestFace(
  ray: Ray,
  transform: Float32Array,
  model: ElementModel,
  element: Element,
): { readonly face: ElementFace; readonly normal: Vec3 } | undefined {
  let nearest: { face: ElementFace; t: number; normal: Vec3 } | undefined;
  for (const face of facesOf(element)) {
    for (const triangle of faceTriangles(model, element, face)) {
      const a = transformPoint(transform, triangle[0][0], triangle[0][1], triangle[0][2]);
      const b = transformPoint(transform, triangle[1][0], triangle[1][1], triangle[1][2]);
      const c = transformPoint(transform, triangle[2][0], triangle[2][1], triangle[2][2]);
      const t = intersectRayTriangle(ray, a, b, c);
      if (t === undefined) continue;
      if (nearest === undefined || t < nearest.t) {
        nearest = { face, t, normal: triangleNormal(a, b, c) };
      }
    }
  }
  return nearest;
}

function triangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ax = b[0] - a[0];
  const ay = b[1] - a[1];
  const az = b[2] - a[2];
  const bx = c[0] - a[0];
  const by = c[1] - a[1];
  const bz = c[2] - a[2];
  let nx = ay * bz - az * by;
  let ny = az * bx - ax * bz;
  let nz = ax * by - ay * bx;
  const magnitude = Math.hypot(nx, ny, nz);
  if (magnitude === 0) return [0, 0, 1];
  nx /= magnitude;
  ny /= magnitude;
  nz /= magnitude;
  return [nx, ny, nz];
}
