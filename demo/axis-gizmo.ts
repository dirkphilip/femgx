import { viewMatrix, type Camera } from "../src/index";

interface AxisDefinition {
  readonly id:
    "x-positive" | "x-negative" | "y-positive" | "y-negative" | "z-positive" | "z-negative";
  readonly direction: readonly [number, number, number];
}

const AXES: readonly AxisDefinition[] = [
  { id: "x-positive", direction: [1, 0, 0] },
  { id: "x-negative", direction: [-1, 0, 0] },
  { id: "y-positive", direction: [0, 1, 0] },
  { id: "y-negative", direction: [0, -1, 0] },
  { id: "z-positive", direction: [0, 0, 1] },
  { id: "z-negative", direction: [0, 0, -1] },
];

/** Updates the small world-axis overlay to match the current camera orientation. */
export function updateAxisGizmo(root: HTMLElement, camera: Camera): void {
  const matrix = viewMatrix(camera);
  const center = 50;
  const length = 31;
  for (const definition of AXES) {
    const line = root.querySelector<SVGLineElement>(`[data-axis-line="${definition.id}"]`);
    const label = root.querySelector<SVGTextElement>(`[data-axis-label="${definition.id}"]`);
    if (line === null || label === null) continue;
    const screenX =
      (matrix[0] ?? 0) * definition.direction[0] +
      (matrix[4] ?? 0) * definition.direction[1] +
      (matrix[8] ?? 0) * definition.direction[2];
    const screenY = -(
      (matrix[1] ?? 0) * definition.direction[0] +
      (matrix[5] ?? 0) * definition.direction[1] +
      (matrix[9] ?? 0) * definition.direction[2]
    );
    const depth =
      (matrix[2] ?? 0) * definition.direction[0] +
      (matrix[6] ?? 0) * definition.direction[1] +
      (matrix[10] ?? 0) * definition.direction[2];
    const projectedLength = Math.hypot(screenX, screenY);
    const endX = center + screenX * length;
    const endY = center + screenY * length;
    line.setAttribute("x2", endX.toFixed(2));
    line.setAttribute("y2", endY.toFixed(2));
    line.style.opacity = String(depth > 0 ? 0.55 : 1);
    label.setAttribute("x", (center + screenX * (length + 8)).toFixed(2));
    label.setAttribute("y", (center + screenY * (length + 8) + 4).toFixed(2));
    label.style.opacity = String(projectedLength < 0.12 ? 0 : depth > 0 ? 0.55 : 1);
  }
}
