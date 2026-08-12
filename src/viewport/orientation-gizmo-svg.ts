import { viewMatrix, type Camera } from "../camera/camera";
import {
  VIEW_CUBE_CORNERS,
  VIEW_CUBE_FACES,
  cornerDirection,
  type ViewCubeAction,
  type ViewCubeCorner,
  type ViewCubeFace,
  type ViewCubeRotation,
} from "../camera/view-cube";
import { dot, normalize, subtract, type Vec3 } from "../math/vec3";
import { transformDirection } from "../math/mat4";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const CENTER = 50;
const CUBE_SCALE = 22;
const CORNER_RADIUS = 4;

const AXIS_COLORS = {
  x: "#ef6b6b",
  y: "#67c587",
  z: "#6fa8ed",
} as const;

type CubePoint = readonly [number, number, number];

const FACE_CORNERS: Readonly<Record<ViewCubeFace, readonly CubePoint[]>> = {
  front: [
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ],
  back: [
    [1, -1, -1],
    [-1, -1, -1],
    [-1, 1, -1],
    [1, 1, -1],
  ],
  right: [
    [1, -1, 1],
    [1, -1, -1],
    [1, 1, -1],
    [1, 1, 1],
  ],
  left: [
    [-1, -1, -1],
    [-1, -1, 1],
    [-1, 1, 1],
    [-1, 1, -1],
  ],
  top: [
    [-1, 1, 1],
    [1, 1, 1],
    [1, 1, -1],
    [-1, 1, -1],
  ],
  bottom: [
    [-1, -1, -1],
    [1, -1, -1],
    [1, -1, 1],
    [-1, -1, 1],
  ],
};

interface FaceElements {
  readonly id: ViewCubeFace;
  readonly direction: Vec3;
  readonly group: SVGGElement;
  readonly polygon: SVGPolygonElement;
  readonly label: SVGTextElement;
}

interface CornerElements {
  readonly id: ViewCubeCorner;
  readonly group: SVGGElement;
  readonly circle: SVGCircleElement;
}

interface ArrowElements {
  readonly rotation: ViewCubeRotation;
  readonly group: SVGGElement;
}

const ROLL_GLYPHS = {
  clockwise: {
    path: "M 10 25 A 15 15 0 0 1 25 10",
    head: "25 10 21 11 24 14",
  },
  counterclockwise: {
    path: "M 90 75 A 15 15 0 0 1 75 90",
    head: "75 90 79 89 76 86",
  },
} as const satisfies Readonly<
  Record<"clockwise" | "counterclockwise", { readonly path: string; readonly head: string }>
>;

/** DOM retained by one viewport-owned view cube across camera updates. */
export interface OrientationGizmoElements {
  readonly root: HTMLDivElement;
  readonly svg: SVGSVGElement;
  readonly faces: readonly FaceElements[];
  readonly corners: readonly CornerElements[];
  readonly arrows: readonly ArrowElements[];
}

/** Creates the retained SVG nodes for the viewport-owned view cube. */
export function createOrientationGizmoElements(
  onAction: (action: ViewCubeAction) => void,
): OrientationGizmoElements {
  const root = createRoot();
  const svg = createSvg();
  const faces = createFaces(svg, onAction);
  const corners = createCorners(svg, onAction);
  const arrows = createArrows(svg, onAction);
  root.appendChild(svg);
  return { root, svg, faces, corners, arrows };
}

/** Updates retained face/corner geometry and hit-region visibility. */
export function updateOrientationGizmoElements(
  elements: OrientationGizmoElements,
  camera: Camera,
): void {
  const matrix = viewMatrix(camera);
  const eyeDirection = normalize(subtract(camera.position, camera.target));
  const project = (point: Vec3): ProjectedPoint => projectPoint(matrix, point);

  const sortedFaces = elements.faces
    .map((face) => ({ face, depth: dot(face.direction, eyeDirection) }))
    .sort((a, b) => a.depth - b.depth);
  for (const { face, depth } of sortedFaces) {
    const visible = depth > 0;
    const points = FACE_CORNERS[face.id].map(project);
    face.polygon.setAttribute("points", points.map(formatPoint).join(" "));
    const center = project(face.direction);
    face.label.setAttribute("x", center.x.toFixed(2));
    face.label.setAttribute("y", center.y.toFixed(2));
    face.group.style.opacity = visible ? "1" : "0";
    face.group.style.pointerEvents = visible ? "auto" : "none";
    elements.svg.appendChild(face.group);
  }

  for (const corner of elements.corners) {
    const direction = cornerDirection(corner.id);
    const point = project(direction);
    const visible = dot(direction, eyeDirection) > 0;
    corner.circle.setAttribute("cx", point.x.toFixed(2));
    corner.circle.setAttribute("cy", point.y.toFixed(2));
    corner.group.style.opacity = visible ? "1" : "0";
    corner.group.style.pointerEvents = visible ? "auto" : "none";
    elements.svg.appendChild(corner.group);
  }
}

