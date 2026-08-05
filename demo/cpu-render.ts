import {
  emphasizedFaceRefs,
  emphasizedNodeRefs,
  facesOf,
  projectPoint,
  resolveElementStyle,
  resolveInstanceStyle,
  transformPoint,
  type Camera,
  type Color,
  type FaceKey,
  type Instance,
  type InteractionState,
  type ResolvedStyle,
  type SceneRuntime,
  type Vec3,
} from "../src/index";
import type { ModelPreset } from "../src/fixture/presets";
import { faceEmphasisStyle, nodeEmphasisStyle } from "./emphasis";
import type { DisplayToggles } from "./controller";

/**
 * The deterministic 2D-canvas renderer used when WebGPU is unusable. It draws
 * per-triangle element styles (so element/face/node emphasis works), plus node
 * markers, face boundaries, normals, and ID labels driven by the workbench
 * display toggles. WebGPU and CPU share the same camera and interaction model.
 */

/** Everything the CPU fallback needs to draw one frame. */
export interface CpuFrameInput {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly preset: ModelPreset;
  readonly runtime: SceneRuntime;
  readonly camera: Camera;
  readonly interaction: InteractionState;
  readonly toggles: DisplayToggles;
}

interface SlotView {
  readonly slot: number;
  readonly instanceId: string;
  readonly partId: number;
  readonly transform: Float32Array;
  readonly visible: boolean;
}

/** Draws one deterministic CPU frame. */
export function drawCpuFrame(input: CpuFrameInput): void {
  const { context, canvas, camera } = input;
  const scale = canvas.width / Math.max(1, camera.width);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(scale, 0, 0, scale, 0, 0);

  const slotViews = buildSlotViews(input);
  for (const view of slotViews) {
    if (!view.visible) continue;
    drawInstance(input, view);
  }
  if (input.toggles.nodeMarkers) drawNodeMarkers(input, slotViews);
  drawFaceEmphasis(input, slotViews);
  if (input.toggles.ids) drawIdLabels(input, slotViews);
}

function buildSlotViews(input: CpuFrameInput): SlotView[] {
  const { runtime } = input;
  const views: SlotView[] = [];
  for (let slot = 0; slot < runtime.instanceCount; slot++) {
    const instanceId = runtime.getInstanceId(slot);
    const partId = runtime.instancePartIds[slot];
    if (instanceId === undefined || partId === undefined) continue;
    views.push({
      slot,
      instanceId,
      partId,
      transform: runtime.instanceWorldTransforms.subarray(slot * 16, slot * 16 + 16),
      visible: runtime.isInstanceVisible(slot),
    });
  }
  return views;
}

function drawInstance(input: CpuFrameInput, view: SlotView): void {
  const { context, preset, camera, interaction } = input;
  const part = preset.scene.parts.get(view.partId);
  if (part === undefined) return;
  const base = baseStyle(preset, view.partId);
  const instance = instanceFor(view);
  const geometry = part.geometry;
  const primitive = geometry.primitive ?? "triangles";
  if (primitive === "lines") {
    drawLines({
      context,
      camera,
      positions: geometry.positions,
      indices: geometry.indices,
      transform: view.transform,
      style: resolveInstanceStyle(instance, base, interaction),
    });
    return;
  }
  if (primitive === "points") {
    drawPoints(
      context,
      camera,
      geometry.positions,
      view.transform,
      resolveInstanceStyle(instance, base, interaction),
    );
    return;
  }
  drawTriangles({
    context,
    camera,
    positions: geometry.positions,
    indices: geometry.indices,
    elements: geometry.elements ?? [],
    transform: view.transform,
    instance,
    base,
    interaction,
  });
}

interface TriangleDraw {
  readonly context: CanvasRenderingContext2D;
  readonly camera: Camera;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly elements: readonly {
    readonly id: number;
    readonly triangleStart: number;
    readonly triangleCount: number;
  }[];
  readonly transform: Float32Array;
  readonly instance: Instance;
  readonly base: ResolvedStyle;
  readonly interaction: InteractionState;
}

function drawTriangles(draw: TriangleDraw): void {
  const { context, camera, positions, indices, elements, transform, instance, base, interaction } =
    draw;
  for (const element of elements) {
    const style = resolveElementStyle(instance, element.id, base, interaction);
    context.fillStyle = rgba(style.color, style.opacity);
    context.strokeStyle = rgba(style.color, style.opacity);
    context.lineWidth = style.edge ? 1 : 0;
    context.beginPath();
    const end = element.triangleStart + element.triangleCount;
    let elementDrawn = false;
    for (let triangle = element.triangleStart; triangle < end; triangle++) {
      const baseIndex = triangle * 3;
      const a = projectVertex(camera, transform, positions, indices[baseIndex] ?? 0);
      const b = projectVertex(camera, transform, positions, indices[baseIndex + 1] ?? 0);
      const c = projectVertex(camera, transform, positions, indices[baseIndex + 2] ?? 0);
      if (a === undefined || b === undefined || c === undefined) continue;
      // Cull back faces the way the WebGPU solid pipeline does (`cullMode:
      // "back"`): a triangle whose screen-space winding is clockwise faces away
      // from the camera. Without this, a single path that mixes front and back
      // faces (e.g. a thin plate seen at a shallow angle) lets the nonzero fill
      // rule cancel overlapping opposite-wound triangles to nothing.
      const signedArea = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      if (signedArea <= 0) continue;
      context.moveTo(a[0], a[1]);
      context.lineTo(b[0], b[1]);
      context.lineTo(c[0], c[1]);
      context.closePath();
      elementDrawn = true;
    }
    if (!elementDrawn) continue;
    context.fill();
    if (style.edge) context.stroke();
  }
}

