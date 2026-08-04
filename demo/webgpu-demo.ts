import {
  createInteractionState,
  createSceneRuntime,
  setHoveredElement,
  setHoveredInstance,
  setElementSelected,
  setInstanceSelected,
  setPartOverride,
  type ElementRenderMode,
  type InstanceId,
  type InteractionState,
  type PickTarget,
  type SceneRuntime,
  type WebGpuRenderer,
} from "../src/index";
import { visiblePartIdsFor } from "../src/fixture/element-fixture";
import { installCameraControls } from "./camera-controls";
import { startCpuDemo } from "./cpu-demo";
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
import type { RendererFactory } from "./webgpu-probe";

/** Inputs for the WebGPU demo path. */
export interface WebGpuDemoOptions {
  readonly view: DemoView;
  readonly fixture: DemoFixture;
  readonly createRenderer: RendererFactory;
}

/** The string written to the hover/selection dataset for a pick target. */
function targetKey(target: PickTarget | undefined): string {
  if (target === undefined) return "";
  if (target.kind === "element") return `${target.instanceId}:${target.elementId}`;
  if (target.kind === "instance") return target.instanceId;
  return "";
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
  let mode: ElementRenderMode = fixture.elementFixture.defaultMode;

  function renderGpu(): void {
    if (gpuRenderer === undefined) return;
    gpuRenderer.render(runtime, cameraRef.camera, fixture.scene.parts);
    canvas.dataset["frames"] = String(Number(canvas.dataset["frames"] ?? "0") + 1);
  }

  /** Applies a mode's part visibility through the runtime and returns changed slots. */
  function applyModeVisibility(nextMode: ElementRenderMode): readonly number[] {
    const visible = visiblePartIdsFor(fixture.elementFixture, nextMode);
    const changed: number[] = [];
    for (const partId of fixture.scene.parts.keys()) {
      const delta = runtime.setPartVisible(partId, visible.has(partId));
      changed.push(...delta.changedInstanceIds);
    }
    return changed;
  }

  applyModeVisibility(mode);

  function patchInstancesFor(instanceIds: readonly (InstanceId | undefined)[]): void {
    if (gpuRenderer === undefined) return;
    const slots: number[] = [];
    for (const instanceId of instanceIds) {
      if (instanceId === undefined) continue;
      const slot = slotByInstanceId.get(instanceId);
      if (slot !== undefined) slots.push(slot);
    }
    if (slots.length > 0) gpuRenderer.updateInstances(runtime, interaction, slots);
  }

  function applyHover(target: PickTarget | undefined): void {
    if (gpuRenderer === undefined) return;
    const key = targetKey(target);
    if (key === canvas.dataset["hovered"]) return;
    const previousElement = interaction.hoveredElement?.instanceId;
    const previousInstance = interaction.hoveredInstanceId;
    interaction = setHoveredElement(
      interaction,
      target?.kind === "element"
        ? { instanceId: target.instanceId, elementId: target.elementId }
        : undefined,
    );
    interaction = setHoveredInstance(
      interaction,
      target?.kind === "element" || target?.kind === "instance" ? target.instanceId : undefined,
    );
    canvas.dataset["hovered"] = key;
    gpuRenderer.updateElements(runtime, interaction);
    patchInstancesFor([
      previousElement,
      previousInstance,
      interaction.hoveredElement?.instanceId,
      interaction.hoveredInstanceId,
    ]);
    renderGpu();
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
      pickChain = pickChain.then(async () => {
        applyHover(await applyGpuPick(x, y));
      });
    },
    onRender: renderGpu,
  });

  canvas.addEventListener("click", (event) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    void applyGpuPick(x, y).then((target) => {
      if (gpuRenderer === undefined) return;
      if (target?.kind === "element") {
        const ref = { instanceId: target.instanceId, elementId: target.elementId };
        const selected =
          interaction.selectedElementIds.get(ref.instanceId)?.has(ref.elementId) ?? false;
        interaction = setElementSelected(interaction, ref, !selected);
        canvas.dataset["selected"] = selected ? "" : `${ref.instanceId}:${ref.elementId}`;
        gpuRenderer.updateElements(runtime, interaction);
      } else if (target?.kind === "instance") {
        const instanceId = target.instanceId;
        const selected = interaction.selectedInstanceIds.has(instanceId);
        interaction = setInstanceSelected(interaction, instanceId, !selected);
        canvas.dataset["selected"] = selected ? "" : instanceId;
        const slot = slotByInstanceId.get(instanceId);
        if (slot !== undefined) gpuRenderer.updateInstances(runtime, interaction, [slot]);
      }
      renderGpu();
    });
  });

  const context: ControlContext = {
    view,
    cameraRef,
    instanceCount: runtime.instanceCount,
    partCount: fixture.scene.parts.size,
    mode: () => mode,
    onRender: renderGpu,
    setEdgeOverlay: (enabled) => {
      if (gpuRenderer === undefined) return;
      let next = interaction;
      for (const partId of fixture.scene.parts.keys()) {
        next = setPartOverride(next, partId, enabled ? { edge: true } : undefined);
      }
      interaction = next;
      const slots = Array.from({ length: runtime.instanceCount }, (_, index) => index);
      gpuRenderer.updateInstances(runtime, interaction, slots);
    },
    setEdgeDepthTest: (enabled) => gpuRenderer?.setEdgeDepthTest(enabled),
  };
  installProjectionControl(context);
  installEdgeOverlayControl(context);
  installDepthTestControl(context);
  installModeControl(context, (nextMode) => {
    const changed = applyModeVisibility(nextMode);
    mode = nextMode;
    if (changed.length > 0 && gpuRenderer !== undefined) {
      gpuRenderer.updateVisibility(runtime, changed);
    }
  });
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

  updateStatus(view, cameraRef.camera, context);
  renderGpu();

  function resetInteraction(): void {
    interaction = createInteractionState();
    canvas.dataset["hovered"] = "";
    canvas.dataset["selected"] = "";
    gpuRenderer?.updateElements(runtime, interaction);
    renderGpu();
  }
}