function createRoot(): HTMLDivElement {
  const root = document.createElement("div");
  root.className = "femgx-orientation-gizmo";
  root.setAttribute("data-femgx-orientation-gizmo", "true");
  root.setAttribute("role", "group");
  root.setAttribute(
    "aria-label",
    "View cube. Faces and corners snap the view. Arrow buttons pitch or yaw the view; clockwise and counterclockwise buttons rotate in-plane. All buttons rotate 15 degrees; Shift rotates 90 degrees; Control or Command rotates 5 degrees.",
  );
  Object.assign(root.style, {
    position: "absolute",
    zIndex: "4",
    left: "14px",
    bottom: "14px",
    width: "clamp(82px, 10vw, 112px)",
    height: "clamp(82px, 10vw, 112px)",
    border: "1px solid #2c405a",
    borderRadius: "9px",
    background: "#0b1728df",
    boxShadow: "0 10px 30px #06101ea8",
    pointerEvents: "none",
    userSelect: "none",
  });
  return root;
}

function createSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "false");
  svg.setAttribute("focusable", "false");
  Object.assign(svg.style, {
    display: "block",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
  });
  const style = document.createElementNS(SVG_NAMESPACE, "style");
  style.textContent = `
    [data-view-cube-target]:focus polygon,
    [data-view-cube-target]:focus circle,
    [data-view-cube-target]:focus path[data-view-cube-glyph] { stroke: #ffffff; stroke-width: 2; }
    [data-view-cube-target]:hover polygon,
    [data-view-cube-target]:hover circle,
    [data-view-cube-target]:hover path[data-view-cube-glyph] { filter: brightness(1.25); }
  `;
  svg.appendChild(style);
  return svg;
}

function createFaces(
  svg: SVGSVGElement,
  onAction: (action: ViewCubeAction) => void,
): FaceElements[] {
  return VIEW_CUBE_FACES.map((face) => {
    const group = document.createElementNS(SVG_NAMESPACE, "g");
    const polygon = document.createElementNS(SVG_NAMESPACE, "polygon");
    const label = document.createElementNS(SVG_NAMESPACE, "text");
    const color = axisColor(face.axis);
    group.setAttribute("data-view-face", face.id);
    configureTarget(
      group,
      `View ${face.label} (${face.axis})`,
      () => ({ kind: "face", face: face.id }),
      onAction,
    );
    polygon.setAttribute("fill", color);
    polygon.setAttribute("fill-opacity", "0.82");
    polygon.setAttribute("stroke", "#0b1728");
    polygon.setAttribute("stroke-width", "0.8");
    label.setAttribute("fill", "#f5f8fc");
    label.setAttribute("font-size", "8");
    label.setAttribute("font-weight", "750");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("pointer-events", "none");
    label.textContent = face.axis;
    group.appendChild(polygon);
    group.appendChild(label);
    svg.appendChild(group);
    return { id: face.id, direction: face.direction, group, polygon, label };
  });
}

function createCorners(
  svg: SVGSVGElement,
  onAction: (action: ViewCubeAction) => void,
): CornerElements[] {
  return VIEW_CUBE_CORNERS.map((corner) => {
    const group = document.createElementNS(SVG_NAMESPACE, "g");
    const circle = document.createElementNS(SVG_NAMESPACE, "circle");
    group.setAttribute("data-view-corner", corner);
    configureTarget(group, `View corner ${corner}`, () => ({ kind: "corner", corner }), onAction);
    circle.setAttribute("r", String(CORNER_RADIUS));
    circle.setAttribute("fill", "#e7edf5");
    circle.setAttribute("fill-opacity", "0.9");
    circle.setAttribute("stroke", "#0b1728");
    circle.setAttribute("stroke-width", "0.8");
    group.appendChild(circle);
    svg.appendChild(group);
    return { id: corner, group, circle };
  });
}

