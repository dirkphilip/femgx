import {
  boxSelectionFrustum,
  isBodyVisible,
  isElementVisible,
  transformPoint,
  type BoxSelectionFrustum,
  type DeformationState,
  type ElementPrimitiveRange,
  type ElementTessellation,
  type FemViewport,
  type Geometry,
  type InteractionTarget,
  type Mat4,
  type Part,
  type Primitive,
  type SectionPlane,
  type Vec3,
} from "../../src/index";
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

/**
 * Creates the Core through-intersection resolver for element box selection.
 *
 * The query walks the runtime draw list and the authoritative part tessellation
 * on the host. It intentionally has no renderer or GPU dependency, so it can
 * share the workbench's existing asynchronous box-selection queue.
 */
export function throughIntersectionBoxSelectionResolver(
  viewport: () => FemViewport,
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

    for (const instanceId of view.runtime.getDrawList()) {
      const instance = view.runtime.getInstance(instanceId);
      if (instance === undefined || !instance.visible || !instance.partVisible) continue;
      const occurrence = view.runtime.getOccurrence(instance.occurrenceId);
      if (occurrence === undefined || !occurrence.effectiveVisible) continue;
      const part = view.scene.parts.get(instance.partId);
      if (part === undefined) continue;
      for (const element of sortedElements(part)) {
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

function sortedElements(part: Part): readonly ElementTessellation[] {
  return [...(part.elements ?? [])].sort((left, right) => left.id - right.id);
}

interface ElementQuery {
  readonly part: Part;
  readonly element: ElementTessellation;
  readonly transform: Mat4;
  readonly frustum: BoxSelectionFrustum;
  readonly sectionPlane: SectionPlane | undefined;
  readonly deformation: DeformationState | undefined;
  readonly tolerance: number;
}

function elementIntersectsBox(query: ElementQuery): boolean {
  for (const geometry of query.part.geometries) {
    const ranges = rangesForGeometry(query.element, geometry);
    for (const range of ranges) {
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
  }
  return false;
}

function rangesForGeometry(
  element: ElementTessellation,
  geometry: Geometry,
): readonly ElementPrimitiveRange[] {
  const ranges = element.primitiveRanges?.filter((range) => range.primitive === geometry.primitive);
  return (
    ranges ?? [
      {
        primitive: geometry.primitive,
        primitiveStart: element.primitiveStart,
        primitiveCount: element.primitiveCount,
      },
    ]
  );
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
    const current = polygon[index] as Vec3;
    const previous = polygon[(index + polygon.length - 1) % polygon.length] as Vec3;
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

function selectionTolerance(view: FemViewport): number {
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
