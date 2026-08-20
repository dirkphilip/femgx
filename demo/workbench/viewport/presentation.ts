import { type Viewport, type ViewportResultsState } from "../../../src/entries/root";
import { type InteractionState } from "../../../src/entries/interaction";
import type { Camera } from "../../../src/entries/camera";
import type { SceneOccurrences } from "../../../src/entries/root";
import type { WorkbenchModel } from "../models/model";
import { selectedCount, selectionDatasetValue } from "../selection/selection";
import { statsText } from "../../devtools/diagnostics";
import type { DisplayToggles, RenderLoopStats, RendererStats, ResultDisplayMode } from "../types";
import { resultVectorFieldsForModel, VECTOR_OFF_VALUE } from "../results/result-controls";
import type { VectorGlyph, VectorTransform } from "../results/result-controls";
import type { SectionAxis } from "../section-controls";
import { describePick } from "../selection/inspect";
import type { WorkbenchMenu } from "../interaction/menu";
import type { WorkbenchPresentationSnapshot } from "../results/snapshot";
import type {
  WorkbenchResultLegendField,
  WorkbenchResultLegendSnapshot,
} from "../results/result-legend";

/** Presentation-only DOM policy for the workbench shell. */
export interface WorkbenchPresentationOptions {
  readonly canvas: HTMLCanvasElement;
  readonly rendererName: string;
  readonly getModel: () => WorkbenchModel;
  readonly getToggles: () => DisplayToggles;
  readonly getResultMode: () => ResultDisplayMode;
  readonly getVectorFieldId: () => string;
  readonly getVectorGlyph: () => VectorGlyph;
  readonly getVectorTransform: () => VectorTransform;
  readonly getViewport: () => Viewport;
  readonly getInteraction: () => InteractionState;
  readonly getInspection: () => { readonly visible: boolean; readonly text: string };
  readonly setInspection: (value: { readonly visible: boolean; readonly text: string }) => void;
  readonly getRuntime: () => SceneOccurrences;
  readonly getSectionAxis: () => SectionAxis;
  readonly getSectionOffset: () => number;
  readonly menu: WorkbenchMenu;
  readonly publishSnapshot: () => void;
}

/** Keeps status, toolbar reflection, model selection, and camera chrome in sync. */
export class WorkbenchPresentation {
  private readonly options: WorkbenchPresentationOptions;
  private loading = false;
  private modelSelectionDisabled = false;
  private modelOpenDisabled = false;
  private feedback: WorkbenchPresentationSnapshot["feedback"];
  private rendererStatus = "";
  private rendererStatusVisible = false;
  private status = "";
  private statusVisible = false;
  private diagnosticsText = "";
  private resultLegend = resultLegendSnapshot(undefined, "off", 0);

  constructor(options: WorkbenchPresentationOptions) {
    this.options = options;
  }

  snapshot(): WorkbenchPresentationSnapshot {
    return Object.freeze({
      loading: this.loading,
      modelSelectionDisabled: this.modelSelectionDisabled,
      modelOpenDisabled: this.modelOpenDisabled,
      feedback: this.feedback,
      rendererStatus: this.rendererStatus,
      rendererStatusVisible: this.rendererStatusVisible,
      status: this.status,
      statusVisible: this.statusVisible,
      inspection: Object.freeze({ ...this.options.getInspection() }),
      diagnostics: Object.freeze({
        visible: this.options.getToggles().diagnostics,
        text: this.diagnosticsText,
      }),
      resultLegend: this.resultLegend,
      contextMenu: this.options.menu.snapshot,
    });
  }

  setLoading(loading: boolean, options: { readonly allowModelSelection?: boolean } = {}): void {
    this.loading = loading;
    this.modelSelectionDisabled = loading && options.allowModelSelection !== true;
    this.modelOpenDisabled = loading;
    this.options.publishSnapshot();
  }

  setFeedback(message: string, kind: "info" | "error" = "info"): void {
    this.feedback = { message, kind };
    this.options.publishSnapshot();
  }

  clearFeedback(): void {
    if (this.feedback === undefined) return;
    this.feedback = undefined;
    this.options.publishSnapshot();
  }

  setInspection(text: string, visible: boolean): void {
    this.options.setInspection({ text, visible });
    this.options.publishSnapshot();
  }

  clearInspection(model: WorkbenchModel): void {
    this.options.canvas.dataset["hovered"] = "";
    this.options.canvas.dataset["selected"] = "";
    this.options.canvas.dataset["pick"] = "";
    this.setInspection(
      describePick(undefined, (partId) => model.partNames.get(partId)),
      false,
    );
  }

