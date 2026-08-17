import {
  boxSelectionFrustum,
  isBodyVisible,
  isElementVisible,
  transformPoint,
  type BoxSelectionFrustum,
  type DeformationState,
  type ElementTessellation,
  type Viewport,
  type Geometry,
  type InteractionTarget,
  type Mat4,
  type Part,
  type Primitive,
  type SectionPlane,
  type Vec3,
} from "../../../src/entries/root";
import {
  BoxSelectionResolverContractError,
  type BoxSelectionResolver,
} from "./box-selection-resolver";

const PRIMITIVE_ARITY: Record<Primitive, number> = {
  triangles: 3,
  lines: 2,
  points: 1,
};

const FRUSTUM_PLANES: readonly (keyof BoxSelectionFrustum)[] = [
  "left",
  "right",
  "top",
  "bottom",
  "near",
  "far",
];

interface PartQueryData {
  readonly elements: readonly ElementTessellation[];
  readonly geometryByPrimitive: ReadonlyMap<Primitive, Geometry>;
}

const queryDataByPart = new WeakMap<Part, PartQueryData>();

/**
 * Creates the Core through-intersection resolver for element box selection.
 *
 * The query walks the runtime draw list and the authoritative part tessellation
 * on the host. It intentionally has no renderer or GPU dependency, so it can
 * share the workbench's existing asynchronous box-selection queue.
 */
export function throughIntersectionBoxSelectionResolver(
  viewport: () => Viewport,
): BoxSelectionResolver {
  return ({ event, granularity }) => {
    if (granularity !== "element") {
      throw new BoxSelectionResolverContractError(
        "Through box selection requires element granularity",
      );
    }
    const view = viewport();
    const frustum = boxSelectionFrustum(view.camera, event.rect);
    const tolerance = selectionTolerance(view);
    const deformation = view.results?.deformation;
    const targets: InteractionTarget[] = [];

    for (const instanceId of view.runtime.getVisibleInstanceIds()) {
      const instance = view.runtime.getInstance(instanceId);
      if (instance === undefined || !instance.visible || !instance.partVisible) continue;
      const occurrence = view.runtime.getOccurrence(instance.occurrenceId);
      if (occurrence === undefined || !occurrence.effectiveVisible) continue;
      const part = view.scene.parts.get(instance.partId);
      if (part === undefined) continue;
      const partQuery = queryData(part);
      for (const element of partQuery.elements) {
        if (!isElementVisible(view.interaction, { instanceId, elementId: element.id })) continue;
        if (
          element.bodyId !== undefined &&
          !isBodyVisible(view.interaction, { instanceId, bodyId: element.bodyId })
        ) {
          continue;
        }
        if (
          elementIntersectsBox({
            part,
            element,
            geometryByPrimitive: partQuery.geometryByPrimitive,
            transform: instance.transform,
            frustum,
            sectionPlane: view.sectionPlane,
            deformation,
            tolerance,
          })
        ) {
          targets.push({ kind: "element", instanceId, elementId: element.id });
        }
      }
    }
    return Promise.resolve(targets);
  };
}

function queryData(part: Part): PartQueryData {
  const cached = queryDataByPart.get(part);
  if (cached !== undefined) return cached;
  const data = {
    elements: [...(part.elements ?? [])].sort((left, right) => left.id - right.id),
    geometryByPrimitive: new Map(part.geometries.map((geometry) => [geometry.primitive, geometry])),
  };
  queryDataByPart.set(part, data);
  return data;
}

interface ElementQuery {
  readonly part: Part;
  readonly element: ElementTessellation;
  readonly geometryByPrimitive: ReadonlyMap<Primitive, Geometry>;
  readonly transform: Mat4;
  readonly frustum: BoxSelectionFrustum;
  readonly sectionPlane: SectionPlane | undefined;
  readonly deformation: DeformationState | undefined;
  readonly tolerance: number;
}

function elementIntersectsBox(query: ElementQuery): boolean {
  for (const range of query.element.primitiveRanges) {
    const geometry = query.geometryByPrimitive.get(range.primitive);
    if (geometry === undefined) continue;
    const arity = PRIMITIVE_ARITY[range.primitive];
    const start = range.primitiveStart * arity;
    const end = start + range.primitiveCount * arity;
    for (let offset = start; offset < end; offset += arity) {
      const points = primitivePoints({
        geometry,
        offset,
        arity,
        transform: query.transform,
        part: query.part,
        deformation: query.deformation,
      });
      if (
        points !== undefined &&
        primitiveIntersectsFrustum(points, query.frustum, query.sectionPlane, query.tolerance)
      ) {
        return true;
      }
    }
  }
  return false;
}

interface PrimitiveQuery {
  readonly geometry: Geometry;
  readonly offset: number;
  readonly arity: number;
  readonly transform: Mat4;
  readonly part: Part;
  readonly deformation: DeformationState | undefined;
}

