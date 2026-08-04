import {
  createInteractionState,
  flattenAssembly,
  projectPoint,
  resolveInstanceStyle,
  setHoveredInstance,
  setInstanceSelected,
  transformPoint,
  type InstanceId,
  type InteractionState,
} from "../src/index";
import { installCameraControls } from "./camera-controls";
import type { DemoFixture } from "./fixture";
import {
  installProjectionControl,
  installResetControl,
  installResizeControl,
  updateStatus,
  type CameraRef,
  type ControlContext,
  type DemoView,
} from "./view";

/** Inputs for the deterministic CPU (2D canvas) renderer. */
export interface CpuDemoOptions {
  readonly view: DemoView;
  readonly fixture: DemoFixture;
}

/** Starts the deterministic 2D canvas renderer, used when WebGPU is unusable. */
export function startCpuDemo(options: CpuDemoOptions): void {
  const { view, fixture } = options;
  const { canvas } = view;
  const contextElement = canvas.getContext("2d");
  if (contextElement === null) {
    throw new Error("2d context unavailable");
  }
  const context: CanvasRenderingContext2D = contextElement;
  canvas.dataset["renderer"] = "cpu";

  const instances = flattenAssembly({
    assemblyId: fixture.scene.rootAssemblyId,
    assemblies: fixture.scene.assemblies,
    visibleAssemblyIds: fixture.scene.visibleAssemblyIds,
    visiblePartIds: fixture.scene.visiblePartIds,
  });
  const cameraRef: CameraRef = { camera: fixture.initialCamera };
  let interaction: InteractionState = createInteractionState();

  function render(): void {
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const instance of instances) {
      const partGeometry = fixture.geometryByPartId.get(instance.partId);
      if (partGeometry === undefined) continue;
      const points: Array<readonly [number, number, number]> = [];
      for (let i = 0; i < partGeometry.positions.length; i += 3) {
        const world = transformPoint(
          instance.worldTransform,
          partGeometry.positions[i] ?? 0,
          partGeometry.positions[i + 1] ?? 0,
          partGeometry.positions[i + 2] ?? 0,
        );
        const screen = projectPoint(cameraRef.camera, world);
        if (screen === undefined) break;
        points.push(screen);
      }
      if (points.length < 3) continue;
      const baseColor = fixture.partColors.get(instance.partId) ?? fixture.fallbackColor;
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

  function nearestInstance(x: number, y: number): InstanceId | undefined {
    let nearest: { readonly id: InstanceId; readonly distance: number } | undefined;
    for (const instance of instances) {
      const point = projectPoint(
        cameraRef.camera,
        transformPoint(instance.worldTransform, 0, 0, 0),
      );
      if (point === undefined) continue;
      const distance = Math.hypot(point[0] - x, point[1] - y);
      if (distance < 60 && (nearest === undefined || distance < nearest.distance)) {
        nearest = { id: instance.instanceId, distance };
      }
    }
    return nearest?.id;
  }

  installCameraControls({
    canvas,
    cameraRef,
    onMove: (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
      const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
      interaction = setHoveredInstance(interaction, nearestInstance(x, y));
      canvas.dataset["hovered"] = interaction.hoveredInstanceId ?? "";
    },
    onRender: render,
  });

  canvas.addEventListener("click", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const instanceId = nearestInstance(x, y);
    if (instanceId !== undefined) {
      const selected = interaction.selectedInstanceIds.has(instanceId);
      interaction = setInstanceSelected(interaction, instanceId, !selected);
      canvas.dataset["selected"] = interaction.selectedInstanceIds.has(instanceId)
        ? instanceId
        : "";
      render();
    }
  });

  const instanceCount = instances.length;
  const partCount = fixture.scene.parts.size;
  const contextControls: ControlContext = {
    view,
    cameraRef,
    instanceCount,
    partCount,
    onRender: render,
  };
  installProjectionControl(contextControls);
  installResetControl(contextControls, fixture.initialCamera, resetInteraction);
  installResizeControl(view, cameraRef, render);

  updateStatus(view, cameraRef.camera, instanceCount, partCount);
  render();

  function resetInteraction(): void {
    interaction = createInteractionState();
    canvas.dataset["hovered"] = "";
    canvas.dataset["selected"] = "";
  }
}