function createArrows(
  svg: SVGSVGElement,
  onAction: (action: ViewCubeAction) => void,
): ArrowElements[] {
  return (
    [
      ["left", "Rotate view left"],
      ["right", "Rotate view right"],
      ["up", "Rotate view up"],
      ["down", "Rotate view down"],
      ["clockwise", "Rotate view clockwise"],
      ["counterclockwise", "Rotate view counterclockwise"],
    ] as const
  ).map(([rotation, label]) => {
    const group = document.createElementNS(SVG_NAMESPACE, "g");
    group.setAttribute("data-rotate", rotation);
    configureTarget(
      group,
      `${label} 15 degrees; Shift 90 degrees; Control or Command 5 degrees`,
      (event) => ({ kind: "rotate", rotation, stepDegrees: stepDegrees(event) }),
      onAction,
    );
    if (rotation === "clockwise" || rotation === "counterclockwise") {
      appendRollGlyph(group, rotation);
    } else {
      appendPitchYawGlyph(group, rotation);
    }
    svg.appendChild(group);
    return { rotation, group };
  });
}

function appendPitchYawGlyph(group: SVGGElement, rotation: "left" | "right" | "up" | "down"): void {
  const polygon = document.createElementNS(SVG_NAMESPACE, "polygon");
  polygon.setAttribute("points", arrowPoints(rotation));
  polygon.setAttribute("fill", "#a9bbd1");
  polygon.setAttribute("stroke", "#0b1728");
  polygon.setAttribute("stroke-width", "0.8");
  group.appendChild(polygon);
}

function appendRollGlyph(group: SVGGElement, rotation: "clockwise" | "counterclockwise"): void {
  const glyph = ROLL_GLYPHS[rotation];
  const hitPath = document.createElementNS(SVG_NAMESPACE, "path");
  hitPath.setAttribute("d", glyph.path);
  hitPath.setAttribute("fill", "none");
  hitPath.setAttribute("stroke", "#ffffff");
  hitPath.setAttribute("stroke-opacity", "0.001");
  hitPath.setAttribute("stroke-width", "10");
  const path = document.createElementNS(SVG_NAMESPACE, "path");
  path.setAttribute("d", glyph.path);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#a9bbd1");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-width", "2.5");
  path.setAttribute("data-view-cube-glyph", "true");
  path.setAttribute("pointer-events", "none");
  const head = document.createElementNS(SVG_NAMESPACE, "polygon");
  head.setAttribute("points", glyph.head);
  head.setAttribute("fill", "#a9bbd1");
  head.setAttribute("data-view-cube-glyph", "true");
  head.setAttribute("pointer-events", "none");
  group.appendChild(hitPath);
  group.appendChild(path);
  group.appendChild(head);
}

function configureTarget(
  target: SVGGElement,
  label: string,
  action: (event: KeyboardEvent | MouseEvent) => ViewCubeAction,
  onAction: (action: ViewCubeAction) => void,
): void {
  target.setAttribute("data-view-cube-target", "true");
  target.setAttribute("role", "button");
  target.setAttribute("tabindex", "0");
  target.setAttribute("aria-label", label);
  target.style.pointerEvents = "auto";
  target.addEventListener("click", (event: MouseEvent) => {
    onAction(action(event));
  });
  target.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onAction(action(event));
  });
}

interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
}

function projectPoint(matrix: ReturnType<typeof viewMatrix>, point: Vec3): ProjectedPoint {
  const projected = transformDirection(matrix, point);
  const x = finite(projected[0]);
  const y = finite(-projected[1]);
  return { x: CENTER + x * CUBE_SCALE, y: CENTER + y * CUBE_SCALE };
}

function formatPoint(point: ProjectedPoint): string {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

function axisColor(axis: string): string {
  return axis.includes("X") ? AXIS_COLORS.x : axis.includes("Y") ? AXIS_COLORS.y : AXIS_COLORS.z;
}

function arrowPoints(rotation: "left" | "right" | "up" | "down"): string {
  switch (rotation) {
    case "left":
      return "17,44 17,56 8,50";
    case "right":
      return "83,44 83,56 92,50";
    case "up":
      return "44,17 56,17 50,8";
    case "down":
      return "44,83 56,83 50,92";
  }
}

function stepDegrees(event: KeyboardEvent | MouseEvent): 5 | 15 | 90 {
  if (event.shiftKey) return 90;
  if (event.ctrlKey || event.metaKey) return 5;
  return 15;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
