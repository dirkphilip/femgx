import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Viewport } from "../../src/viewport/viewport";
import { WebGpuUnsupportedError } from "../../src/platform/capabilities";
import type { DemoView } from "../../demo/workbench/viewport/view";
import type { WorkbenchOptions } from "../../demo/workbench/controllers/controller";
import { startWebGpuDemo } from "../../demo/workbench/start";
import type { BenchmarkCapture } from "../../demo/benchmark/capture";

const mocks = vi.hoisted(() => {
  class FakeWorkbenchController {
    readonly interaction = {} as never;
    readonly model;
    rendererState = "";
    private currentViewport;

    constructor(options: WorkbenchOptions) {
      mocks.receivedPresets = options.presets;
      this.currentViewport = options.viewport;
      this.model = options.presets[0];
    }

    readonly commands = {
      meshTet4(): void {},
    };

    get camera() {
      return this.currentViewport.view.camera;
    }

    render(): void {
      this.currentViewport.interaction.set(this.interaction);
    }

    onViewportRender(): void {
      this.render();
    }

    setViewport(viewport: Viewport): void {
      this.currentViewport = viewport;
    }

    invalidateInteraction(): void {}
    detachViewport(): void {}

    setCameraGestureActive(): void {}
    destroy(): void {
      this.currentViewport.destroy();
    }
  }
  return {
    FakeWorkbenchController,
    createViewport: vi.fn(),
    runWebGpuBenchmark: vi.fn(() => Promise.resolve({ schemaVersion: 2 })),
    receivedPresets: [] as readonly { readonly id: string }[],
  };
});

vi.mock("../../demo/workbench/controllers/controller", () => ({
  WorkbenchController: mocks.FakeWorkbenchController,
}));
vi.mock("../../src/entries/root", async (importOriginal) => ({
  ...(await importOriginal()),
  createViewport: mocks.createViewport,
}));
vi.mock("../../demo/benchmark/runner", () => ({
  runWebGpuBenchmark: mocks.runWebGpuBenchmark,
}));

interface DemoSeam {
  readonly destroyRenderer: () => void;
  readonly recreateRenderer: () => Promise<void>;
  readonly runBenchmark: (
    includeLarge: boolean,
    caseId?: string,
    capture?: BenchmarkCapture,
  ) => Promise<unknown>;
}

interface DemoWindow {
  readonly addEventListener: (type: string, listener: () => void) => void;
  femgxDemo?: DemoSeam;
}

const originalWindow = (globalThis as { readonly window?: unknown }).window;
const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
let demoWindow: DemoWindow;

function fakeCanvas(): HTMLCanvasElement {
  return { dataset: {} } as unknown as HTMLCanvasElement;
}

function fakeScene(): HTMLElement {
  return {} as HTMLElement;
}

function fakeView(canvas: HTMLCanvasElement): DemoView {
  return {
    primaryPane: {
      id: "primary",
      scene: fakeScene(),
      canvas,
      boxSelectionOverlay: fakeScene(),
    },
  } as unknown as DemoView;
}

interface FakeViewport {
  readonly viewport: Viewport;
  readonly render: ReturnType<typeof vi.fn>;
  readonly setInteraction: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
}

function fakeViewport(): FakeViewport {
  const render = vi.fn();
  let destroyed = false;
  const setInteraction = vi.fn(() => {
    if (destroyed) throw new Error("WebGPU renderer has been destroyed");
  });
  const destroy = vi.fn(() => {
    destroyed = true;
  });
  const interaction = {
    state: {} as Viewport["interaction"]["state"],
    set: setInteraction,
    pick: vi.fn(),
    pickRegion: vi.fn(),
  };
  const results = { state: undefined, set: vi.fn(), clear: vi.fn() } as Viewport["results"];
  const presentation = {
    sectionPlane: undefined,
    setSectionPlane: vi.fn(),
    clearSectionPlane: vi.fn(),
    setBackground: vi.fn(),
    setPointSizePixels: vi.fn(),
    setNodeSizePixels: vi.fn(),
    setEdgeDepthTest: vi.fn(),
  } as Viewport["presentation"];
  const visibility = {
    setPart: vi.fn(),
    setAssembly: vi.fn(),
    setAssemblyOccurrence: vi.fn(),
    setPartOccurrence: vi.fn(),
    setPartOccurrences: vi.fn(),
  } as Viewport["visibility"];
  return {
    render,
    setInteraction,
    destroy,
    viewport: {
      scene: {} as unknown as Viewport["scene"],
      runtime: { visibleCount: 0 } as Viewport["runtime"],
      view: {
        camera: {} as Viewport["view"]["camera"],
        setCamera: vi.fn(),
        fit: vi.fn(),
        fitSelection: vi.fn(),
      },
      interaction,
      visibility,
      results,
      presentation,
      updateScene: vi.fn(() => ({ results: "none" as const })),
      replaceScene: vi.fn(),
      batch: <T>(operation: () => T): T => operation(),
      resize: vi.fn(),
      invalidate: vi.fn(),
      render,
      recover: vi.fn(),
      destroy,
      stats: vi.fn(() => ({ visiblePartOccurrences: 0, drawBatches: 0 })),
    },
  };
}

