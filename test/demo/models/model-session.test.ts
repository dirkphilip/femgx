import { describe, expect, it, vi } from "vitest";
import { createBoltedPlatePreset } from "../../../demo/fixtures/presets";
import { createExampleModel, type WorkbenchModel } from "../../../demo/workbench/models/model";
import { WorkbenchModelSession } from "../../../demo/workbench/models/model-session";
import type { WorkbenchPresentation } from "../../../demo/workbench/viewport/presentation";

describe("workbench model session", () => {
  it("cancels a deferred load when the catalog changes", async () => {
    vi.stubGlobal("window", { setTimeout: globalThis.setTimeout });
    const ordinary = createExampleModel(createBoltedPlatePreset());
    const loaded = { ...ordinary, id: "lazy-loaded", name: "Loaded benchmark" };
    let resolveLoad: ((model: WorkbenchModel) => void) | undefined;
    const deferred = {
      ...ordinary,
      id: "lazy",
      name: "Lazy benchmark",
      deferredLoad: () =>
        new Promise<WorkbenchModel>((resolve) => {
          resolveLoad = resolve;
        }),
    };
    let current = ordinary;
    const activate = vi.fn((model: WorkbenchModel) => {
      current = model;
    });
    const session = new WorkbenchModelSession({
      presentation: {
        setLoading: vi.fn(),
        setFeedback: vi.fn(),
        clearFeedback: vi.fn(),
      } as unknown as WorkbenchPresentation,
      getModels: () => [ordinary, deferred],
      importer: vi.fn(),
      getModel: () => current,
      isDisposed: () => false,
      activate,
    });

    session.setModel(deferred.id);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    expect(resolveLoad).toBeDefined();
    session.cancel();
    resolveLoad?.(loaded);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

    expect(activate).not.toHaveBeenCalled();
    expect(current).toBe(ordinary);
    vi.unstubAllGlobals();
  });
});
