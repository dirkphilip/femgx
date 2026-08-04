import {
  createInteractionState,
  createSceneRuntime,
  setHoveredInstance,
  setInstanceSelected,
  type InstanceId,
  type InteractionState,
  type PickTarget,
  type SceneRuntime,
  type WebGpuRenderer,
} from "../src/index";
import { installCameraControls } from "./camera-controls";
import { startCpuDemo } from "./cpu-demo";
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
import type { RendererFactory } from "./webgpu-probe";

/** Inputs for the WebGPU demo path. */
export interface WebGpuDemoOptions {
  readonly view: DemoView;
  readonly fixture: DemoFixture;
  readonly createRenderer: RendererFactory;
}

/**
 * Starts the WebGPU renderer, falling back to the CPU renderer when probing
 * fails. Renders on demand and drives hover/selection through GPU picking.
 */
export async function startWebGpuDemo(options: WebGpuDemoOptions): Promise<void> {
  const { view, fixture, createRenderer } = options;
  const { canvas } = view;
  const renderer = await createRenderer();
  if (renderer === undefined) {
    startCpuDemo(options);
    return;
  }
  canvas.dataset["renderer"] = "webgpu";

  const runtime: SceneRuntime = createSceneRuntime(fixture.scene);
  const slotByInstanceId = new Map<InstanceId, number>();
  for (let slot = 0; slot < runtime.instanceCount; slot++) {
    const instanceId = runtime.getInstanceId(slot);
    if (instanceId !== undefined) slotByInstanceId.set(instanceId, slot);
  }

  const cameraRef: CameraRef = { camera: fixture.initialCamera };
  let gpuRenderer: WebGpuRenderer | undefined = renderer;
  let interaction: InteractionState = createInteractionState();
  let pickChain: Promise<unknown> = Promise.resolve();

  function renderGpu(): void {
    if (gpuRenderer === undefined) return;
    gpuRenderer.render(runtime, cameraRef.camera, fixture.scene.parts);
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

  installCameraControls({
    canvas,
    cameraRef,
    onMove: (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
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
    },
    onRender: renderGpu,
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

  const context: ControlContext = {
    view,
    cameraRef,
    instanceCount: runtime.instanceCount,
    partCount: fixture.scene.parts.size,
    onRender: renderGpu,
  };
  installProjectionControl(context);
  installResetControl(context, fixture.initialCamera, resetInteraction);
  installResizeControl(view, cameraRef, renderGpu, () => gpuRenderer?.resize());

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

  updateStatus(view, cameraRef.camera, runtime.instanceCount, fixture.scene.parts.size);
  renderGpu();

  function resetInteraction(): void {
    interaction = createInteractionState();
    canvas.dataset["hovered"] = "";
    canvas.dataset["selected"] = "";
  }
}
