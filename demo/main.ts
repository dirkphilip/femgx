import {
  createCamera,
  createInteractionState,
  createSceneRuntime,
  createWebGpuRenderer,
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
  type InstanceId,
  type InteractionState,
  type PartId,
  type PickTarget,
  type SceneRuntime,
  type Vec3,
  type WebGpuRenderer,
} from "../src/index";
import { createPanelFixture } from "../src/fixture/panel";

const canvasElement = document.querySelector<HTMLCanvasElement>("#view");
if (canvasElement === null) {
  throw new Error("missing #view canvas");
}
const canvas: HTMLCanvasElement = canvasElement;

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

const initialCamera = resizeCamera(
  createCamera({
    target: [dimensions.width / 2, dimensions.depth / 2, dimensions.stiffenerHeight / 2],
    position: [dimensions.width / 2 + 3, dimensions.depth / 2 + 3, 6],
  }),
  canvas.width,
  canvas.height,
);

function updateControls(camera: Camera, instanceCount: number, partCount: number): void {
  const mode = camera.mode === "perspective" ? "Perspective" : "Orthographic";
  projectionLabel.textContent = mode;
  projectionToggle.textContent = camera.mode === "perspective" ? "Orthographic" : "Perspective";
  status.textContent = `${instanceCount} instances · ${partCount} reusable parts · ${mode.toLowerCase()} camera`;
}

function installProjectionControls(
  cameraRef: { camera: Camera },
  onRender: () => void,
  instanceCount: number,
  partCount: number,
): void {
  projectionToggle.addEventListener("click", () => {
    cameraRef.camera = setProjection(
      cameraRef.camera,
      cameraRef.camera.mode === "perspective" ? "orthographic" : "perspective",
    );
    updateControls(cameraRef.camera, instanceCount, partCount);
    onRender();
  });
}

function installResizeControl(cameraRef: { camera: Camera }, onRender: () => void): void {
  window.addEventListener("resize", () => {
    const rect = canvas.getBoundingClientRect();
    cameraRef.camera = resizeCamera(cameraRef.camera, rect.width, rect.height);
    onRender();
  });
}

function startCpuDemo(): void {
  const contextElement = canvas.getContext("2d");
  if (contextElement === null) {
    throw new Error("2d context unavailable");
  }
  const context: CanvasRenderingContext2D = contextElement;
  canvas.dataset["renderer"] = "cpu";

  const instances = flattenAssembly({
    assemblyId: scene.rootAssemblyId,
    assemblies: scene.assemblies,
    visibleAssemblyIds: scene.visibleAssemblyIds,
    visiblePartIds: scene.visiblePartIds,
  });

  const cameraRef = { camera: initialCamera };
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
        const screen = projectPoint(cameraRef.camera, world);
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

  canvas.addEventListener("pointerdown", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    interaction = setHoveredInstance(interaction, nearestInstance(x, y));
    canvas.dataset["hovered"] = interaction.hoveredInstanceId ?? "";
    if (pointer !== undefined) {
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      cameraRef.camera = event.shiftKey
        ? panCamera(cameraRef.camera, dx / 100, -dy / 100)
        : orbitCamera(cameraRef.camera, -dx / 180, -dy / 180);
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
      canvas.dataset["selected"] = interaction.selectedInstanceIds.has(instanceId)
        ? instanceId
        : "";
      render();
    }
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      cameraRef.camera = zoomCamera(cameraRef.camera, event.deltaY / 1000);
      render();
    },
    { passive: false },
  );

  installProjectionControls(cameraRef, render, instances.length, scene.parts.size);
  resetButton.addEventListener("click", () => {
    cameraRef.camera = initialCamera;
    interaction = createInteractionState();
    canvas.dataset["hovered"] = "";
    canvas.dataset["selected"] = "";
    updateControls(cameraRef.camera, instances.length, scene.parts.size);
    render();
  });
  installResizeControl(cameraRef, render);

  updateControls(cameraRef.camera, instances.length, scene.parts.size);
  render();
}

