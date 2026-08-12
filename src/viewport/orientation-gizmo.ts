import { viewMatrix, type Camera } from "../camera/camera";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const CENTER = 50;
const AXIS_LENGTH = 31;

const AXES = [
  { id: "+x", label: "+X", color: "#ef6b6b", direction: [1, 0, 0] },
  { id: "-x", label: "−X", color: "#ef6b6b", direction: [-1, 0, 0] },
  { id: "+y", label: "+Y", color: "#67c587", direction: [0, 1, 0] },
  { id: "-y", label: "−Y", color: "#67c587", direction: [0, -1, 0] },
  { id: "+z", label: "+Z", color: "#6fa8ed", direction: [0, 0, 1] },
  { id: "-z", label: "−Z", color: "#6fa8ed", direction: [0, 0, -1] },
] as const;

/** Host element that receives femgx's non-interactive orientation display. */
export interface OrientationGizmoOptions {
  readonly container: HTMLElement;
}

/** Internal lifecycle handle for one viewport-owned orientation display. */
export interface OrientationGizmoHandle {
  update(camera: Camera): void;
  destroy(): void;
}

interface AxisElements {
  readonly direction: readonly [number, number, number];
  readonly line: SVGLineElement;
  readonly label: SVGTextElement;
}

/** Creates the fixed SVG orientation display owned by one FemViewport. */
export function createOrientationGizmo(options: OrientationGizmoOptions): OrientationGizmoHandle {
  const root = createRoot();
  const svg = createSvg(root);
  const axes = createAxes(svg);

  const originalPosition = options.container.style.position;
  const computedPosition =
    typeof getComputedStyle === "undefined"
      ? originalPosition
      : getComputedStyle(options.container).position;
  const ownsPosition = computedPosition === "static" || computedPosition === "";
  if (ownsPosition) options.container.style.position = "relative";
  options.container.appendChild(root);

  let destroyed = false;
  return {
    update: (camera) => {
      if (destroyed) return;
      updateAxes(axes, camera);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      root.remove();
      if (ownsPosition && options.container.style.position === "relative") {
        options.container.style.position = originalPosition;
      }
    },
  };
}

function createRoot(): HTMLDivElement {
  const root = document.createElement("div");
  root.className = "femgx-orientation-gizmo";
  root.setAttribute("data-femgx-orientation-gizmo", "true");
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", "World coordinate orientation");
  Object.assign(root.style, {
    position: "absolute",
    zIndex: "4",
    left: "14px",
    bottom: "14px",
    width: "clamp(68px, 8vw, 86px)",
    height: "clamp(68px, 8vw, 86px)",
    border: "1px solid #2c405a",
    borderRadius: "9px",
    background: "#0b1728df",
    boxShadow: "0 10px 30px #06101ea8",
    pointerEvents: "none",
    userSelect: "none",
  });
  return root;
}

function createSvg(root: HTMLDivElement): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");
  Object.assign(svg.style, { display: "block", width: "100%", height: "100%" });
  svg.appendChild(createCenterMarker());
  root.appendChild(svg);
  return svg;
}

function createCenterMarker(): SVGCircleElement {
  const center = document.createElementNS(SVG_NAMESPACE, "circle");
  center.setAttribute("data-center-marker", "true");
  center.setAttribute("cx", String(CENTER));
  center.setAttribute("cy", String(CENTER));
  center.setAttribute("r", "3");
  center.setAttribute("fill", "#e7edf5");
  return center;
}

function createAxes(svg: SVGSVGElement): AxisElements[] {
  const axes: AxisElements[] = [];
  for (const axis of AXES) {
    const line = document.createElementNS(SVG_NAMESPACE, "line");
    configureLine(line, axis.id, axis.color);
    const label = document.createElementNS(SVG_NAMESPACE, "text");
    configureLabel(label, axis.id, axis.color, axis.label);
    svg.appendChild(line);
    svg.appendChild(label);
    axes.push({ direction: axis.direction, line, label });
  }
  return axes;
}

function configureLine(line: SVGLineElement, id: string, color: string): void {
  line.setAttribute("data-axis", id);
  line.setAttribute("x1", String(CENTER));
  line.setAttribute("y1", String(CENTER));
  line.setAttribute("x2", String(CENTER));
  line.setAttribute("y2", String(CENTER));
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-width", "3");
}

function configureLabel(label: SVGTextElement, id: string, color: string, text: string): void {
  label.setAttribute("data-axis", id);
  label.setAttribute("fill", color);
  label.setAttribute("font-size", "12");
  label.setAttribute("font-weight", "750");
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "middle");
  label.textContent = text;
}

function updateAxes(axes: readonly AxisElements[], camera: Camera): void {
  const matrix = viewMatrix(camera);
  for (const axis of axes) {
    const [x, y, z] = axis.direction;
    const screenX = finite((matrix[0] ?? 0) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z);
    const screenY = finite(-((matrix[1] ?? 0) * x + (matrix[5] ?? 0) * y + (matrix[9] ?? 0) * z));
    const depth = finite((matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 0) * z);
    const projectedLength = Math.hypot(screenX, screenY);
    const endX = CENTER + screenX * AXIS_LENGTH;
    const endY = CENTER + screenY * AXIS_LENGTH;
    axis.line.setAttribute("x2", endX.toFixed(2));
    axis.line.setAttribute("y2", endY.toFixed(2));
    axis.line.style.opacity = String(depth > 0 ? 0.55 : 1);
    axis.label.setAttribute("x", (CENTER + screenX * (AXIS_LENGTH + 8)).toFixed(2));
    axis.label.setAttribute("y", (CENTER + screenY * (AXIS_LENGTH + 8) + 4).toFixed(2));
    axis.label.style.opacity = String(projectedLength < 0.12 ? 0 : depth > 0 ? 0.55 : 1);
  }
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
