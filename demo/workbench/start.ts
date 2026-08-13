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
import type { DemoView } from "./view";

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

  let viewport: FemViewport | undefined;
  let controller: WorkbenchController | undefined;
  const reportRendererFailure = (error: unknown, unsupportedByDefault = false): void => {
    const detail = error instanceof Error ? error.message : String(error);
    const unsupported =
      error instanceof WebGpuUnsupportedError ||
      (unsupportedByDefault && error instanceof Error && error.name !== "GpuValidationError");
    canvas.dataset["renderer"] = unsupported ? "unsupported" : "error";
    view.rendererStatus.hidden = false;
    view.status.hidden = false;
    view.rendererStatus.textContent = unsupported ? "Renderer unsupported" : "Renderer error";
    view.status.textContent = unsupported
      ? `femgx requires a usable WebGPU renderer. ${detail}`
      : `femgx could not validate the WebGPU renderer. ${detail}`;
  };

  const createViewport = async (model: WorkbenchModel): Promise<FemViewport> =>
    createFemViewport({
      canvas,
      scene: model.scene,
      keyboardTarget: window,
      orientationGizmo: { container: view.scene },
      ...(model.results === undefined ? {} : { results: model.results }),
      ...(controller === undefined ? {} : { camera: controller.camera }),
      ...(controller === undefined ? {} : { interaction: controller.interaction }),
      onDeviceLost: () => {
        canvas.dataset["recovery"] = "recovering";
      },
      onRecovered: () => {
        canvas.dataset["recovery"] = "recovered";
        if (controller !== undefined) {
          controller.rendererState = "recovered";
          controller.render();
        }
      },
      onError: (error) => {
        controller?.destroy();
        viewport = undefined;
        canvas.dataset["recovery"] = "error";
        reportRendererFailure(error);
      },
      onGestureChange: (active) => {
        controller?.setCameraGestureActive(active);
      },
      onRender: () => {
        canvas.dataset["frames"] = String(Number(canvas.dataset["frames"] ?? "0") + 1);
        if (viewport !== undefined) controller?.onViewportRender(performance.now());
      },
    });

  try {
    viewport = await createViewport(initialModel);
    controller = new WorkbenchController({
      view,
      canvas,
      rendererName: "webgpu",
      viewport,
      presets: models,
    });
    viewport.render();
  } catch (error) {
    const viewportWasCreated = viewport !== undefined;
    viewport?.destroy();
    viewport = undefined;
    controller?.destroy();
    reportRendererFailure(error, !viewportWasCreated);
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
        const recreated = await createViewport(controller.model);
        viewport = recreated;
        controller.setViewport(recreated);
        canvas.dataset["renderer"] = "webgpu";
        recreated.render();
      } catch (error) {
        viewport?.destroy();
        viewport = undefined;
        reportRendererFailure(error, true);
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
