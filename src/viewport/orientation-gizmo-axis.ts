import type { Mat4 } from "../math/mat4";
import { transformDirection } from "../math/mat4";
import type { Vec3 } from "../math/vec3";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const CENTER = 50;
const AXIS_SCALE = 24;
const AXIS_LABEL_OFFSET = 4;

const AXIS_COLORS = {
  x: "#ef6b6b",
  y: "#67c587",
  z: "#6fa8ed",
} as const;

interface AxisArmElements {
  readonly axis: "x" | "y" | "z";
  readonly direction: Vec3;
  readonly line: SVGLineElement;
  readonly arrow: SVGPolygonElement;
  readonly label: SVGTextElement;
}

export interface AxisElements {
  readonly group: SVGGElement;
  readonly origin: SVGCircleElement;
  readonly arms: readonly AxisArmElements[];
}

/** Creates the retained, non-interactive projected axis triad. */
export function createAxes(svg: SVGSVGElement): AxisElements {
  const group = document.createElementNS(SVG_NAMESPACE, "g");
  const origin = document.createElementNS(SVG_NAMESPACE, "circle");
  group.setAttribute("data-view-axis-triad", "true");
  group.setAttribute("aria-hidden", "true");
  group.style.pointerEvents = "none";
  origin.setAttribute("r", "2.4");
  origin.setAttribute("fill", "#f5f8fc");
  origin.setAttribute("stroke", "#0b1728");
  origin.setAttribute("stroke-width", "0.8");
  origin.setAttribute("vector-effect", "non-scaling-stroke");
  group.appendChild(origin);
  const arms = (
    [
      ["x", [1, 0, 0], "X"],
      ["y", [0, 1, 0], "Y"],
      ["z", [0, 0, 1], "Z"],
    ] as const
  ).map(([axis, direction, labelText]) => {
    const line = document.createElementNS(SVG_NAMESPACE, "line");
    const arrow = document.createElementNS(SVG_NAMESPACE, "polygon");
    const label = document.createElementNS(SVG_NAMESPACE, "text");
    line.setAttribute("data-view-axis-line", axis);
    line.setAttribute("stroke", axisColor(axis));
    line.setAttribute("stroke-width", "1.8");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    arrow.setAttribute("data-view-axis-arrow", axis);
    arrow.setAttribute("fill", axisColor(axis));
    arrow.setAttribute("vector-effect", "non-scaling-stroke");
    label.setAttribute("data-view-axis-label", axis);
    label.setAttribute("fill", axisColor(axis));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("pointer-events", "none");
    label.textContent = labelText;
    group.appendChild(line);
    group.appendChild(arrow);
    group.appendChild(label);
    return { axis, direction, line, arrow, label };
  });
  svg.appendChild(group);
  return { group, origin, arms };
}

/** Updates the retained triad from the camera's current view basis. */
export function updateAxes(axes: AxisElements, matrix: Mat4): void {
  const origin = { x: CENTER, y: CENTER };
  axes.origin.setAttribute("cx", origin.x.toFixed(2));
  axes.origin.setAttribute("cy", origin.y.toFixed(2));
  for (const arm of axes.arms) {
    const projected = transformDirection(matrix, arm.direction);
    const direction = { x: finite(projected[0]), y: finite(-projected[1]) };
    const projectedLength = Math.hypot(direction.x, direction.y);
    const visible = projectedLength > 0.08;
    const unit = visible
      ? { x: direction.x / projectedLength, y: direction.y / projectedLength }
      : { x: 0, y: 0 };
    const endpoint = {
      x: origin.x + direction.x * AXIS_SCALE,
      y: origin.y + direction.y * AXIS_SCALE,
    };
    const base = {
      x: endpoint.x - unit.x * 4,
      y: endpoint.y - unit.y * 4,
    };
    const perpendicular = { x: -unit.y * 2, y: unit.x * 2 };
    arm.line.setAttribute("x1", origin.x.toFixed(2));
    arm.line.setAttribute("y1", origin.y.toFixed(2));
    arm.line.setAttribute("x2", base.x.toFixed(2));
    arm.line.setAttribute("y2", base.y.toFixed(2));
    arm.arrow.setAttribute(
      "points",
      [
        endpoint,
        { x: base.x + perpendicular.x, y: base.y + perpendicular.y },
        { x: base.x - perpendicular.x, y: base.y - perpendicular.y },
      ]
        .map(formatPoint)
        .join(" "),
    );
    arm.label.setAttribute("x", (endpoint.x + unit.x * AXIS_LABEL_OFFSET).toFixed(2));
    arm.label.setAttribute("y", (endpoint.y + unit.y * AXIS_LABEL_OFFSET).toFixed(2));
    arm.label.setAttribute("text-anchor", labelAnchor(unit.x));
    arm.label.style.opacity = visible ? "1" : "0";
    arm.line.style.opacity = visible ? "1" : "0";
    arm.arrow.style.opacity = visible ? "1" : "0";
  }
}

function labelAnchor(horizontal: number): "start" | "middle" | "end" {
  if (horizontal > 0.2) return "start";
  if (horizontal < -0.2) return "end";
  return "middle";
}

function formatPoint(point: { readonly x: number; readonly y: number }): string {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

/** Returns the stable display color for a signed world axis. */
export function axisColor(axis: string): string {
  const normalized = axis.toUpperCase();
  return normalized.includes("X")
    ? AXIS_COLORS.x
    : normalized.includes("Y")
      ? AXIS_COLORS.y
      : AXIS_COLORS.z;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
