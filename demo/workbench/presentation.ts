import {
  type Camera,
  type InteractionState,
  type SceneRuntime,
  type ViewportBackground,
} from "../../src/index";
import type { WorkbenchModel } from "./model";
import { updateStatus, type DemoView } from "./view";
import { selectedKeys } from "./selection";
import { selectedElementTargets } from "./visibility-actions";
import { statsText } from "../devtools/diagnostics";
import type { DisplayToggles, RenderLoopStats, RendererStats, ResultDisplayMode } from "./types";
import type { SelectionGranularity } from "./pick";

/** Presentation-only DOM policy for the workbench shell. */
export interface WorkbenchPresentationOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly getModel: () => WorkbenchModel;
  readonly getToggles: () => DisplayToggles;
  readonly getResultMode: () => ResultDisplayMode;
  readonly getInteraction: () => InteractionState;
  readonly getRuntime: () => SceneRuntime;
  readonly getContinuous: () => boolean;
  readonly getSelectionGranularity: () => SelectionGranularity;
}

/** Keeps status, toolbar reflection, model selection, and camera chrome in sync. */
export class WorkbenchPresentation {
  private readonly options: WorkbenchPresentationOptions;

  constructor(options: WorkbenchPresentationOptions) {
    this.options = options;
  }

  populateModelSelect(models: readonly WorkbenchModel[]): void {
    const select = this.options.view.modelSelect;
    select.textContent = "";
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.source === "file" ? `Opened · ${model.name}` : model.name;
      select.appendChild(option);
    }
    select.value = this.options.getModel().id;
  }

  refresh(
    camera: Camera,
    rendererState: string,
    stats: RendererStats,
    renderLoop: RenderLoopStats,
  ): void {
    const model = this.options.getModel();
    updateStatus(this.options.view, camera, {
      model: model.name,
      renderer: this.options.rendererName,
      rendererState,
      visibleInstances: stats.visibleInstances,
      parts: model.scene.parts.size,
      batches: stats.batches,
    });
    this.options.view.statsContent.textContent = statsText(
      {
        model,
        runtime: this.options.getRuntime(),
        interaction: this.options.getInteraction(),
      },
      {
        rendererName: this.options.rendererName,
        toggles: this.options.getToggles(),
        stats,
        renderLoop,
        selectedCount: selectedKeys(this.options.getInteraction()).length,
      },
    );
    this.options.view.statsPanel.hidden = !this.options.getToggles().diagnostics;
    this.reflectVisibilityActions();
    this.options.canvas.dataset["selected"] = selectedKeys(this.options.getInteraction()).join(",");
    this.options.canvas.dataset["camera"] = JSON.stringify(cameraSnapshot(camera));
    this.options.canvas.dataset["cameraBounds"] = JSON.stringify(model.bounds);
  }

  reflectEdges(): void {
    const enabled = this.options.getToggles().edges;
    this.options.view.edgeOverlayToggle.setAttribute("aria-pressed", String(enabled));
    this.options.view.edgeOverlayToggle.textContent = "Edges";
    this.options.canvas.dataset["edges"] = String(enabled);
  }

  reflectNodes(): void {
    const enabled = this.options.getToggles().nodes;
    this.options.view.nodeOverlayToggle.ariaPressed = String(enabled);
    this.options.view.nodeOverlayToggle.textContent = "Nodes";
    this.options.canvas.dataset["nodes"] = String(enabled);
  }

  reflectContinuous(): void {
    const enabled = this.options.getContinuous();
    this.options.view.continuousToggle.setAttribute("aria-pressed", String(enabled));
    this.options.view.continuousToggle.textContent = "Continuous";
    this.options.view.continuousToggle.setAttribute("aria-label", "Continuous rendering");
    this.options.view.continuousToggle.title = enabled
      ? "Stop the recurring render-loop sample."
      : "Start a recurring render-loop sample for manual inspection.";
    this.options.canvas.dataset["continuous"] = String(enabled);
  }

  reflectSelectionGranularity(): void {
    const granularity = this.options.getSelectionGranularity();
    this.options.view.selectionGranularity.value = granularity;
    this.options.view.selectionGranularity.setAttribute("aria-label", "Selection granularity");
    this.options.canvas.dataset["selectionGranularity"] = granularity;
    this.options.view.interactionHelp.textContent = selectionHelp(granularity);
  }

  reflectVisibilityActions(): void {
    const count = selectedElementTargets(this.options.getInteraction()).length;
    const noun = count === 1 ? "element" : "elements";
    const button = this.options.view.hideSelectedButton;
    button.disabled = count === 0;
    button.textContent = count === 0 ? "Hide selected" : `Hide selected (${count})`;
    button.setAttribute("aria-label", `Hide selected ${noun}`);
    button.title =
      count === 0 ? "Select one or more elements to hide." : `Hide ${count} selected ${noun}.`;
    this.options.view.showAllButton.textContent = "Show all";
    this.options.view.showAllButton.setAttribute("aria-label", "Show all");
    this.options.view.showAllButton.title =
      "Restore all model visibility without changing selection or display settings.";
  }

  reflectBackground(background: ViewportBackground): void {
    this.options.view.backgroundSelect.value = background;
    this.options.canvas.dataset["background"] = background;
  }

  reflectResults(): void {
    const enabled = this.options.getModel().results !== undefined;
    const mode = this.options.getResultMode();
    this.options.view.resultsToggle.disabled = !enabled;
    this.options.view.resultsToggle.hidden = !enabled;
    this.options.view.resultsToggle.textContent = `Results: ${resultLabel(mode)}`;
    this.options.view.resultsToggle.setAttribute("aria-label", `Results: ${resultLabel(mode)}`);
    this.options.canvas.dataset["results"] = mode;
  }
}

function resultLabel(mode: ResultDisplayMode): string {
  if (mode === "colored") return "Color";
  return mode === "base" ? "Base" : "Deformed";
}

function selectionHelp(granularity: SelectionGranularity): string {
  const promotion =
    granularity === "element"
      ? "Shift keeps element selection."
      : `Shift selects the owning element from a ${granularity} hit.`;
  return `${capitalize(granularity)}: click or drag to replace. Hold Ctrl or ⌘ to toggle. ${promotion} Alt selects an instance.`;
}

function capitalize(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

/** Serializes the camera state used by demo diagnostics and browser tests. */
export function cameraSnapshot(camera: Camera): {
  readonly mode: Camera["mode"];
  readonly position: Camera["position"];
  readonly target: Camera["target"];
  readonly up: Camera["up"];
  readonly fovY: number;
  readonly orthoHeight: number;
  readonly width: number;
  readonly height: number;
  readonly near: number;
  readonly far: number;
} {
  return {
    mode: camera.mode,
    position: camera.position,
    target: camera.target,
    up: camera.up,
    fovY: camera.fovY,
    orthoHeight: camera.orthoHeight,
    width: camera.width,
    height: camera.height,
    near: camera.near,
    far: camera.far,
  };
}