  refresh(
    camera: Camera,
    rendererState: string,
    stats: RendererStats,
    renderLoop: RenderLoopStats,
  ): void {
    const model = this.options.getModel();
    const interaction = this.options.getInteraction();
    const cameraMode = camera.mode === "perspective" ? "perspective" : "orthographic";
    const renderer = rendererState
      ? `${this.options.rendererName} · ${rendererState}`
      : this.options.rendererName;
    this.rendererStatus = `Renderer ${renderer}`;
    this.status =
      `${model.name} · ${renderer} · ${stats.visibleInstances} visible · ` +
      `${model.scene.parts.size} parts · ${stats.batches} batches · ${cameraMode} camera`;
    this.diagnosticsText = statsText(
      {
        model,
        runtime: this.options.getRuntime(),
        interaction,
      },
      {
        rendererName: this.options.rendererName,
        toggles: this.options.getToggles(),
        stats,
        renderLoop,
        selectedCount: selectedCount(interaction),
      },
    );
    this.options.canvas.dataset["selected"] = selectionDatasetValue(interaction);
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
    const results = this.options.getViewport().results.state;
    this.resultLegend = resultLegendSnapshot(
      results,
      this.options.getSectionAxis(),
      this.options.getSectionOffset(),
    );
    this.options.canvas.dataset["results"] = this.options.getResultMode();
    this.options.canvas.dataset["vectorField"] = vectorFieldId;
    this.options.canvas.dataset["vectorGlyph"] = this.options.getVectorGlyph();
    this.options.canvas.dataset["vectorTransform"] = this.options.getVectorTransform();
    this.options.publishSnapshot();
  }

  reflectSectionPlane(): void {
    this.options.canvas.dataset["sectionAxis"] = this.options.getSectionAxis();
    this.options.canvas.dataset["sectionOffset"] = String(this.options.getSectionOffset());
    this.resultLegend = Object.freeze({
      ...this.resultLegend,
      section: Object.freeze({
        axis: this.options.getSectionAxis(),
        offset: this.options.getSectionOffset(),
      }),
      visible: this.resultLegend.visible || this.options.getSectionAxis() !== "off",
    });
  }
}

function resultLegendSnapshot(
  results: ViewportResultsState | undefined,
  sectionAxis: SectionAxis,
  sectionOffset: number,
): WorkbenchResultLegendSnapshot {
  const scalar = results?.scalar;
  const deformation = results?.config.deformation?.field;
  const orientation = results?.orientation;
  const loads = results?.loads;
  return Object.freeze({
    visible: results !== undefined || sectionAxis !== "off",
    scalar:
      scalar === undefined
        ? undefined
        : Object.freeze({
            field: legendField(scalar.field),
            range: Object.freeze({ min: scalar.range.min, max: scalar.range.max }),
            palette: Object.freeze(
              scalar.colorMap.stops.map((stop) =>
                Object.freeze({
                  offset: stop.offset,
                  color: Object.freeze({ ...stop.color }),
                }),
              ),
            ),
            missingColor: Object.freeze({ ...scalar.colorMap.missingColor }),
            thresholds:
              scalar.colorMap.thresholds === undefined
                ? undefined
                : Object.freeze([...scalar.colorMap.thresholds]),
          }),
    deformation:
      deformation === undefined
        ? undefined
        : Object.freeze({
            field: legendField(deformation),
            scale: results?.deformation?.scale ?? 1,
          }),
    orientation:
      orientation === undefined
        ? undefined
        : Object.freeze({
            field: legendField(orientation.field),
            glyph: orientation.glyph,
            transform: orientation.transform,
            lengthScale: orientation.lengthScale,
            widthPixels: orientation.widthPixels,
          }),
    loads: loadLegend(loads),
    section: Object.freeze({ axis: sectionAxis, offset: sectionOffset }),
  });
}

function loadLegend(loads: ViewportResultsState["loads"]): WorkbenchResultLegendSnapshot["loads"] {
  if (loads === undefined) return undefined;
  return Object.freeze({
    field: Object.freeze({
      id: loads.field.id,
      name: loads.field.name,
      location: "nodal" as const,
      forceUnit: loads.field.forceUnit,
      momentUnit: loads.field.momentUnit,
    }),
    widthPixels: loads.widthPixels ?? 2,
  });
}

function legendField(field: {
  readonly id: string;
  readonly name: string;
  readonly location: "nodal" | "elemental";
  readonly unit: string;
}): WorkbenchResultLegendField {
  return Object.freeze({
    id: field.id,
    name: field.name,
    location: field.location,
    unit: field.unit,
  });
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