/**
 * Starts the WebGPU demo when a renderer could be created and proven to render
 * and pick. This keeps the demo honest about capability: environments without
 * a working WebGPU presentation/picking path degrade to the CPU fallback.
 */
async function startWebGpuDemo(
  createRenderer: () => Promise<WebGpuRenderer | undefined>,
): Promise<void> {
  const renderer = await createRenderer();
  if (renderer === undefined) {
    startCpuDemo();
    return;
  }
  canvas.dataset["renderer"] = "webgpu";

  const runtime: SceneRuntime = createSceneRuntime(scene);
  const slotByInstanceId = new Map<InstanceId, number>();
  for (let slot = 0; slot < runtime.instanceCount; slot++) {
    const instanceId = runtime.getInstanceId(slot);
    if (instanceId !== undefined) slotByInstanceId.set(instanceId, slot);
  }

  const cameraRef = { camera: initialCamera };
  let gpuRenderer: WebGpuRenderer | undefined = renderer;
  let interaction: InteractionState = createInteractionState();
  let pointer: { readonly x: number; readonly y: number } | undefined;
  let pickChain: Promise<unknown> = Promise.resolve();

  function renderGpu(): void {
    if (gpuRenderer === undefined) return;
    gpuRenderer.render(runtime, cameraRef.camera, scene.parts);
    canvas.dataset["frames"] = String(Number(canvas.dataset["frames"] ?? "0") + 1);
  }

  function patchHover(previous: InstanceId | undefined, next: InstanceId | undefined): void {
    if (gpuRenderer === undefined) return;
    const slots: number[] = [];
    if (previous !== undefined) {
      const slot = slotByInstanceId.get(previous);
      if (slot !== undefined) slots.push(slot);
    }
    if (next !== undefined) {
      const slot = slotByInstanceId.get(next);
      if (slot !== undefined) slots.push(slot);
    }
    if (slots.length > 0) gpuRenderer.updateInstances(runtime, interaction, slots);
  }

  async function applyGpuPick(x: number, y: number): Promise<PickTarget | undefined> {
    if (gpuRenderer === undefined) return undefined;
    return gpuRenderer.pick(x, y);
  }

  canvas.addEventListener("pointerdown", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (pointer !== undefined) {
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      cameraRef.camera = event.shiftKey
        ? panCamera(cameraRef.camera, dx / 100, -dy / 100)
        : orbitCamera(cameraRef.camera, -dx / 180, -dy / 180);
      pointer = { x: event.clientX, y: event.clientY };
    }
    const previous = interaction.hoveredInstanceId;
    pickChain = pickChain.then(async () => {
      const target = await applyGpuPick(x, y);
      const next = target?.kind === "instance" ? target.instanceId : undefined;
      if (next !== previous) {
        interaction = setHoveredInstance(interaction, next);
        canvas.dataset["hovered"] = next ?? "";
        patchHover(previous, next);
      }
    });
    renderGpu();
  });

  canvas.addEventListener("pointerup", (event) => {
    pointer = undefined;
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener("click", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    void applyGpuPick(x, y).then((target) => {
      if (target?.kind === "instance") {
        const instanceId = target.instanceId;
        const selected = interaction.selectedInstanceIds.has(instanceId);
        interaction = setInstanceSelected(interaction, instanceId, !selected);
        canvas.dataset["selected"] = interaction.selectedInstanceIds.has(instanceId)
          ? instanceId
          : "";
        const slot = slotByInstanceId.get(instanceId);
        if (slot !== undefined) gpuRenderer?.updateInstances(runtime, interaction, [slot]);
      }
      renderGpu();
    });
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      cameraRef.camera = zoomCamera(cameraRef.camera, event.deltaY / 1000);
      renderGpu();
    },
    { passive: false },
  );

  installProjectionControls(cameraRef, renderGpu, runtime.instanceCount, scene.parts.size);
  resetButton.addEventListener("click", () => {
    cameraRef.camera = initialCamera;
    interaction = createInteractionState();
    canvas.dataset["hovered"] = "";
    canvas.dataset["selected"] = "";
    updateControls(cameraRef.camera, runtime.instanceCount, scene.parts.size);
    renderGpu();
  });
  window.addEventListener("resize", () => {
    const rect = canvas.getBoundingClientRect();
    cameraRef.camera = resizeCamera(cameraRef.camera, rect.width, rect.height);
    gpuRenderer?.resize();
    renderGpu();
  });

  window.addEventListener("pagehide", () => {
    gpuRenderer?.destroy();
    gpuRenderer = undefined;
  });

  /**
   * Explicit lifecycle seam used by the opt-in WebGPU e2e lane to exercise
   * clean teardown and re-initialization of the renderer through the demo.
   */
  (window as typeof window & { femgxDemo?: unknown }).femgxDemo = {
    destroyRenderer: () => {
      if (gpuRenderer === undefined) return;
      gpuRenderer.destroy();
      gpuRenderer = undefined;
      canvas.dataset["renderer"] = "destroyed";
    },
    recreateRenderer: async () => {
      if (gpuRenderer !== undefined) return;
      const recreated = await createRenderer();
      if (recreated === undefined) return;
      gpuRenderer = recreated;
      canvas.dataset["renderer"] = "webgpu";
      renderGpu();
    },
  };

  updateControls(cameraRef.camera, runtime.instanceCount, scene.parts.size);
  renderGpu();
}

