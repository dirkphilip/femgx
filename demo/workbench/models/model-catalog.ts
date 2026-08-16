import type { WorkbenchModel, WorkbenchPerformanceRetentionReason } from "./model";

/** The discoverable model catalog shown by the workbench source controls. */
export type WorkbenchCatalogMode = "ordinary" | "performance";

/** Maximum authoritative CPU model size retained for a Performance Lab return path. */
export const PERFORMANCE_MODEL_RETENTION_CAP_BYTES = 256 * 1024 * 1024;

interface RetainedPerformanceModel {
  readonly model: WorkbenchModel;
  readonly estimatedCpuBytes: number;
}

/** Owns the two demo-private model catalogs and the ordinary model selection. */
export class WorkbenchModelCatalog {
  private ordinaryModels: readonly WorkbenchModel[];
  private readonly performanceModels: readonly WorkbenchModel[];
  private currentMode: WorkbenchCatalogMode = "ordinary";
  private ordinarySelectionId: string;
  private performanceSelectionId = "";
  private retainedPerformanceModel: RetainedPerformanceModel | undefined;

  constructor(
    ordinaryModels: readonly WorkbenchModel[],
    performanceModels: readonly WorkbenchModel[],
  ) {
    const first = ordinaryModels[0];
    if (first === undefined) throw new Error("Workbench requires an ordinary model");
    this.ordinaryModels = ordinaryModels;
    this.performanceModels = performanceModels;
    this.ordinarySelectionId = first.id;
  }

  get mode(): WorkbenchCatalogMode {
    return this.currentMode;
  }

  get models(): readonly WorkbenchModel[] {
    return this.currentMode === "ordinary" ? this.ordinaryModels : this.performanceModels;
  }

  get selectedId(): string {
    return this.currentMode === "ordinary" ? this.ordinarySelectionId : this.performanceSelectionId;
  }

  /** Resolves a visible entry to its retained model when one is available. */
  resolveModel(id: string): WorkbenchModel | undefined {
    const retained = this.retainedPerformanceModel;
    if (this.currentMode === "performance" && retained?.model.id === id) {
      const model = withRetentionReason(retained.model, "reused");
      this.retainedPerformanceModel = { ...retained, model };
      return model;
    }
    return this.models.find((model) => model.id === id);
  }

  /** Releases the demo-private retained CPU model when the workbench is destroyed. */
  clearRetainedModel(): void {
    this.retainedPerformanceModel = undefined;
  }

  /** Changes the visible catalog and returns the ordinary model to restore, if any. */
  setMode(mode: WorkbenchCatalogMode): string {
    this.currentMode = mode;
    return this.selectedId;
  }

  /** Remembers a user-selected catalog entry after its model becomes active. */
  rememberModel(model: WorkbenchModel): WorkbenchModel {
    if (this.currentMode === "performance") {
      this.performanceSelectionId = model.id;
      const estimatedCpuBytes = model.estimatedCpuBytes ?? 0;
      if (estimatedCpuBytes > PERFORMANCE_MODEL_RETENTION_CAP_BYTES) {
        this.retainedPerformanceModel = undefined;
        return withRetentionReason(model, "evicted-over-budget");
      }
      const wasRetained = this.retainedPerformanceModel?.model === model;
      const reason: WorkbenchPerformanceRetentionReason = wasRetained ? "reused" : "rebuild";
      const retainedModel = withRetentionReason(model, reason);
      this.retainedPerformanceModel = { model: retainedModel, estimatedCpuBytes };
      return retainedModel;
    }
    this.ordinarySelectionId = model.id;
    if (
      model.source === "file" &&
      !this.ordinaryModels.some((candidate) => candidate.id === model.id)
    ) {
      this.ordinaryModels = [...this.ordinaryModels, model];
    }
    return model;
  }

  /** Records an explicit selection before an asynchronous model load begins. */
  select(id: string): boolean {
    if (!this.models.some((model) => model.id === id)) return false;
    if (this.currentMode === "performance") {
      this.performanceSelectionId = id;
      if (this.retainedPerformanceModel?.model.id !== id) {
        this.retainedPerformanceModel = undefined;
      }
    } else this.ordinarySelectionId = id;
    return true;
  }
}

function withRetentionReason(
  model: WorkbenchModel,
  reason: WorkbenchPerformanceRetentionReason,
): WorkbenchModel {
  return model.performanceRetentionReason === reason
    ? model
    : { ...model, performanceRetentionReason: reason };
}
