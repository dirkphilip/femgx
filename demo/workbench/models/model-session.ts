import type { importGlb } from "../../../src/entries/io/glb";
import {
  createImportedModel,
  displayFileName,
  errorMessage,
  importFeedback,
  type WorkbenchModel,
} from "./model";
import { importModelFile } from "./model-import";
import type { WorkbenchPresentation } from "../viewport/presentation";

interface WorkbenchModelSessionOptions {
  readonly presentation: WorkbenchPresentation;
  readonly examples: readonly WorkbenchModel[];
  readonly importer: typeof importGlb;
  readonly getModel: () => WorkbenchModel;
  readonly isDisposed: () => boolean;
  readonly activate: (model: WorkbenchModel) => void;
}

/** Owns asynchronous preset and local model loading, including stale-load handling. */
export class WorkbenchModelSession {
  private readonly options: WorkbenchModelSessionOptions;
  private generation = 0;

  constructor(options: WorkbenchModelSessionOptions) {
    this.options = options;
  }

  setModel(id: string): void {
    const model = this.options.examples.find((candidate) => candidate.id === id);
    if (model === undefined) return;
    const generation = ++this.generation;
    if (model.id === this.options.getModel().id) {
      this.options.presentation.setLoading(false, { allowModelSelection: true });
      this.options.presentation.clearFeedback();
    } else if (model.deferredLoad !== undefined) {
      void this.loadDeferredModel(model, generation);
    } else {
      this.options.activate(model);
    }
  }

  async openModel(file: File): Promise<void> {
    const generation = ++this.generation;
    const previous = this.options.getModel();
    const name = displayFileName(file.name);
    this.options.presentation.setLoading(true);
    this.options.presentation.setFeedback(`Opening ${name}…`);
    try {
      const imported = await importModelFile(file, this.options.importer);
      if (!this.isCurrent(generation)) return;
      const model = createImportedModel(name, imported);
      this.activateImportedModel(model, previous);
      this.options.presentation.setFeedback(importFeedback(model.name, imported));
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      this.options.presentation.setFeedback(
        `${name} could not be opened: ${errorMessage(error)}`,
        "error",
      );
    } finally {
      if (generation === this.generation) {
        this.options.presentation.setLoading(false);
      }
    }
  }

  private activateImportedModel(model: WorkbenchModel, previous: WorkbenchModel): void {
    try {
      this.options.activate(model);
    } catch (error) {
      if (this.options.getModel() !== previous) {
        try {
          this.options.activate(previous);
        } catch {
          // Preserve the original import failure; the renderer reports any recovery failure.
        }
      }
      throw error;
    }
  }

  private async loadDeferredModel(model: WorkbenchModel, generation: number): Promise<void> {
    const deferredLoad = model.deferredLoad;
    if (deferredLoad === undefined) return;
    this.options.presentation.setLoading(true, { allowModelSelection: true });
    this.options.presentation.setFeedback(`Building ${model.name}…`);
    try {
      await yieldToBrowser();
      if (!this.isCurrent(generation)) return;
      const loaded = await deferredLoad();
      if (this.isCurrent(generation)) this.options.activate(loaded);
    } catch (error) {
      if (this.isCurrent(generation)) {
        this.options.presentation.setFeedback(
          `${model.name} could not be built: ${errorMessage(error)}`,
          "error",
        );
      }
    } finally {
      if (generation === this.generation) {
        this.options.presentation.setLoading(false, { allowModelSelection: true });
      }
    }
  }

  private isCurrent(generation: number): boolean {
    return !this.options.isDisposed() && generation === this.generation;
  }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}
