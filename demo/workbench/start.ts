import {
  createViewport,
  WebGpuUnsupportedError,
  type BoxSelectionRect,
  type Viewport,
  type InteractionGranularity,
} from "../../src/entries/root";
import { createModelPresets } from "../fixtures/presets";
import { parseTet4CellsQuery } from "../benchmark/dense-tet4";
import { installDemoHarness, type DemoHarness } from "../devtools/harness";
import { WorkbenchController } from "./controllers/controller";
import { createExampleModel, type WorkbenchModel } from "./models/model";
import { errorMessage } from "./models/model";
import { selectTarget, targetKey } from "./selection/pick";
import type { WorkbenchResultPlaybackActions } from "./results/result-playback";
import type { DemoView, WorkbenchPane, ViewportSlotId } from "./viewport/view";
import type { WorkbenchStartupStatus } from "./results/snapshot";

/** Inputs for the WebGPU demo path. */
export interface WebGpuDemoOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly reportStartupFailure: (status: WorkbenchStartupStatus) => void;
  /** E2E-only fixture override for the zero-alpha overlay contract. */
  readonly testAlphaZero?: boolean;
}

/** Starts the WebGPU workbench and returns its controller when initialization succeeds. */
export async function startWebGpuDemo(
  options: WebGpuDemoOptions,
): Promise<WorkbenchController | undefined> {
  const { view, canvas } = options;
  const models = createDemoModels(options);
  const initialModel = models[0];
  if (initialModel === undefined) throw new Error("The demo requires at least one model preset");
  const primaryPane = view.primaryPane;
  const state: StartState = { viewport: undefined, controller: undefined };
  const reportFailure = (error: unknown): void => {
    reportRendererFailure(options.reportStartupFailure, canvas, error);
  };
  const createViewport = createViewportFactory(state, reportFailure);
  try {
    state.viewport = await createViewport("primary", primaryPane, initialModel);
    state.controller = new WorkbenchController({
      view,
      canvas,
      rendererName: "webgpu",
      viewport: state.viewport,
      presets: models,
      createViewport,
    });
    meshTet4FromQuery(state.controller);
    state.viewport.render();
  } catch (error) {
    state.viewport?.destroy();
    state.viewport = undefined;
    state.controller?.destroy();
    reportFailure(error);
    return undefined;
  }
  canvas.dataset["renderer"] = "webgpu";
  installWorkbenchHarness(canvas, primaryPane, state, createViewport, reportFailure);
  return state.controller;
}

interface StartState {
  viewport: Viewport | undefined;
  controller: WorkbenchController | undefined;
}

interface ResultPlaybackStopOwner {
  readonly resultPlaybackActions?: Pick<WorkbenchResultPlaybackActions, "stop">;
}

function stopResultPlayback(owner: ResultPlaybackStopOwner | undefined): void {
  owner?.resultPlaybackActions?.stop();
}

function createDemoModels(options: WebGpuDemoOptions): WorkbenchModel[] {
  const presets = createModelPresets(
    options.testAlphaZero === true ? { transparencyOpacity: 0 } : undefined,
  );
  return presets.map(createExampleModel);
}

function meshTet4FromQuery(controller: WorkbenchController): void {
  const search = (globalThis as { location?: { readonly search?: string } }).location?.search;
  const cells = parseTet4CellsQuery(search ?? "");
  if (cells === undefined) return;
  controller.commands.meshTet4(cells);
}

function reportRendererFailure(
  reportStartupFailure: (status: WorkbenchStartupStatus) => void,
  canvas: HTMLCanvasElement,
  error: unknown,
): void {
  const detail = errorMessage(error);
  const unsupported = error instanceof WebGpuUnsupportedError;
  canvas.dataset["renderer"] = unsupported ? "unsupported" : "error";
  reportStartupFailure({
    rendererStatus: unsupported ? "Renderer unsupported" : "Renderer error",
    status: unsupported
      ? `FemGx requires a usable WebGPU renderer. ${detail}`
      : `FemGx could not validate the WebGPU renderer. ${detail}`,
  });
}

