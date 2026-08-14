import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FemViewport } from "../../src/viewport/fem-viewport";
import { WebGpuUnsupportedError } from "../../src/platform/capabilities";
import type { DemoView } from "../../demo/workbench/view";
import type { WorkbenchOptions } from "../../demo/workbench/controller";
import { startWebGpuDemo } from "../../demo/workbench/start";

const mocks = vi.hoisted(() => {
  class FakeWorkbenchController {
    readonly interaction = {} as never;
    readonly model;
    rendererState = "";
    private currentViewport;

    constructor(options: WorkbenchOptions) {
      this.currentViewport = options.viewport;
      this.model = options.presets[0];
    }

    get camera() {
      return this.currentViewport.camera;
    }

    render(): void {
      this.currentViewport.setInteraction(this.interaction);
    }

    onViewportRender(): void {
      this.render();
    }

    setViewport(viewport: FemViewport): void {
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
    createFemViewport: vi.fn(),
    runWebGpuBenchmark: vi.fn(() => Promise.resolve({ schemaVersion: 2 })),
  };
});

vi.mock("../../demo/workbench/controller", () => ({
  WorkbenchController: mocks.FakeWorkbenchController,
}));
vi.mock("../../src/index", async (importOriginal) => ({
  ...(await importOriginal()),
  createFemViewport: mocks.createFemViewport,
}));
vi.mock("../../demo/benchmark/runner", () => ({
  runWebGpuBenchmark: mocks.runWebGpuBenchmark,
}));

interface DemoSeam {
  readonly destroyRenderer: () => void;
  readonly recreateRenderer: () => Promise<void>;
  readonly runBenchmark: (includeLarge: boolean) => Promise<unknown>;
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
  readonly viewport: FemViewport;
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
  return {
    render,
    setInteraction,
    destroy,
    viewport: {
      scene: {} as FemViewport["scene"],
      runtime: { visibleCount: 0 } as FemViewport["runtime"],
      camera: {} as FemViewport["camera"],
      interaction: {} as FemViewport["interaction"],
      results: undefined,
      sectionPlane: undefined,
      updateScene: vi.fn(() => ({ results: "none" as const })),
      setScene: vi.fn(),
      setCamera: vi.fn(),
      fitView: vi.fn(),
      fitSelection: vi.fn(),
      setInteraction,
      batch: <T>(operation: () => T): T => operation(),
      setResults: vi.fn(),
      clearResults: vi.fn(),
      setSectionPlane: vi.fn(),
      clearSectionPlane: vi.fn(),
      setBackground: vi.fn(),
      setPointSizePixels: vi.fn(),
      setNodeSizePixels: vi.fn(),
      setEdgeDepthTest: vi.fn(),
      setPartVisible: vi.fn(),
      setAssemblyOccurrenceVisible: vi.fn(),
      setAssemblyVisible: vi.fn(),
      setInstanceVisible: vi.fn(),
      pick: vi.fn(),
      pickRegion: vi.fn(),
      resize: vi.fn(),
      invalidate: vi.fn(),
      render,
      recover: vi.fn(),
      destroy,
      stats: vi.fn(() => ({ visibleInstances: 0, drawBatches: 0 })),
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
  it("starts through the public FEM viewport", async () => {
    const viewport = fakeViewport();
    mocks.createFemViewport.mockResolvedValue(viewport.viewport);
    const canvas = fakeCanvas();

    const controller = await startWebGpuDemo(startOptions(canvas));

    expect(controller).toBeDefined();
    expect(mocks.createFemViewport).toHaveBeenCalledOnce();
    expect(viewport.render).toHaveBeenCalled();
    expect(canvas.dataset["renderer"]).toBe("webgpu");
  });

  it("does not schedule continuous frames for a static preset", async () => {
    const viewport = fakeViewport();
    mocks.createFemViewport.mockResolvedValue(viewport.viewport);
    const requestFrame = vi.fn(() => 1);
    globalThis.requestAnimationFrame = requestFrame;

    await startWebGpuDemo(startOptions(fakeCanvas()));

    expect(viewport.render).toHaveBeenCalledOnce();
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("reports an explicit unsupported message when viewport creation fails", async () => {
    mocks.createFemViewport.mockRejectedValue(
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
    mocks.createFemViewport.mockRejectedValue(new Error("renderer initialization failed"));
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
    mocks.createFemViewport.mockResolvedValue(viewport.viewport);
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
    mocks.createFemViewport
      .mockResolvedValueOnce(first.viewport)
      .mockResolvedValueOnce(second.viewport);
    const canvas = fakeCanvas();
    await startWebGpuDemo(startOptions(canvas));

    demoWindow.femgxDemo?.destroyRenderer();
    expect(first.destroy).toHaveBeenCalledOnce();
    expect(canvas.dataset["renderer"]).toBe("destroyed");

    await demoWindow.femgxDemo?.recreateRenderer();
    expect(mocks.createFemViewport).toHaveBeenCalledTimes(2);
    expect(second.render).toHaveBeenCalled();
    expect(canvas.dataset["renderer"]).toBe("webgpu");
  });

  it("attaches a recreated viewport before publishing its initial frame", async () => {
    const first = fakeViewport();
    const second = fakeViewport();
    mocks.createFemViewport
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
    mocks.createFemViewport.mockResolvedValueOnce(first.viewport);
    const canvas = fakeCanvas();
    const startup = { rendererStatus: "", status: "" };
    await startWebGpuDemo({
      view: fakeView(canvas),
      canvas,
      reportStartupFailure: (next) => Object.assign(startup, next),
    });
    demoWindow.femgxDemo?.destroyRenderer();
    mocks.createFemViewport.mockRejectedValueOnce(new Error("recreation failed"));

    await demoWindow.femgxDemo?.recreateRenderer();

    expect(canvas.dataset["renderer"]).toBe("error");
    expect(startup.status).toContain("recreation failed");
  });

  it("tears down the workbench before running the opt-in benchmark", async () => {
    const viewport = fakeViewport();
    mocks.createFemViewport.mockResolvedValue(viewport.viewport);
    const canvas = fakeCanvas();
    await startWebGpuDemo(startOptions(canvas));

    await expect(demoWindow.femgxDemo?.runBenchmark(true)).resolves.toEqual({ schemaVersion: 2 });
    expect(viewport.destroy).toHaveBeenCalledOnce();
    expect(mocks.runWebGpuBenchmark).toHaveBeenCalledWith(canvas, { includeLarge: true });
  });
});
