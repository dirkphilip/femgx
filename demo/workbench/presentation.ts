import { type Camera, type InteractionState, type SceneRuntime } from "../../src/index";
import { updateAxisGizmo } from "../axis-gizmo";
import { type ModelPreset } from "../fixture/presets";
import type { ElementDisplayMode } from "../fixture/types";
import { updateStatus, type DemoView } from "../view";
import { selectedKeys } from "./selection";
import { statsText } from "./status";
import type { DisplayToggles, RendererStats, ResultDisplayMode } from "./types";

/** Presentation-only DOM policy for the workbench shell. */
export interface WorkbenchPresentationOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly getPreset: () => ModelPreset;
  readonly getMode: () => ElementDisplayMode;
  readonly getToggles: () => DisplayToggles;
  readonly getResultMode: () => ResultDisplayMode;
  readonly getInteraction: () => InteractionState;
  readonly getRuntime: () => SceneRuntime;
}

/** Keeps status, toolbar reflection, model selection, and camera chrome in sync. */
export class WorkbenchPresentation {
  private readonly options: WorkbenchPresentationOptions;

  constructor(options: WorkbenchPresentationOptions) {
    this.options = options;
  }

  populateModelSelect(presets: readonly ModelPreset[]): void {
    const select = this.options.view.modelSelect;
    select.textContent = "";
    for (const preset of presets) {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.name;
      select.appendChild(option);
    }
    select.value = this.options.getPreset().id;
  }

  refresh(camera: Camera, rendererState: string, stats: RendererStats): void {
    const preset = this.options.getPreset();
    updateStatus(this.options.view, camera, {
      model: preset.name,
      renderer: this.options.rendererName,
      rendererState,
      visibleInstances: stats.visibleInstances,
      parts: preset.scene.parts.size,
      batches: stats.batches,
      mode: this.options.getMode(),
    });
    this.options.view.statsPanel.textContent = statsText(
      {
        preset,
        runtime: this.options.getRuntime(),
        interaction: this.options.getInteraction(),
      },
      {
        rendererName: this.options.rendererName,
        mode: this.options.getMode(),
        toggles: this.options.getToggles(),
        stats,
        selectedCount: selectedKeys(this.options.getInteraction()).length,
      },
    );
    this.options.canvas.dataset["selected"] = selectedKeys(this.options.getInteraction()).join(",");
    this.options.canvas.dataset["camera"] = cameraKey(camera);
    updateAxisGizmo(this.options.view.axisGizmo, camera);
  }

  reflectEdges(): void {
    const enabled = this.options.getToggles().edges;
    this.options.view.edgeOverlayLabel.textContent = enabled ? "On" : "Off";
    this.options.view.edgeOverlayLabel.dataset["state"] = enabled ? "on" : "off";
    this.options.view.edgeOverlayToggle.dataset["active"] = String(enabled);
    this.options.view.edgeOverlayToggle.setAttribute("aria-pressed", String(enabled));
    this.options.view.edgeOverlayToggle.textContent = enabled ? "Hide edges" : "Overlay edges";
    this.options.canvas.dataset["edges"] = String(enabled);
  }

  reflectNodes(): void {
    const enabled = this.options.getToggles().nodes;
    this.options.view.nodeOverlayLabel.textContent = enabled ? "On" : "Off";
    this.options.view.nodeOverlayLabel.dataset["state"] = enabled ? "on" : "off";
    this.options.view.nodeOverlayToggle.dataset["active"] = String(enabled);
    this.options.view.nodeOverlayToggle.ariaPressed = String(enabled);
    this.options.view.nodeOverlayToggle.textContent = enabled
      ? "Hide element nodes"
      : "Show element nodes";
    this.options.canvas.dataset["nodes"] = String(enabled);
  }

  reflectDepthTest(enabled: boolean): void {
    this.options.view.depthTestLabel.textContent = enabled ? "On" : "Off";
    this.options.view.depthTestLabel.dataset["state"] = enabled ? "on" : "off";
    this.options.view.depthTestToggle.dataset["active"] = String(enabled);
    this.options.view.depthTestToggle.setAttribute("aria-pressed", String(enabled));
    this.options.view.depthTestToggle.textContent = enabled ? "Depth test off" : "Depth test on";
  }

  reflectResults(): void {
    const enabled = this.options.getPreset().results !== undefined;
    const mode = this.options.getResultMode();
    this.options.view.resultsToggle.disabled = !enabled;
    this.options.view.resultsLabel.textContent = mode;
    this.options.view.resultsLabel.dataset["state"] = mode;
    this.options.view.resultsToggle.dataset["active"] = String(enabled && mode !== "base");
    this.options.view.resultsToggle.textContent = enabled ? "Cycle results" : "No results";
    this.options.canvas.dataset["results"] = mode;
  }
}

function cameraKey(camera: Camera): string {
  const position = camera.position.map((value) => value.toFixed(3)).join(",");
  const target = camera.target.map((value) => value.toFixed(3)).join(",");
  return `p:${position} t:${target} o:${camera.orthoHeight.toFixed(3)}`;
}
