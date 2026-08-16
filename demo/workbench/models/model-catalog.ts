import type { WorkbenchModel } from "./model";

/** The discoverable model catalog shown by the workbench source controls. */
export type WorkbenchCatalogMode = "ordinary" | "performance";

/** Owns the two demo-private model catalogs and their remembered selections. */
export class WorkbenchModelCatalog {
  private ordinaryModels: readonly WorkbenchModel[];
  private readonly performanceModels: readonly WorkbenchModel[];
  private currentMode: WorkbenchCatalogMode = "ordinary";
  private ordinarySelectionId: string;
  private performanceSelectionId = "";

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

  /** Changes the visible catalog and returns its remembered model selection, if any. */
  setMode(mode: WorkbenchCatalogMode): string {
    this.currentMode = mode;
    return this.selectedId;
  }

  /** Remembers a user-selected catalog entry after its model becomes active. */
  rememberModel(model: WorkbenchModel): void {
    if (this.currentMode === "performance") {
      this.performanceSelectionId = model.id;
      return;
    }
    this.ordinarySelectionId = model.id;
    if (
      model.source === "file" &&
      !this.ordinaryModels.some((candidate) => candidate.id === model.id)
    ) {
      this.ordinaryModels = [...this.ordinaryModels, model];
    }
  }

  /** Records an explicit selection before an asynchronous model load begins. */
  select(id: string): boolean {
    if (!this.models.some((model) => model.id === id)) return false;
    if (this.currentMode === "performance") this.performanceSelectionId = id;
    else this.ordinarySelectionId = id;
    return true;
  }
}