function startOptions(canvas: HTMLCanvasElement): Parameters<typeof startWebGpuDemo>[0] {
  return {
    view: fakeView(canvas),
    canvas,
    reportStartupFailure: () => undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  demoWindow = { addEventListener: () => undefined };
  (globalThis as { window?: unknown }).window = demoWindow;
});

afterEach(() => {
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = originalWindow;
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
});

describe("startWebGpuDemo", () => {
  it("starts ordinary mode without benchmark catalog entries", async () => {
    const viewport = fakeViewport();
    mocks.createViewport.mockResolvedValue(viewport.viewport);

    await startWebGpuDemo(startOptions(fakeCanvas()));

    expect(mocks.receivedPresets).toHaveLength(6);
    expect(mocks.receivedPresets.some((model) => model.id === "unique-250k")).toBe(false);
  });

  it("starts through the public FEM viewport", async () => {
    const viewport = fakeViewport();
    mocks.createViewport.mockResolvedValue(viewport.viewport);
    const canvas = fakeCanvas();

    const controller = await startWebGpuDemo(startOptions(canvas));

    expect(controller).toBeDefined();
    expect(mocks.createViewport).toHaveBeenCalledOnce();
    expect(viewport.render).toHaveBeenCalled();
    expect(canvas.dataset["renderer"]).toBe("webgpu");
  });

  it("does not schedule continuous frames for a static preset", async () => {
    const viewport = fakeViewport();
    mocks.createViewport.mockResolvedValue(viewport.viewport);
    const requestFrame = vi.fn(() => 1);
    globalThis.requestAnimationFrame = requestFrame;

    await startWebGpuDemo(startOptions(fakeCanvas()));

    expect(viewport.render).toHaveBeenCalledOnce();
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("reports an explicit unsupported message when viewport creation fails", async () => {
    mocks.createViewport.mockRejectedValue(
      new WebGpuUnsupportedError("adapter-unavailable", "no WebGPU adapter"),
    );
    const canvas = fakeCanvas();
    const startup = { rendererStatus: "", status: "" };

    const controller = await startWebGpuDemo({
      view: fakeView(canvas),
      canvas,
      reportStartupFailure: (next) => Object.assign(startup, next),
    });

    expect(controller).toBeUndefined();
    expect(canvas.dataset["renderer"]).toBe("unsupported");
    expect(startup.status).toContain("no WebGPU adapter");
    expect(startup.rendererStatus).toBe("Renderer unsupported");
  });

  it("reports an ordinary startup failure as a renderer error", async () => {
    mocks.createViewport.mockRejectedValue(new Error("renderer initialization failed"));
    const canvas = fakeCanvas();
    const startup = { rendererStatus: "", status: "" };

    const controller = await startWebGpuDemo({
      view: fakeView(canvas),
      canvas,
      reportStartupFailure: (next) => Object.assign(startup, next),
    });

    expect(controller).toBeUndefined();
    expect(canvas.dataset["renderer"]).toBe("error");
    expect(startup.status).toContain("renderer initialization failed");
    expect(startup.rendererStatus).toBe("Renderer error");
  });

  it("reports a first-frame failure and destroys the viewport", async () => {
    const viewport = fakeViewport();
    viewport.render.mockImplementation(() => {
      throw new Error("frame submit exploded");
    });
    mocks.createViewport.mockResolvedValue(viewport.viewport);
    const canvas = fakeCanvas();
    const startup = { rendererStatus: "", status: "" };

    const controller = await startWebGpuDemo({
      view: fakeView(canvas),
      canvas,
      reportStartupFailure: (next) => Object.assign(startup, next),
    });

    expect(controller).toBeUndefined();
    expect(viewport.destroy).toHaveBeenCalled();
    expect(startup.status).toContain("frame submit exploded");
  });

  it("tears down and recreates the public viewport", async () => {
    const first = fakeViewport();
    const second = fakeViewport();
    mocks.createViewport
      .mockResolvedValueOnce(first.viewport)
      .mockResolvedValueOnce(second.viewport);
    const canvas = fakeCanvas();
    await startWebGpuDemo(startOptions(canvas));

    demoWindow.femgxDemo?.destroyRenderer();
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(canvas.dataset["renderer"]).toBe("destroyed");

    await demoWindow.femgxDemo?.recreateRenderer();
    expect(mocks.createViewport).toHaveBeenCalledTimes(2);
    expect(second.render).toHaveBeenCalled();
    expect(canvas.dataset["renderer"]).toBe("webgpu");
  });

  it("attaches a recreated viewport before publishing its initial frame", async () => {
    const first = fakeViewport();
    const second = fakeViewport();
    mocks.createViewport
      .mockResolvedValueOnce(first.viewport)
      .mockImplementationOnce((options: { readonly onRender?: () => void }) => {
        options.onRender?.();
        return Promise.resolve(second.viewport);
      });
    const canvas = fakeCanvas();
    await startWebGpuDemo(startOptions(canvas));
    demoWindow.femgxDemo?.destroyRenderer();

    await expect(demoWindow.femgxDemo?.recreateRenderer()).resolves.toBeUndefined();

    expect(first.setInteraction).not.toHaveBeenCalled();
    expect(second.render).toHaveBeenCalledOnce();
    expect(canvas.dataset["renderer"]).toBe("webgpu");
  });

  it("reports a viewport recreation failure", async () => {
    const first = fakeViewport();
    mocks.createViewport.mockResolvedValueOnce(first.viewport);
    const canvas = fakeCanvas();
    const startup = { rendererStatus: "", status: "" };
    await startWebGpuDemo({
      view: fakeView(canvas),
      canvas,
      reportStartupFailure: (next) => Object.assign(startup, next),
    });
    demoWindow.femgxDemo?.destroyRenderer();
    mocks.createViewport.mockRejectedValueOnce(new Error("recreation failed"));

    await demoWindow.femgxDemo?.recreateRenderer();

    expect(canvas.dataset["renderer"]).toBe("error");
    expect(startup.status).toContain("recreation failed");
  });

  it("tears down the workbench before running the opt-in benchmark", async () => {
    const viewport = fakeViewport();
    mocks.createViewport.mockResolvedValue(viewport.viewport);
    const canvas = fakeCanvas();
    await startWebGpuDemo(startOptions(canvas));

    await expect(
      demoWindow.femgxDemo?.runBenchmark(true, "fe-tet4-solid-132k", "node-selection"),
    ).resolves.toEqual({ schemaVersion: 2 });
    expect(viewport.destroy).toHaveBeenCalledOnce();
    expect(mocks.runWebGpuBenchmark).toHaveBeenCalledWith(canvas, {
      includeLarge: true,
      caseId: "fe-tet4-solid-132k",
      capture: "node-selection",
    });
  });

  it("exposes an opt-in capture benchmark failure to the browser harness", async () => {
    const viewport = fakeViewport();
    mocks.createViewport.mockResolvedValue(viewport.viewport);
    mocks.runWebGpuBenchmark.mockRejectedValueOnce(new Error("node draw assertion failed"));
    const canvas = fakeCanvas();
    await startWebGpuDemo(startOptions(canvas));

    await expect(
      demoWindow.femgxDemo?.runBenchmark(false, "fe-tet4-solid-132k", "node-selection"),
    ).rejects.toThrow("node draw assertion failed");
    expect(canvas.dataset["benchmarkCaptureError"]).toBe("node draw assertion failed");
  });
});
