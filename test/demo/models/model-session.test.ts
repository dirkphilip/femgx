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
    const cancelDeferredLoad = vi.fn();
    const deferred = {
      ...ordinary,
      id: "lazy",
      name: "Lazy benchmark",
      cancelDeferredLoad,
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
      resolveModel: (id) => [ordinary, deferred].find((model) => model.id === id),
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
    expect(cancelDeferredLoad).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("activates a retained model without invoking its deferred builder", () => {
    const ordinary = createExampleModel(createBoltedPlatePreset());
    const builder = vi.fn(() => Promise.resolve(ordinary));
    const retained = {
      ...ordinary,
      id: "retained",
      name: "Retained benchmark",
    };
    const placeholder = { ...retained, deferredLoad: builder };
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
      resolveModel: (id) => (id === retained.id ? retained : placeholder),
      importer: vi.fn(),
      getModel: () => current,
      isDisposed: () => false,
      activate,
    });

    session.setModel(retained.id);

    expect(activate).toHaveBeenCalledWith(retained);
    expect(builder).not.toHaveBeenCalled();
    expect(current).toBe(retained);
  });

  it("disposes deferred progress exactly once after a completed build", async () => {
    vi.stubGlobal("window", { setTimeout: globalThis.setTimeout });
    const ordinary = createExampleModel(createBoltedPlatePreset());
    const loaded = { ...ordinary, id: "loaded", name: "Loaded benchmark" };
    const progressDisposer = vi.fn();
    const deferred = {
      ...ordinary,
      id: "lazy",
      name: "Lazy benchmark",
      deferredLoad: () => Promise.resolve(loaded),
      subscribeDeferredProgress: vi.fn(() => progressDisposer),
    };
    let current = ordinary;
    const session = new WorkbenchModelSession({
      presentation: {
        setLoading: vi.fn(),
        setFeedback: vi.fn(),
        clearFeedback: vi.fn(),
      } as unknown as WorkbenchPresentation,
      resolveModel: (id) => (id === deferred.id ? deferred : undefined),
      importer: vi.fn(),
      getModel: () => current,
      isDisposed: () => false,
      activate: (model) => {
        current = model;
      },
    });

    session.setModel(deferred.id);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

    expect(current).toBe(loaded);
    expect(progressDisposer).toHaveBeenCalledOnce();
    session.cancel();
    expect(progressDisposer).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