function primitivePoints(query: PrimitiveQuery): readonly Vec3[] | undefined {
  const points: Vec3[] = [];
  for (let index = 0; index < query.arity; index++) {
    const vertexIndex = query.geometry.indices[query.offset + index];
    if (vertexIndex === undefined) return undefined;
    const base = vertexIndex * 3;
    const x = query.geometry.positions[base];
    const y = query.geometry.positions[base + 1];
    const z = query.geometry.positions[base + 2];
    if (x === undefined || y === undefined || z === undefined) return undefined;
    const local = displacedPoint(
      [x, y, z],
      query.geometry.nodePickIds?.[vertexIndex],
      query.deformation?.displacements.get(query.part.id),
      query.deformation?.scale ?? 1,
    );
    points.push(transformPoint(query.transform, local[0], local[1], local[2]));
  }
  return points;
}

function displacedPoint(
  point: Vec3,
  nodePickId: number | undefined,
  displacements: Float32Array | undefined,
  scale: number,
): Vec3 {
  if (nodePickId === undefined || nodePickId === 0 || displacements === undefined) return point;
  const source = (nodePickId - 1) * 3;
  const dx = displacements[source];
  const dy = displacements[source + 1];
  const dz = displacements[source + 2];
  if (
    dx === undefined ||
    dy === undefined ||
    dz === undefined ||
    !Number.isFinite(dx) ||
    !Number.isFinite(dy) ||
    !Number.isFinite(dz)
  ) {
    return point;
  }
  return [point[0] + dx * scale, point[1] + dy * scale, point[2] + dz * scale];
}

function primitiveIntersectsFrustum(
  points: readonly Vec3[],
  frustum: BoxSelectionFrustum,
  sectionPlane: SectionPlane | undefined,
  tolerance: number,
): boolean {
  if (points.length === 1) {
    const point = points[0];
    return point === undefined ? false : insideFrustum(point, frustum, sectionPlane, tolerance);
  }
  let clipped = false;
  for (const name of FRUSTUM_PLANES) {
    const plane = frustum[name];
    const inside = insideCount(points, plane.normal, plane.distance, tolerance);
    if (inside === 0) return false;
    clipped ||= inside < points.length;
  }
  if (sectionPlane !== undefined) {
    const inside = insideCount(points, sectionPlane.normal, sectionPlane.distance, tolerance);
    if (inside === 0) return false;
    clipped ||= inside < points.length;
  }
  if (!clipped) return true;
  let polygon = [...points];
  for (const name of FRUSTUM_PLANES) {
    polygon = clipPolygon(polygon, frustum[name].normal, frustum[name].distance, tolerance);
    if (polygon.length === 0) return false;
  }
  if (sectionPlane !== undefined) {
    polygon = clipPolygon(polygon, sectionPlane.normal, sectionPlane.distance, tolerance);
  }
  return polygon.length > 0;
}

function insideCount(
  points: readonly Vec3[],
  normal: Vec3,
  distance: number,
  tolerance: number,
): number {
  let count = 0;
  for (const point of points) {
    if (signedDistance(normal, distance, point) >= -tolerance) count += 1;
  }
  return count;
}

function insideFrustum(
  point: Vec3,
  frustum: BoxSelectionFrustum,
  sectionPlane: SectionPlane | undefined,
  tolerance: number,
): boolean {
  if (
    !FRUSTUM_PLANES.every(
      (name) => signedDistance(frustum[name].normal, frustum[name].distance, point) >= -tolerance,
    )
  ) {
    return false;
  }
  return (
    sectionPlane === undefined ||
    signedDistance(sectionPlane.normal, sectionPlane.distance, point) >= -tolerance
  );
}

function clipPolygon(
  polygon: readonly Vec3[],
  normal: Vec3,
  distance: number,
  tolerance: number,
): Vec3[] {
  const clipped: Vec3[] = [];
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    if (current === undefined || previous === undefined) continue;
    const currentDistance = signedDistance(normal, distance, current);
    const previousDistance = signedDistance(normal, distance, previous);
    const currentInside = currentDistance >= -tolerance;
    const previousInside = previousDistance >= -tolerance;
    if (currentInside !== previousInside) {
      const denominator = previousDistance - currentDistance;
      const ratio = denominator === 0 ? 0 : previousDistance / denominator;
      clipped.push(interpolate(previous, current, ratio));
    }
    if (currentInside) clipped.push(current);
  }
  return clipped;
}

function interpolate(left: Vec3, right: Vec3, ratio: number): Vec3 {
  return [
    left[0] + (right[0] - left[0]) * ratio,
    left[1] + (right[1] - left[1]) * ratio,
    left[2] + (right[2] - left[2]) * ratio,
  ];
}

function signedDistance(normal: Vec3, distance: number, point: Vec3): number {
  return normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2] + distance;
}

function selectionTolerance(view: Viewport): number {
  const cameraScale = Math.max(
    1,
    view.camera.orthoHeight,
    Math.hypot(
      view.camera.position[0] - view.camera.target[0],
      view.camera.position[1] - view.camera.target[1],
      view.camera.position[2] - view.camera.target[2],
    ),
  );
  return cameraScale * 1e-7;
}
