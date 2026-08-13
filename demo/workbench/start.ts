import {
  createFemViewport,
  WebGpuUnsupportedError,
  type BoxSelectionRect,
  type FemViewport,
  type InteractionGranularity,
} from "../../src/index";
import { createModelPresets } from "../fixture/presets";
import { benchmarkCaseSpecs } from "../benchmark/model";
import { installDemoHarness } from "../devtools/harness";
import { WorkbenchController } from "./controller";
import { createExampleModel, createLazyBenchmarkModel, type WorkbenchModel } from "./model";
import type { DemoView, WorkbenchPane, ViewportSlotId } from "./view";

/** Inputs for the WebGPU demo path. */
export interface WebGpuDemoOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  /** E2E-only fixture override for the zero-alpha overlay contract. */
  readonly testAlphaZero?: boolean;
}

/** Starts the presentation-only demo shell around the canonical FEM viewport. */
export async function startWebGpuDemo(
  options: WebGpuDemoOptions,
): Promise<WorkbenchController | undefined> {
  const { view, canvas } = options;
  const presets = createModelPresets(
    options.testAlphaZero === true ? { transparencyOpacity: 0 } : undefined,
  );
  const models: WorkbenchModel[] = [
    ...presets.map(createExampleModel),
    ...benchmarkCaseSpecs(false).map(createLazyBenchmarkModel),
  ];
  const initialModel = models[0];
  if (initialModel === undefined) throw new Error("The demo requires at least one model preset");
  const primaryPaneValue: unknown = Reflect.get(view, "primaryPane");
  const primaryPane: WorkbenchPane = isWorkbenchPane(primaryPaneValue)
    ? primaryPaneValue
    : {
        id: "primary",
        scene: Reflect.get(view, "scene"),
        canvas,
        boxSelectionOverlay: Reflect.get(view, "boxSelectionOverlay"),
      };

  let viewport: FemViewport | undefined;
  let controller: WorkbenchController | undefined;
  const reportRendererFailure = (error: unknown): void => {
    const detail = error instanceof Error ? error.message : String(error);
    const unsupported = error instanceof WebGpuUnsupportedError;
    canvas.dataset["renderer"] = unsupported ? "unsupported" : "error";
    view.rendererStatus.hidden = false;
    view.status.hidden = false;
    view.rendererStatus.textContent = unsupported ? "Renderer unsupported" : "Renderer error";
    view.status.textContent = unsupported
      ? `femgx requires a usable WebGPU renderer. ${detail}`
      : `femgx could not validate the WebGPU renderer. ${detail}`;
  };

  const createViewport = async (
    slotId: ViewportSlotId,
    pane: WorkbenchPane,
    model: WorkbenchModel,
  ): Promise<FemViewport> =>
    createFemViewport({
      canvas: pane.canvas,
      scene: model.scene,
      keyboardTarget: pane.scene,
      orientationGizmo: { container: pane.scene },
      ...(model.results === undefined ? {} : { results: model.results }),
      ...(controller === undefined ? {} : { interaction: controller.interaction }),
      ...(slotId === "primary"
        ? { fitContentInset: () => contentInset(pane.scene, pane.canvas) }
        : {}),
      onDeviceLost: () => {
        pane.canvas.dataset["recovery"] = "recovering";
      },
      onRecovered: () => {
        pane.canvas.dataset["recovery"] = "recovered";
        if (controller !== undefined) {
          controller.rendererState = "recovered";
          controller.render();
        }
      },
      onError: (error) => {
        if (slotId === "primary") {
          controller?.destroy();
          viewport = undefined;
          pane.canvas.dataset["recovery"] = "error";
          reportRendererFailure(error);
        } else {
          controller?.handleSecondaryViewportError(error);
        }
      },
      onGestureChange: (active) => {
        controller?.setCameraGestureActive(slotId, active);
      },
      onRender: () => {
        pane.canvas.dataset["frames"] = String(Number(pane.canvas.dataset["frames"] ?? "0") + 1);
        controller?.onViewportRender(slotId, performance.now());
      },
    });

  try {
    viewport = await createViewport("primary", primaryPane, initialModel);
    controller = new WorkbenchController({
      view,
      canvas,
      rendererName: "webgpu",
      viewport,
      presets: models,
      createViewport,
    });
    viewport.render();
  } catch (error) {
    viewport?.destroy();
    viewport = undefined;
    controller?.destroy();
    reportRendererFailure(error);
    return undefined;
  }
  canvas.dataset["renderer"] = "webgpu";

  const destroyCurrentViewport = (): void => {
    controller.detachViewport();
    controller.invalidateInteraction();
    viewport?.destroy();
    viewport = undefined;
  };

  window.addEventListener("pagehide", () => {
    controller.destroy();
    viewport = undefined;
  });

  /** Explicit lifecycle seam used by the e2e lane. */
  installDemoHarness({
    destroyRenderer: () => {
      destroyCurrentViewport();
      canvas.dataset["renderer"] = "destroyed";
    },
    recreateRenderer: async () => {
      if (viewport !== undefined) return;
      try {
        const recreated = await createViewport("primary", primaryPane, controller.model);
        viewport = recreated;
        controller.setViewport(recreated);
        canvas.dataset["renderer"] = "webgpu";
        recreated.render();
      } catch (error) {
        viewport?.destroy();
        viewport = undefined;
        reportRendererFailure(error);
      }
    },
    runBenchmark: async (includeLarge: boolean) => {
      controller.destroy();
      viewport = undefined;
      const { runWebGpuBenchmark } = await import("../benchmark/runner");
      return runWebGpuBenchmark(canvas, { includeLarge });
    },
    pickPoint: async (x: number, y: number) => (await viewport?.pick(x, y))?.worldPosition,
    pickRegion: async (rect: BoxSelectionRect, granularity: InteractionGranularity) =>
      (await viewport?.pickRegion(rect, granularity)) ?? [],
  });

  return controller;
}

function isWorkbenchPane(value: unknown): value is WorkbenchPane {
  if (value === null || typeof value !== "object") return false;
  return "scene" in value && "canvas" in value && "boxSelectionOverlay" in value;
}

function contentInset(scene: HTMLElement, canvas: HTMLCanvasElement) {
  const canvasBounds = canvas.getBoundingClientRect();
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const overlay of scene.querySelectorAll<HTMLElement>(
    ".toolbar, .renderer-alert, .status-alert, .inspection, .diagnostics",
  )) {
    if (overlay.hidden) continue;
    const bounds = overlay.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) continue;
    const centerY = (bounds.top + bounds.bottom) / 2;
    const centerX = (bounds.left + bounds.right) / 2;
    if (centerY <= canvasBounds.top + canvasBounds.height / 2) {
      inset.top = Math.max(inset.top, bounds.bottom - canvasBounds.top);
    } else {
      inset.bottom = Math.max(inset.bottom, canvasBounds.bottom - bounds.top);
    }
    if (bounds.width < canvasBounds.width * 0.8) {
      if (centerX <= canvasBounds.left + canvasBounds.width / 2) {
        inset.left = Math.max(inset.left, bounds.right - canvasBounds.left);
      } else {
        inset.right = Math.max(inset.right, canvasBounds.right - bounds.left);
      }
    }
  }
  return inset;
}
