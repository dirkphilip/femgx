import { type Camera, type InteractionState, type SceneRuntime } from "../../src/index";
import { type ModelPreset } from "../fixture/presets";
import { updateStatus, type DemoView } from "./view";
import { selectedKeys } from "./selection";
import { statsText } from "../devtools/diagnostics";
import type { DisplayToggles, RendererStats, ResultDisplayMode } from "./types";

/** Presentation-only DOM policy for the workbench shell. */
export interface WorkbenchPresentationOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly getPreset: () => ModelPreset;
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
    });
    this.options.view.statsContent.textContent = statsText(
      {
        preset,
        runtime: this.options.getRuntime(),
        interaction: this.options.getInteraction(),
      },
      {
        rendererName: this.options.rendererName,
        toggles: this.options.getToggles(),
        stats,
        selectedCount: selectedKeys(this.options.getInteraction()).length,
      },
    );
    this.options.view.statsPanel.hidden = !this.options.getToggles().diagnostics;
    this.options.canvas.dataset["selected"] = selectedKeys(this.options.getInteraction()).join(",");
    this.options.canvas.dataset["camera"] = JSON.stringify(cameraSnapshot(camera));
    this.options.canvas.dataset["cameraBounds"] = JSON.stringify(preset.bounds);
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

  reflectResults(): void {
    const enabled = this.options.getPreset().results !== undefined;
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

function cameraSnapshot(camera: Camera): {
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
