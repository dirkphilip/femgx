import {
  changedInstanceSlots,
  createInteractionState,
  createWebGpuRenderer,
  type DeviceLostInfo,
  type InteractionState,
  type WebGpuRenderer,
} from "../src/index";
import { WorkbenchController, type RendererHooks, type RendererStats } from "./controller";
import type { DemoView } from "./view";
import { classifyWebGpuStartupError, type WebGpuStartupDiagnostic } from "./webgpu-startup";

/** Inputs for the WebGPU demo path. */
export interface WebGpuDemoOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
}

function renderFrame(
  gpuRenderer: WebGpuRenderer,
  canvas: HTMLCanvasElement,
  controller: WorkbenchController,
  state: InteractionState,
  previous: InteractionState,
): void {
  if (gpuRenderer.lost) return;
  const runtime = controller.runtime;
  const changed = changedInstanceSlots(runtime, previous, state);
  gpuRenderer.updateInstances(runtime, state, changed);
  gpuRenderer.updateElements(runtime, state);
  gpuRenderer.render(runtime, controller.cameraRef.camera, controller.preset.scene.parts);
  canvas.dataset["frames"] = String(Number(canvas.dataset["frames"] ?? "0") + 1);
}

/**
 * Starts the WebGPU demo renderer. WebGPU is the product's only renderer: when
 * it is unavailable the demo reports an explicit unsupported message instead of
 * degrading to a second rendering path. Startup failures are classified into a
 * stable phase (api/adapter/device, renderer setup, frame submission) that is
 * written to the canvas `data-webgpu-error` attribute and shown in the status
 * line; no failure is silently swallowed. A device loss recovers the renderer
 * once; when recovery fails the renderer is destroyed and the unsupported
 * message is shown. A loss reported while the renderer is still being created
 * is buffered and recovered once it is wired up.
 */
export async function startWebGpuDemo(
  options: WebGpuDemoOptions,
): Promise<WorkbenchController | undefined> {
  const { view, canvas } = options;
  let gpuRenderer: WebGpuRenderer | undefined;
  /** Loss observed before the renderer could run recovery. */
  let pendingDeviceLoss: DeviceLostInfo | undefined;
  /**
   * The interaction state last handed to `updateInstances`, so each frame can
   * patch only the instance slots that changed (see `changedInstanceSlots`).
   * A re-created or recovered renderer re-uploads from an empty interaction
   * state, so the baseline resets to empty when the attachment is rebuilt.
   */
  let appliedInteraction: InteractionState = createInteractionState();

  /** Shows the classified unsupported/error diagnostic on the demo's status line. */
  const reportUnsupported = (diagnostic: WebGpuStartupDiagnostic): void => {
    canvas.dataset["renderer"] = "unsupported";
    canvas.dataset["webgpu-error"] = diagnostic.phase;
    view.rendererStatus.textContent = "Renderer unsupported";
    view.status.textContent = diagnostic.message;
  };

  /** Recovers the renderer once, or reports the loss when recovery is impossible. */
  const recoverFromDeviceLoss = async (info: DeviceLostInfo): Promise<void> => {
    const renderer = gpuRenderer;
    if (renderer === undefined) {
      // The committed renderer subscribes at construction time, so it can
      // report a loss before `startWebGpuDemo` assigns it. Buffer the loss
      // instead of dropping it; recovery runs once the renderer is assigned
      // (see `drainPendingDeviceLoss`).
      pendingDeviceLoss = info;
      return;
    }
    try {
      await renderer.recover();
      appliedInteraction = createInteractionState();
      controller.rendererState = "recovered";
      canvas.dataset["recovery"] = "recovered";
      controller.render();
    } catch {
      renderer.destroy();
      gpuRenderer = undefined;
      canvas.dataset["recovery"] = "error";
      reportUnsupported({
        phase: "device",
        message: "The WebGPU device was lost and could not be recovered; reload to restart.",
      });
    }
  };

  /** Runs a loss buffered while the renderer was still being created. */
  const drainPendingDeviceLoss = (): void => {
    const info = pendingDeviceLoss;
    pendingDeviceLoss = undefined;
    if (info !== undefined) void recoverFromDeviceLoss(info);
  };

  const hooks: RendererHooks = {
    render: (active, state) => {
      if (gpuRenderer === undefined) return;
      renderFrame(gpuRenderer, canvas, active, state, appliedInteraction);
      appliedInteraction = state;
    },
    applyVisibility: (active, state, changed) => {
      if (gpuRenderer === undefined || gpuRenderer.lost) return;
      gpuRenderer.updateVisibility(active.runtime, changed);
      renderFrame(gpuRenderer, canvas, active, state, appliedInteraction);
      appliedInteraction = state;
    },
    stats: (active): RendererStats => {
      const stats = gpuRenderer?.stats();
      return {
        visibleInstances: active.runtime.visibleCount,
        batches: stats?.drawBatches ?? 0,
      };
    },
  };

  const controller = new WorkbenchController({
    view,
    canvas,
    rendererName: "webgpu",
    hooks,
    setEdgeDepthTest: (enabled) => {
      if (gpuRenderer !== undefined && !gpuRenderer.lost) gpuRenderer.setEdgeDepthTest(enabled);
    },
    onDestroy: () => {
      gpuRenderer?.destroy();
      gpuRenderer = undefined;
    },
  });

  try {
    gpuRenderer = await createWebGpuRenderer({
      canvas,
      onDeviceLost: (info) => {
        void recoverFromDeviceLoss(info);
      },
    });
  } catch (error) {
    controller.destroy();
    reportUnsupported(classifyWebGpuStartupError("renderer-setup", error));
    return undefined;
  }
  canvas.dataset["renderer"] = "webgpu";

  // A device lost during startup was buffered by `recoverFromDeviceLoss`; run
  // the same recovery now that the renderer is wired up.
  drainPendingDeviceLoss();
  try {
    controller.render();
  } catch (error) {
    // The first frame could not be submitted; destroy the renderer and report
    // the classified diagnostic instead of leaving an unhandled error.
    gpuRenderer.destroy();
    gpuRenderer = undefined;
    controller.destroy();
    reportUnsupported(classifyWebGpuStartupError("frame-submission", error));
    return undefined;
  }

  window.addEventListener("pagehide", () => {
    gpuRenderer?.destroy();
    gpuRenderer = undefined;
  });

  /**
   * Explicit lifecycle seam used by the e2e lane to exercise clean teardown,
   * re-initialization, and device-loss recovery through the demo.
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
      let recreated: WebGpuRenderer;
      try {
        recreated = await createWebGpuRenderer({
          canvas,
          onDeviceLost: (info) => {
            void recoverFromDeviceLoss(info);
          },
        });
      } catch (error) {
        reportUnsupported(classifyWebGpuStartupError("renderer-setup", error));
        return;
      }
      gpuRenderer = recreated;
      appliedInteraction = createInteractionState();
      canvas.dataset["renderer"] = "webgpu";
      drainPendingDeviceLoss();
      try {
        renderFrame(gpuRenderer, canvas, controller, controller.interaction, appliedInteraction);
        appliedInteraction = controller.interaction;
      } catch (error) {
        gpuRenderer.destroy();
        gpuRenderer = undefined;
        reportUnsupported(classifyWebGpuStartupError("frame-submission", error));
      }
    },
    forceDeviceLoss: () => {
      gpuRenderer?.device.destroy();
    },
  };

  return controller;
}
