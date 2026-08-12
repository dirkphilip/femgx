import type { Bounds } from "../geometry/part";
import { add, cross, dot, length, normalize, scale, subtract, type Vec3 } from "../math/vec3";
import {
  cameraDepthMargin,
  minimumCameraDepth,
  orbitCameraWithinBounds,
  updateCameraClipPlanes,
} from "./navigation";
import { assertValidCamera, type Camera } from "./camera";

/** The six named view-cube face targets. */
export type ViewCubeFace = "front" | "back" | "right" | "left" | "top" | "bottom";

/** The world-coordinate plane shown by a view-cube face. */
export type ViewCubePlane = "XY" | "YZ" | "XZ";

/** The eight signed trimetric view-cube corners, ordered X/Y/Z. */
export type ViewCubeCorner = "+++" | "++-" | "+-+" | "+--" | "-++" | "-+-" | "--+" | "---";

/** The six stepped view-cube rotation targets. */
export type ViewCubeRotation = "left" | "right" | "up" | "down" | "clockwise" | "counterclockwise";

/** An action emitted by the internal orientation-gizmo controls. */
export type ViewCubeAction =
  | { readonly kind: "face"; readonly face: ViewCubeFace }
  | { readonly kind: "corner"; readonly corner: ViewCubeCorner }
  | {
      readonly kind: "rotate";
      readonly rotation: ViewCubeRotation;
      readonly stepDegrees: 5 | 15 | 90;
    };

/** Stable face metadata shared by camera math and the SVG view cube. */
export const VIEW_CUBE_FACES = [
  { id: "front", label: "Front", axis: "+Z", plane: "XY", direction: [0, 0, 1] },
  { id: "back", label: "Back", axis: "−Z", plane: "XY", direction: [0, 0, -1] },
  { id: "right", label: "Right", axis: "+X", plane: "YZ", direction: [1, 0, 0] },
  { id: "left", label: "Left", axis: "−X", plane: "YZ", direction: [-1, 0, 0] },
  { id: "top", label: "Top", axis: "+Y", plane: "XZ", direction: [0, 1, 0] },
  { id: "bottom", label: "Bottom", axis: "−Y", plane: "XZ", direction: [0, -1, 0] },
] as const satisfies ReadonlyArray<{
  readonly id: ViewCubeFace;
  readonly label: string;
  readonly axis: string;
  readonly plane: ViewCubePlane;
  readonly direction: Vec3;
}>;

/** Stable corner metadata shared by camera math and the SVG view cube. */
export const VIEW_CUBE_CORNERS = [
  "+++",
  "++-",
  "+-+",
  "+--",
  "-++",
  "-+-",
  "--+",
  "---",
] as const satisfies readonly ViewCubeCorner[];

const SNAP_EPSILON = 1e-8;

/** Applies one validated view-cube action while retaining the viewport contract. */
export function applyViewCubeAction(
  camera: Camera,
  bounds: Bounds,
  action: ViewCubeAction,
): Camera {
  const next =
    action.kind === "face"
      ? snapCameraToDirection(camera, bounds, faceDirection(action.face))
      : action.kind === "corner"
        ? snapCameraToDirection(camera, bounds, cornerDirection(action.corner))
        : rotateCameraByStep(camera, bounds, action.rotation, action.stepDegrees);
  assertValidCamera(next);
  return next;
}

/** Returns the normalized eye direction for a named face. */
export function faceDirection(face: ViewCubeFace): Vec3 {
  const match = VIEW_CUBE_FACES.find((candidate) => candidate.id === face);
  if (match === undefined) throw new Error(`Unknown view-cube face: ${face}`);
  return match.direction;
}

/** Returns the normalized signed diagonal for a named corner. */
export function cornerDirection(corner: ViewCubeCorner): Vec3 {
  const signs: Vec3 = [
    corner[0] === "+" ? 1 : -1,
    corner[1] === "+" ? 1 : -1,
    corner[2] === "+" ? 1 : -1,
  ];
  return normalize(signs);
}

/** Snaps the camera while preserving target, projection, and framing. */
export function snapCameraToDirection(camera: Camera, bounds: Bounds, direction: Vec3): Camera {
  const eyeDirection = validDirection(direction);
  const distance = length(subtract(camera.position, camera.target));
  const oriented = cameraAtDirection(camera, eyeDirection, distance);
  const margin = cameraDepthMargin(bounds);
  const minimumDepth = minimumCameraDepth(oriented, bounds);
  const safeDistance =
    minimumDepth > margin
      ? distance
      : distance + margin - minimumDepth + Math.max(margin * 1e-6, Number.EPSILON);
  const admitted =
    safeDistance === distance
      ? oriented
      : cameraAtDirection(camera, eyeDirection, Math.max(distance, safeDistance));
  return updateCameraClipPlanes(admitted, bounds);
}

/** Applies one deterministic arrow step through the existing orbit admission policy. */
export function rotateCameraByStep(
  camera: Camera,
  bounds: Bounds,
  rotation: ViewCubeRotation,
  stepDegrees: 5 | 15 | 90,
): Camera {
  const radians = (stepDegrees * Math.PI) / 180;
  if (rotation === "clockwise" || rotation === "counterclockwise") {
    return rollCameraByStep(camera, rotation, radians);
  }
  const yaw = rotation === "left" ? radians : rotation === "right" ? -radians : 0;
  const pitch = rotation === "up" ? -radians : rotation === "down" ? radians : 0;
  return orbitCameraWithinBounds(camera, yaw, pitch, camera.target, bounds);
}

/** Rolls the screen basis around the unchanged line of sight. */
function rollCameraByStep(
  camera: Camera,
  rotation: "clockwise" | "counterclockwise",
  radians: number,
): Camera {
  const forward = normalize(subtract(camera.target, camera.position));
  const currentRight = normalize(cross(forward, camera.up));
  const currentUp = normalize(cross(currentRight, forward));
  const angle = rotation === "clockwise" ? -radians : radians;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const rotated = add(
    add(scale(currentUp, cosine), scale(cross(forward, currentUp), sine)),
    scale(forward, dot(forward, currentUp) * (1 - cosine)),
  );
  const up = normalize(subtract(rotated, scale(forward, dot(rotated, forward))));
  const next = { ...camera, up };
  assertValidCamera(next);
  return next;
}

function cameraAtDirection(camera: Camera, eyeDirection: Vec3, distance: number): Camera {
  return {
    ...camera,
    position: add(camera.target, scale(eyeDirection, distance)),
    up: viewCubeUp(eyeDirection),
  };
}

function viewCubeUp(eyeDirection: Vec3): Vec3 {
  const preferred: Vec3 =
    Math.abs(eyeDirection[1]) > 1 - SNAP_EPSILON ? [0, 0, eyeDirection[1] > 0 ? 1 : -1] : [0, 1, 0];
  const projected = subtract(preferred, scale(eyeDirection, dot(preferred, eyeDirection)));
  return normalize(projected, [0, 0, 1], SNAP_EPSILON);
}

function validDirection(direction: Vec3): Vec3 {
  const magnitude = length(direction);
  if (!Number.isFinite(magnitude) || magnitude <= SNAP_EPSILON) {
    throw new Error("View-cube direction must be finite and non-zero");
  }
  return scale(direction, 1 / magnitude);
}