function createWebGpuProbe(): () => Promise<WebGpuRenderer | undefined> {
  const probeTarget: Vec3 = [
    dimensions.width / 2,
    dimensions.depth / 2,
    dimensions.stiffenerHeight / 2,
  ];
  return async () => {
    let probe: WebGpuRenderer | undefined;
    let probeCanvas: HTMLCanvasElement | undefined;
    try {
      // Probe on a separate hidden canvas so the real view canvas keeps its
      // CPU 2d context if WebGPU turns out to be unusable.
      probeCanvas = document.createElement("canvas");
      probeCanvas.width = 800;
      probeCanvas.height = 600;
      probeCanvas.style.position = "fixed";
      probeCanvas.style.top = "0";
      probeCanvas.style.left = "0";
      probeCanvas.style.width = "800px";
      probeCanvas.style.height = "600px";
      probeCanvas.style.opacity = "0.01";
      probeCanvas.style.pointerEvents = "none";
      probeCanvas.style.zIndex = "-1";
      document.body.appendChild(probeCanvas);
      probe = await createWebGpuRenderer({ canvas: probeCanvas });
      const probeCamera = resizeCamera(
        createCamera({
          target: probeTarget,
          position: [dimensions.width / 2 + 3, dimensions.depth / 2 + 3, 6],
        }),
        probeCanvas.width,
        probeCanvas.height,
      );
      const runtime = createSceneRuntime(scene);
      probe.render(runtime, probeCamera, scene.parts);
      // Require a real pick hit near the model center, proving the renderer
      // can present, rasterize, and read back through the pick pass. Without
      // this the demo falls back to the deterministic CPU renderer.
      const width = probeCanvas.clientWidth;
      const height = probeCanvas.clientHeight;
      let verified = false;
      for (const [dx, dy] of [
        [0, 0],
        [-0.15, -0.15],
        [0.15, -0.15],
        [-0.15, 0.15],
        [0.15, 0.15],
      ]) {
        const dxF = dx ?? 0;
        const dyF = dy ?? 0;
        const target = await probe.pick(width / 2 + dxF * width, height / 2 + dyF * height);
        if (target?.kind === "instance") {
          verified = true;
          break;
        }
      }
      probe.destroy();
      probe = undefined;
      probeCanvas.remove();
      probeCanvas = undefined;
      if (!verified) return undefined;
      return await createWebGpuRenderer({ canvas });
    } catch {
      probe?.destroy();
      probeCanvas?.remove();
      return undefined;
    }
  };
}

const probe = createWebGpuProbe();
void startWebGpuDemo(probe);