interface LineDraw {
  readonly context: CanvasRenderingContext2D;
  readonly camera: Camera;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly transform: Float32Array;
  readonly style: ResolvedStyle;
}

function drawLines(draw: LineDraw): void {
  const { context, camera, positions, indices, transform, style } = draw;
  context.strokeStyle = rgba(style.color, style.opacity);
  context.lineWidth = style.emissive > 0 ? 3 : 1;
  for (let i = 0; i < indices.length; i += 2) {
    const a = projectVertex(camera, transform, positions, indices[i] ?? 0);
    const b = projectVertex(camera, transform, positions, indices[i + 1] ?? 0);
    if (a === undefined || b === undefined) continue;
    context.beginPath();
    context.moveTo(a[0], a[1]);
    context.lineTo(b[0], b[1]);
    context.stroke();
  }
}

function drawPoints(
  context: CanvasRenderingContext2D,
  camera: Camera,
  positions: Float32Array,
  transform: Float32Array,
  style: ResolvedStyle,
): void {
  context.fillStyle = rgba(style.color, style.opacity);
  for (let vertex = 0; vertex < positions.length; vertex += 12) {
    const point = projectVertex(camera, transform, positions, vertex / 3);
    if (point === undefined) continue;
    context.fillRect(point[0] - 2, point[1] - 2, 4, 4);
  }
}

function drawFaceEmphasis(input: CpuFrameInput, slotViews: readonly SlotView[]): void {
  const { context, camera, interaction, toggles } = input;
  const byId = new Map(slotViews.map((view) => [view.instanceId, view]));
  for (const ref of emphasizedFaceRefs(interaction)) {
    const view = byId.get(ref.instanceId);
    if (view === undefined || !view.visible) continue;
    const model = input.preset.elementModels.get(view.partId);
    if (model === undefined) continue;
    const element = model.elements.find((candidate) => candidate.id === ref.elementId);
    if (element === undefined) continue;
    const face = facesOf(element).find((candidate) => candidate.key === ref.faceKey);
    if (face === undefined) continue;
    const screen = face.nodeIds.map((nodeId) =>
      projectPoint(camera, worldNode(model, view.transform, nodeId)),
    );
    if (screen.some((point) => point === undefined)) continue;
    const style = faceEmphasisStyle(interaction, ref.instanceId, ref.elementId, ref.faceKey);
    if (style === undefined) continue;
    fillPolygon(context, screen as Vec3[], style);
    strokePolygon(context, screen as Vec3[], style);
    if (toggles.faceBoundaries) {
      context.strokeStyle = "rgba(226, 232, 240, 0.9)";
      context.lineWidth = 1;
      tracePolygon(context, screen as Vec3[]);
      context.stroke();
    }
    if (toggles.normals) drawNormal(context, camera, view.transform, face, model);
  }
}

function drawNormal(
  context: CanvasRenderingContext2D,
  camera: Camera,
  transform: Float32Array,
  face: { readonly key: FaceKey; readonly nodeIds: readonly number[] },
  model: { readonly nodes: Float32Array },
): void {
  const vertices = face.nodeIds.map((nodeId) => worldNode(model, transform, nodeId));
  const centroid = average(vertices);
  const normal = faceNormal(vertices);
  const tip = [centroid[0] + normal[0], centroid[1] + normal[1], centroid[2] + normal[2]] as Vec3;
  const from = projectPoint(camera, centroid);
  const to = projectPoint(camera, tip);
  if (from === undefined || to === undefined) return;
  context.strokeStyle = "rgba(129, 140, 248, 0.95)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(from[0], from[1]);
  context.lineTo(to[0], to[1]);
  context.stroke();
}

