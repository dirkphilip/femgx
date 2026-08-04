import {
  createCamera,
  createInteractionState,
  flattenAssembly,
  orbitCamera,
  panCamera,
  projectPoint,
  resizeCamera,
  resolveInstanceStyle,
  setHoveredInstance,
  setInstanceSelected,
  setProjection,
  transformPoint,
  zoomCamera,
  type Camera,
  type Color,
  type Geometry,
  type InteractionState,
  type PartId,
} from "../src/index";
import { createPanelFixture } from "../src/fixture/panel";

const canvasElement = document.querySelector<HTMLCanvasElement>("#view");
if (canvasElement === null) {
  throw new Error("missing #view canvas");
}
const canvas: HTMLCanvasElement = canvasElement;

const fixture = createPanelFixture();
const { scene, dimensions } = fixture;
const geometryByPartId = new Map<PartId, Geometry>();
for (const part of scene.parts.values()) {
  geometryByPartId.set(part.id, part.geometry);
}
const partColors = new Map<PartId, Color>([
  [fixture.partIds.shell, { r: 0.23, g: 0.51, b: 0.96, a: 1 }],
  [fixture.partIds.stiffenerX, { r: 0.35, g: 0.82, b: 0.72, a: 1 }],
  [fixture.partIds.stiffenerY, { r: 0.95, g: 0.68, b: 0.32, a: 1 }],
]);
const fallbackColor: Color = { r: 0.5, g: 0.5, b: 0.5, a: 1 };

const instances = flattenAssembly({
  assemblyId: scene.rootAssemblyId,
  assemblies: scene.assemblies,
  visibleAssemblyIds: scene.visibleAssemblyIds,
  visiblePartIds: scene.visiblePartIds,
});

const contextElement = canvas.getContext("2d");
if (contextElement === null) {
  throw new Error("2d context unavailable");
}
const context: CanvasRenderingContext2D = contextElement;

const projectionToggleElement = document.querySelector<HTMLButtonElement>("#projection-toggle");
const projectionLabelElement = document.querySelector<HTMLElement>("#projection-label");
const resetButtonElement = document.querySelector<HTMLButtonElement>("#reset");
const statusElement = document.querySelector<HTMLElement>("#status");
if (
  projectionToggleElement === null ||
  projectionLabelElement === null ||
  resetButtonElement === null ||
  statusElement === null
) {
  throw new Error("missing demo controls");
}
const projectionToggle: HTMLButtonElement = projectionToggleElement;
const projectionLabel: HTMLElement = projectionLabelElement;
const resetButton: HTMLButtonElement = resetButtonElement;
const status: HTMLElement = statusElement;

const initialCamera = resizeCamera(
  createCamera({
    target: [dimensions.width / 2, dimensions.depth / 2, dimensions.stiffenerHeight / 2],
    position: [dimensions.width / 2 + 3, dimensions.depth / 2 + 3, 6],
  }),
  canvas.width,
  canvas.height,
);
let camera: Camera = initialCamera;
let interaction: InteractionState = createInteractionState();
let pointer: { readonly x: number; readonly y: number } | undefined;

function render(): void {
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (const instance of instances) {
    const partGeometry = geometryByPartId.get(instance.partId);
    if (partGeometry === undefined) continue;
    const points: Array<readonly [number, number, number]> = [];
    for (let i = 0; i < partGeometry.positions.length; i += 3) {
      const world = transformPoint(
        instance.worldTransform,
        partGeometry.positions[i] ?? 0,
        partGeometry.positions[i + 1] ?? 0,
        partGeometry.positions[i + 2] ?? 0,
      );
      const screen = projectPoint(camera, world);
      if (screen === undefined) break;
      points.push(screen);
    }
    if (points.length < 3) continue;
    const baseColor = partColors.get(instance.partId) ?? fallbackColor;
    const style = resolveInstanceStyle(
      instance,
      { color: baseColor, emissive: 0, opacity: 1 },
      interaction,
    );
    context.fillStyle = `rgba(${style.color.r * 255}, ${style.color.g * 255}, ${style.color.b * 255}, ${style.opacity})`;
    context.strokeStyle = style.emissive > 0 ? "#f8fafc" : "#60a5fa";
    context.lineWidth = style.emissive > 0 ? 3 : 1;
    context.beginPath();
    context.moveTo(points[0]?.[0] ?? 0, points[0]?.[1] ?? 0);
    for (const point of points.slice(1)) context.lineTo(point[0], point[1]);
    context.closePath();
    context.fill();
    context.stroke();
  }
}

function nearestInstance(x: number, y: number): string | undefined {
  let nearest: { readonly id: string; readonly distance: number } | undefined;
  for (const instance of instances) {
    const point = projectPoint(camera, transformPoint(instance.worldTransform, 0, 0, 0));
    if (point === undefined) continue;
    const distance = Math.hypot(point[0] - x, point[1] - y);
    if (distance < 60 && (nearest === undefined || distance < nearest.distance)) {
      nearest = { id: instance.instanceId, distance };
    }
  }
  return nearest?.id;
}

function updateControls(): void {
  const mode = camera.mode === "perspective" ? "Perspective" : "Orthographic";
  projectionLabel.textContent = mode;
  projectionToggle.textContent = camera.mode === "perspective" ? "Orthographic" : "Perspective";
  status.textContent = `${instances.length} instances · ${scene.parts.size} reusable parts · ${mode.toLowerCase()} camera`;
}

projectionToggle.addEventListener("click", () => {
  camera = setProjection(camera, camera.mode === "perspective" ? "orthographic" : "perspective");
  updateControls();
  render();
});

resetButton.addEventListener("click", () => {
  camera = initialCamera;
  interaction = createInteractionState();
  updateControls();
  render();
});

canvas.addEventListener("pointerdown", (event) => {
  pointer = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  interaction = setHoveredInstance(interaction, nearestInstance(x, y));
  if (pointer !== undefined) {
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    camera = event.shiftKey
      ? panCamera(camera, dx / 100, -dy / 100)
      : orbitCamera(camera, -dx / 180, -dy / 180);
    pointer = { x: event.clientX, y: event.clientY };
  }
  render();
});

canvas.addEventListener("pointerup", (event) => {
  pointer = undefined;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  const instanceId = nearestInstance(x, y);
  if (instanceId !== undefined) {
    const selected = interaction.selectedInstanceIds.has(instanceId);
    interaction = setInstanceSelected(interaction, instanceId, !selected);
    render();
  }
});

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    camera = zoomCamera(camera, event.deltaY / 1000);
    render();
  },
  { passive: false },
);

window.addEventListener("resize", () => {
  const rect = canvas.getBoundingClientRect();
  camera = resizeCamera(camera, rect.width, rect.height);
  render();
});

updateControls();
render();
