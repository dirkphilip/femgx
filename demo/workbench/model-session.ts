import type { importGlb } from "../../src/index";
import {
  clearModelFeedback,
  createImportedModel,
  displayFileName,
  errorMessage,
  importFeedback,
  setModelFeedback,
  setModelLoading,
  type WorkbenchModel,
} from "./model";
import type { DemoView } from "./view";

interface WorkbenchModelSessionOptions {
  readonly view: DemoView;
  readonly examples: readonly WorkbenchModel[];
  readonly importer: typeof importGlb;
  readonly getModel: () => WorkbenchModel;
  readonly isDisposed: () => boolean;
  readonly activate: (model: WorkbenchModel) => void;
}

/** Owns asynchronous preset and GLB loading, including stale-load handling. */
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
      setModelLoading(this.options.view, false, { allowModelSelection: true });
      clearModelFeedback(this.options.view);
    } else if (model.deferredLoad !== undefined) {
      void this.loadDeferredModel(model, generation);
    } else {
      this.options.activate(model);
    }
  }

  async openGlb(file: File): Promise<void> {
    const generation = ++this.generation;
    const name = displayFileName(file.name);
    setModelLoading(this.options.view, true);
    setModelFeedback(this.options.view, `Opening ${name}…`);
    try {
      const imported = await this.options.importer(await file.arrayBuffer());
      if (!this.isCurrent(generation)) return;
      const model = createImportedModel(name, imported);
      this.options.activate(model);
      setModelFeedback(this.options.view, importFeedback(model.name, imported));
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      setModelFeedback(
        this.options.view,
        `${name} could not be opened: ${errorMessage(error)}`,
        "error",
      );
    } finally {
      if (generation === this.generation) {
        this.options.view.glbFileInput.value = "";
        setModelLoading(this.options.view, false);
      }
    }
  }

  private async loadDeferredModel(model: WorkbenchModel, generation: number): Promise<void> {
    const deferredLoad = model.deferredLoad;
    if (deferredLoad === undefined) return;
    setModelLoading(this.options.view, true, { allowModelSelection: true });
    setModelFeedback(this.options.view, `Building ${model.name}…`);
    try {
      await yieldToBrowser();
      if (!this.isCurrent(generation)) return;
      const loaded = await deferredLoad();
      if (this.isCurrent(generation)) this.options.activate(loaded);
    } catch (error) {
      if (this.isCurrent(generation)) {
        setModelFeedback(
          this.options.view,
          `${model.name} could not be built: ${errorMessage(error)}`,
          "error",
        );
      }
    } finally {
      if (generation === this.generation) {
        setModelLoading(this.options.view, false, { allowModelSelection: true });
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