function drawNodeMarkers(input: CpuFrameInput, slotViews: readonly SlotView[]): void {
  const { context, camera, interaction } = input;
  const byId = new Map(slotViews.map((view) => [view.instanceId, view]));
  for (const ref of emphasizedNodeRefs(interaction)) {
    const view = byId.get(ref.instanceId);
    if (view === undefined || !view.visible) continue;
    const model = input.preset.elementModels.get(view.partId);
    if (model === undefined) continue;
    const screen = projectPoint(camera, worldNode(model, view.transform, ref.nodeId));
    if (screen === undefined) continue;
    const style = nodeEmphasisStyle(interaction, ref.instanceId, ref.nodeId);
    if (style === undefined) continue;
    const color = style.color ?? { r: 1, g: 1, b: 1, a: 1 };
    context.fillStyle = rgba(color, 1);
    context.strokeStyle = "rgba(248, 250, 252, 0.9)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(screen[0], screen[1], 5, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }
}

function drawIdLabels(input: CpuFrameInput, slotViews: readonly SlotView[]): void {
  const { context, camera, interaction } = input;
  const byId = new Map(slotViews.map((view) => [view.instanceId, view]));
  context.font = "11px system-ui, sans-serif";
  context.textBaseline = "bottom";
  for (const ref of emphasizedNodeRefs(interaction)) {
    const view = byId.get(ref.instanceId);
    if (view === undefined || !view.visible) continue;
    const model = input.preset.elementModels.get(view.partId);
    if (model === undefined) continue;
    const screen = projectPoint(camera, worldNode(model, view.transform, ref.nodeId));
    if (screen === undefined) continue;
    context.fillStyle = "#f8fafc";
    context.fillText(`N${ref.nodeId}`, screen[0] + 6, screen[1] - 2);
  }
  for (const [instanceId, elements] of interaction.elementOverrides) {
    const view = byId.get(instanceId);
    if (view === undefined || !view.visible) continue;
    for (const elementId of elements.keys()) {
      const model = input.preset.elementModels.get(view.partId);
      if (model === undefined) continue;
      const element = model.elements.find((candidate) => candidate.id === elementId);
      if (element === undefined) continue;
      const centroid = average(
        element.nodeIds.map((nodeId) => worldNode(model, view.transform, nodeId)),
      );
      const screen = projectPoint(camera, centroid);
      if (screen === undefined) continue;
      context.fillStyle = "#f8fafc";
      context.fillText(`E${elementId}`, screen[0] + 4, screen[1] + 4);
    }
  }
}

function instanceFor(view: SlotView): Instance {
  return {
    index: view.slot,
    instanceId: view.instanceId,
    partId: view.partId,
    worldTransform: view.transform,
  };
}

function baseStyle(preset: ModelPreset, partId: number): ResolvedStyle {
  const color = preset.partColors.get(partId) ?? preset.fallbackColor;
  return { color, emissive: 0, opacity: 1, edge: false };
}

function projectVertex(
  camera: Camera,
  transform: Float32Array,
  positions: Float32Array,
  index: number,
): readonly [number, number, number] | undefined {
  const offset = index * 3;
  return projectPoint(
    camera,
    transformPoint(
      transform,
      positions[offset] ?? 0,
      positions[offset + 1] ?? 0,
      positions[offset + 2] ?? 0,
    ),
  );
}

function worldNode(
  model: { readonly nodes: Float32Array },
  transform: Float32Array,
  nodeId: number,
): Vec3 {
  return transformPoint(
    transform,
    model.nodes[nodeId * 3] ?? 0,
    model.nodes[nodeId * 3 + 1] ?? 0,
    model.nodes[nodeId * 3 + 2] ?? 0,
  );
}

function fillPolygon(
  context: CanvasRenderingContext2D,
  points: readonly Vec3[],
  style: StyleOverrideOrResolved,
): void {
  const color = style.color ?? { r: 1, g: 1, b: 1, a: 1 };
  context.fillStyle = rgba(color, 0.45);
  context.beginPath();
  context.moveTo(points[0]?.[0] ?? 0, points[0]?.[1] ?? 0);
  for (const point of points.slice(1)) context.lineTo(point[0], point[1]);
  context.closePath();
  context.fill();
}

function strokePolygon(
  context: CanvasRenderingContext2D,
  points: readonly Vec3[],
  style: StyleOverrideOrResolved,
): void {
  const color = style.color ?? { r: 1, g: 1, b: 1, a: 1 };
  context.strokeStyle = rgba(color, 0.95);
  context.lineWidth = 2;
  tracePolygon(context, points);
  context.stroke();
}

function tracePolygon(context: CanvasRenderingContext2D, points: readonly Vec3[]): void {
  context.beginPath();
  context.moveTo(points[0]?.[0] ?? 0, points[0]?.[1] ?? 0);
  for (const point of points.slice(1)) context.lineTo(point[0], point[1]);
  context.closePath();
}

type StyleOverrideOrResolved = {
  readonly color?: Color;
  readonly opacity?: number;
  readonly emissive?: number;
};

function faceNormal(vertices: readonly Vec3[]): Vec3 {
  const [a, b, c] = vertices as readonly [Vec3, Vec3, Vec3];
  const ax = b[0] - a[0];
  const ay = b[1] - a[1];
  const az = b[2] - a[2];
  const bx = c[0] - a[0];
  const by = c[1] - a[1];
  const bz = c[2] - a[2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const magnitude = Math.hypot(nx, ny, nz);
  if (magnitude === 0) return [0, 0, 1];
  return [nx / magnitude, ny / magnitude, nz / magnitude];
}

function average(points: readonly Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
    z += point[2];
  }
  const count = Math.max(1, points.length);
  return [x / count, y / count, z / count];
}

function rgba(color: Color, opacity: number): string {
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(
    color.b * 255,
  )}, ${opacity})`;
}
