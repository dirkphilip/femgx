import {
  type Camera,
  type FemViewport,
  type InteractionState,
  type SceneRuntime,
  type ViewportBackground,
  type ViewportResultsState,
} from "../../src/index";
import type { WorkbenchModel } from "./model";
import { updateStatus, type DemoView } from "./view";
import { selectedKeys } from "./selection";
import { selectedElementTargets } from "./visibility-actions";
import { statsText } from "../devtools/diagnostics";
import type { DisplayToggles, RenderLoopStats, RendererStats, ResultDisplayMode } from "./types";
import type { SelectionGranularity } from "./pick";
import { BASE_RESULT_VALUE, DEFORMATION_OFF_VALUE } from "./result-controls";

/** Presentation-only DOM policy for the workbench shell. */
export interface WorkbenchPresentationOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly getModel: () => WorkbenchModel;
  readonly getToggles: () => DisplayToggles;
  readonly getResultMode: () => ResultDisplayMode;
  readonly getDeformationScale: () => number;
  readonly getViewport: () => FemViewport;
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
    const config = this.options.getModel().results;
    const mode = this.options.getResultMode();
    const controls = this.options.view.resultControls;
    controls.hidden = config === undefined;
    if (config === undefined) {
      this.options.view.resultLegend.hidden = true;
      this.options.canvas.dataset["results"] = "base";
      return;
    }
    replaceOptions(this.options.view.resultField, [
      { value: BASE_RESULT_VALUE, label: "Base" },
      {
        value: config.field.id,
        label: `${config.field.name} · ${fieldLocation(config.field.location)}`,
      },
    ]);
    this.options.view.resultField.value = mode === "base" ? BASE_RESULT_VALUE : config.field.id;
    replaceOptions(this.options.view.deformationField, [
      { value: DEFORMATION_OFF_VALUE, label: "Off" },
      ...(config.deformation === undefined
        ? []
        : [{ value: config.deformation.field.id, label: config.deformation.field.name }]),
    ]);
    this.options.view.deformationField.value =
      mode === "deformed" && config.deformation !== undefined
        ? config.deformation.field.id
        : DEFORMATION_OFF_VALUE;
    this.options.view.deformationField.disabled =
      mode === "base" || config.deformation === undefined;
    this.options.view.deformationScale.disabled =
      mode !== "deformed" || config.deformation === undefined;
    this.options.view.deformationScale.value = String(this.options.getDeformationScale());
    const results = this.options.getViewport().results;
    this.options.view.resultLegend.hidden = results === undefined;
    if (results !== undefined) this.options.view.resultLegend.textContent = resultLegend(results);
    this.options.canvas.dataset["results"] = mode;
  }
}

interface SelectOption {
  readonly value: string;
  readonly label: string;
}

function replaceOptions(select: HTMLSelectElement, options: readonly SelectOption[]): void {
  select.textContent = "";
  for (const optionData of options) {
    const option = document.createElement("option");
    option.value = optionData.value;
    option.textContent = optionData.label;
    select.appendChild(option);
  }
}

function resultLegend(results: ViewportResultsState): string {
  const field = results.scalarField;
  const stops = results.colorMap.stops
    .map((stop) => `${formatNumber(stop.offset * 100)}% ${formatColor(stop.color)}`)
    .join(" → ");
  return (
    `${field.name}\n` +
    `${fieldLocation(field.location)} · Unit ${field.unit}\n` +
    `Range ${formatNumber(results.range.min)} – ${formatNumber(results.range.max)}\n` +
    `Colors ${stops}`
  );
}

function fieldLocation(location: "nodal" | "elemental"): string {
  return location === "nodal" ? "Nodal" : "Elemental";
}

function formatColor(color: {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}): string {
  return `#${componentHex(color.r)}${componentHex(color.g)}${componentHex(color.b)}`;
}

function componentHex(component: number): string {
  return Math.round(Math.min(1, Math.max(0, component)) * 255)
    .toString(16)
    .padStart(2, "0");
}

function formatNumber(value: number): string {
  return String(Math.abs(value) < 1e-9 ? 0 : Number(value.toPrecision(5)));
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