function createViewportFactory(
  state: StartState,
  reportFailure: (error: unknown) => void,
): (slotId: ViewportSlotId, pane: WorkbenchPane, model: WorkbenchModel) => Promise<Viewport> {
  return async (slotId, pane, model) =>
    createViewport({
      canvas: pane.canvas,
      scene: model.scene,
      keyboardTarget: pane.scene,
      orientationGizmo: { container: pane.scene },
      ...(model.results === undefined ? {} : { results: model.results }),
      ...(state.controller === undefined ? {} : { interaction: state.controller.interaction }),
      ...(slotId === "primary"
        ? { fitContentInset: () => contentInset(pane.scene, pane.canvas) }
        : {}),
      onDeviceLost: () => {
        stopResultPlayback(state.controller);
        pane.canvas.dataset["recovery"] = "recovering";
      },
      onRecovered: () => {
        stopResultPlayback(state.controller);
        pane.canvas.dataset["recovery"] = "recovered";
        if (state.controller !== undefined) {
          state.controller.rendererState = "recovered";
          state.controller.render();
        }
      },
      onError: (error) => {
        stopResultPlayback(state.controller);
        if (slotId === "primary") {
          state.controller?.destroy();
          state.viewport = undefined;
          pane.canvas.dataset["recovery"] = "error";
          reportFailure(error);
        } else {
          state.controller?.viewportSlots.handleSecondaryViewportError(error);
        }
      },
      onGestureChange: (active) => {
        state.controller?.setCameraGestureActive(slotId, active);
      },
      onRender: () => {
        pane.canvas.dataset["frames"] = String(Number(pane.canvas.dataset["frames"] ?? "0") + 1);
        if (slotId === "primary" && state.viewport === undefined) return;
        state.controller?.onViewportRender(slotId, performance.now());
      },
    });
}

function installWorkbenchHarness(
  canvas: HTMLCanvasElement,
  primaryPane: WorkbenchPane,
  state: StartState,
  createViewport: (
    slotId: ViewportSlotId,
    pane: WorkbenchPane,
    model: WorkbenchModel,
  ) => Promise<Viewport>,
  reportFailure: (error: unknown) => void,
): void {
  const controller = state.controller;
  if (controller === undefined) throw new Error("Workbench controller was not created");
  const destroyCurrentViewport = (): void => {
    stopResultPlayback(controller);
    controller.detachViewport();
    controller.invalidateInteraction();
    state.viewport?.destroy();
    state.viewport = undefined;
  };
  window.addEventListener("pagehide", () => {
    controller.destroy();
    state.viewport = undefined;
  });
  /** Explicit lifecycle seam used by the e2e lane. */
  installDemoHarness({
    destroyRenderer: () => {
      destroyCurrentViewport();
      canvas.dataset["renderer"] = "destroyed";
    },
    recreateRenderer: async () => {
      if (state.viewport !== undefined) return;
      try {
        const recreated = await createViewport("primary", primaryPane, controller.model);
        state.viewport = recreated;
        controller.setViewport(recreated);
        canvas.dataset["renderer"] = "webgpu";
        recreated.render();
      } catch (error) {
        state.viewport?.destroy();
        state.viewport = undefined;
        reportFailure(error);
      }
    },
    runBenchmark: benchmarkRunner(canvas, controller, state),
    pickPoint: async (x: number, y: number) =>
      (await state.viewport?.interaction.pick(x, y))?.worldPosition,
    probePick: (x: number, y: number) => probePickKeys(state, controller, x, y),
    pickRegion: async (rect: BoxSelectionRect, granularity: InteractionGranularity) =>
      (await state.viewport?.interaction.pickRegion(rect, granularity)) ?? [],
    getBoxSelectionStats: () => controller.getBoxSelectionStats(),
  });
}

function benchmarkRunner(
  canvas: HTMLCanvasElement,
  controller: WorkbenchController,
  state: StartState,
): DemoHarness["runBenchmark"] {
  return async (includeLarge, caseId, holdNodeSelectionForCapture) => {
    if (holdNodeSelectionForCapture === true) {
      delete canvas.dataset["benchmarkNodeSelectionError"];
    }
    controller.destroy();
    state.viewport = undefined;
    const { runWebGpuBenchmark } = await import("../benchmark/runner");
    try {
      return await runWebGpuBenchmark(canvas, {
        includeLarge,
        ...(caseId === undefined ? {} : { caseId }),
        ...(holdNodeSelectionForCapture === undefined ? {} : { holdNodeSelectionForCapture }),
      });
    } catch (error) {
      if (holdNodeSelectionForCapture === true) {
        canvas.dataset["benchmarkNodeSelectionError"] = errorMessage(error);
      }
      throw error;
    }
  };
}

async function probePickKeys(
  state: StartState,
  controller: WorkbenchController,
  x: number,
  y: number,
) {
  const hit = await state.viewport?.interaction.pick(
    x,
    y,
    controller.selectionGranularity === "edge" ? "edge" : undefined,
  );
  const hovered =
    hit === undefined
      ? undefined
      : selectTarget(hit, controller.selectionGranularity, {
          shiftKey: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
        });
  return { pickKey: targetKey(hit), hoveredKey: targetKey(hovered) };
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
