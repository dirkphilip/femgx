import {
  type Camera,
  type FemViewport,
  type InteractionState,
  type SceneRuntime,
  type ViewportResultsState,
} from "../../src/index";
import type { WorkbenchModel } from "./model";
import { updateStatus, type DemoView } from "./view";
import { selectedKeys } from "./selection";
import { statsText } from "../devtools/diagnostics";
import type { DisplayToggles, RenderLoopStats, RendererStats, ResultDisplayMode } from "./types";
import { resultVectorFieldsForModel, VECTOR_OFF_VALUE } from "./result-controls";
import type { VectorGlyph, VectorTransform } from "./result-controls";
import type { SectionAxis } from "./section-controls";

/** Presentation-only DOM policy for the workbench shell. */
export interface WorkbenchPresentationOptions {
  readonly view: DemoView;
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly getModel: () => WorkbenchModel;
  readonly getToggles: () => DisplayToggles;
  readonly getResultMode: () => ResultDisplayMode;
  readonly getVectorFieldId: () => string;
  readonly getVectorGlyph: () => VectorGlyph;
  readonly getVectorTransform: () => VectorTransform;
  readonly getViewport: () => FemViewport;
  readonly getInteraction: () => InteractionState;
  readonly getRuntime: () => SceneRuntime;
  readonly getSectionAxis: () => SectionAxis;
  readonly getSectionOffset: () => number;
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
    this.options.canvas.dataset["selected"] = selectedKeys(this.options.getInteraction()).join(",");
    this.options.canvas.dataset["camera"] = JSON.stringify(cameraSnapshot(camera));
    this.options.canvas.dataset["cameraBounds"] = JSON.stringify(model.bounds);
    this.reflectSectionPlane();
  }

  reflectResults(): void {
    const model = this.options.getModel();
    const fields = resultVectorFieldsForModel(model);
    const vectorFieldId = fields.some((field) => field.id === this.options.getVectorFieldId())
      ? this.options.getVectorFieldId()
      : VECTOR_OFF_VALUE;
    const results = this.options.getViewport().results;
    this.options.view.resultLegend.hidden = results === undefined;
    if (results !== undefined) this.options.view.resultLegend.textContent = resultLegend(results);
    this.options.canvas.dataset["results"] = this.options.getResultMode();
    this.options.canvas.dataset["vectorField"] = vectorFieldId;
    this.options.canvas.dataset["vectorGlyph"] = this.options.getVectorGlyph();
    this.options.canvas.dataset["vectorTransform"] = this.options.getVectorTransform();
  }

  reflectSectionPlane(): void {
    this.options.canvas.dataset["sectionAxis"] = this.options.getSectionAxis();
    this.options.canvas.dataset["sectionOffset"] = String(this.options.getSectionOffset());
  }
}

function resultLegend(results: ViewportResultsState): string {
  const scalar = results.scalar;
  const lines: string[] = [];
  if (scalar !== undefined) {
    const field = scalar.field;
    const stops = scalar.colorMap.stops
      .map((stop) => `${formatNumber(stop.offset * 100)}% ${formatColor(stop.color)}`)
      .join(" → ");
    lines.push(
      field.name,
      `${fieldLocation(field.location)} · Unit ${field.unit}`,
      `Range ${formatNumber(scalar.range.min)} – ${formatNumber(scalar.range.max)}`,
      `Colors ${stops}`,
    );
  }
  const vectors = results.vectors;
  if (vectors !== undefined) {
    if (lines.length > 0) lines.push("");
    lines.push(
      vectors.field.name,
      `${fieldLocation(vectors.field.location)} · Unit ${vectors.field.unit}`,
      `Normalized orientation · ${capitalize(vectors.glyph)} / ${capitalize(vectors.transform)}`,
      "Magnitude not displayed",
    );
  }
  return lines.join("\n");
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
