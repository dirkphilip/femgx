import {
  createInteractionState,
  flattenAssembly,
  projectPoint,
  resolveInstanceStyle,
  setHoveredInstance,
  setInstanceSelected,
  transformPoint,
  type ElementRenderMode,
  type InstanceId,
  type InteractionState,
} from "../src/index";
import { visiblePartIdsFor } from "../src/fixture/element-fixture";
import { installCameraControls } from "./camera-controls";
import type { DemoFixture } from "./fixture";
import {
  installDepthTestControl,
  installEdgeOverlayControl,
  installModeControl,
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
  let edgeOverlay = false;
  let mode: ElementRenderMode = fixture.elementFixture.defaultMode;

  function visiblePartIds(): ReadonlySet<number> {
    return visiblePartIdsFor(fixture.elementFixture, mode);
  }

  function render(): void {
    const visible = visiblePartIds();
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const instance of instances) {
      if (!visible.has(instance.partId)) continue;
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
      if (points.length === 0) continue;
      const baseColor = fixture.partColors.get(instance.partId) ?? fixture.fallbackColor;
      const style = resolveInstanceStyle(
        instance,
        { color: baseColor, emissive: 0, opacity: 1, edge: false },
        interaction,
      );
      context.strokeStyle = style.emissive > 0 ? "#f8fafc" : "#60a5fa";
      context.lineWidth = style.emissive > 0 ? 3 : 1;
      if (partGeometry.primitive === "lines") {
        for (let i = 0; i < partGeometry.indices.length; i += 2) {
          const from = points[partGeometry.indices[i] ?? 0];
          const to = points[partGeometry.indices[i + 1] ?? 0];
          if (from === undefined || to === undefined) continue;
          context.beginPath();
          context.moveTo(from[0], from[1]);
          context.lineTo(to[0], to[1]);
          context.stroke();
        }
        continue;
      }
      if (partGeometry.primitive === "points") {
        for (let i = 0; i < points.length; i += 4) {
          const point = points[i];
          if (point === undefined) continue;
          context.fillRect(point[0] - 2, point[1] - 2, 4, 4);
        }
        continue;
      }
      context.beginPath();
      context.moveTo(points[0]?.[0] ?? 0, points[0]?.[1] ?? 0);
      for (const point of points.slice(1)) context.lineTo(point[0], point[1]);
      context.closePath();
      context.fillStyle = `rgba(${style.color.r * 255}, ${style.color.g * 255}, ${style.color.b * 255}, ${style.opacity})`;
      context.fill();
      if (edgeOverlay || style.edge) {
        context.stroke();
      }
    }
  }

  function nearestInstance(x: number, y: number): InstanceId | undefined {
    const visible = visiblePartIds();
    let nearest: { readonly id: InstanceId; readonly distance: number } | undefined;
    for (const instance of instances) {
      if (!visible.has(instance.partId)) continue;
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
    mode: () => mode,
    onRender: render,
    setEdgeOverlay: (enabled) => {
      edgeOverlay = enabled;
    },
    setEdgeDepthTest: () => {
      // The 2D fallback has no depth buffer, so the depth-test control is inert.
    },
  };
  installProjectionControl(contextControls);
  installEdgeOverlayControl(contextControls);
  installDepthTestControl(contextControls);
  installModeControl(contextControls, (nextMode) => {
    mode = nextMode;
  });
  installResetControl(contextControls, fixture.initialCamera, resetInteraction);
  installResizeControl(view, cameraRef, render);

  updateStatus(view, cameraRef.camera, contextControls);
  render();

  function resetInteraction(): void {
    interaction = createInteractionState();
    canvas.dataset["hovered"] = "";
    canvas.dataset["selected"] = "";
  }
}
