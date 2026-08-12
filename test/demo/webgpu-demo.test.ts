import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FemViewport } from "../../src/viewport/fem-viewport";
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
    runWebGpuBenchmark: vi.fn(() => Promise.resolve({ schemaVersion: 1 })),
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

interface FakeViewport {
  readonly viewport: FemViewport;
  readonly render: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
}

function fakeViewport(): FakeViewport {
  const render = vi.fn();
  const destroy = vi.fn();
  return {
    render,
    destroy,
    viewport: {
      scene: {} as FemViewport["scene"],
      runtime: { visibleCount: 0 } as FemViewport["runtime"],
      camera: {} as FemViewport["camera"],
      interaction: {} as FemViewport["interaction"],
      results: undefined,
      setScene: vi.fn(),
      setCamera: vi.fn(),
      fitView: vi.fn(),
      setInteraction: vi.fn(),
      batch: <T>(operation: () => T): T => operation(),
      setResults: vi.fn(),
      clearResults: vi.fn(),
      setEdgeDepthTest: vi.fn(),
      setPartVisible: vi.fn(),
      setAssemblyNodeVisible: vi.fn(),
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
    view: {
      canvas,
      scene: fakeScene(),
      rendererStatus: { textContent: "" },
      status: { textContent: "" },
    } as unknown as DemoView,
    canvas,
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
    mocks.createFemViewport.mockRejectedValue(new Error("no WebGPU adapter"));
    const canvas = fakeCanvas();
    const status = { textContent: "" };
    const rendererStatus = { textContent: "" };

    const controller = await startWebGpuDemo({
      view: { canvas, status, rendererStatus } as unknown as DemoView,
      canvas,
    });

    expect(controller).toBeUndefined();
    expect(canvas.dataset["renderer"]).toBe("unsupported");
    expect(status.textContent).toContain("no WebGPU adapter");
    expect(rendererStatus.textContent).toBe("Renderer unsupported");
  });

  it("reports a first-frame failure and destroys the viewport", async () => {
    const viewport = fakeViewport();
    viewport.render.mockImplementation(() => {
      throw new Error("frame submit exploded");
    });
    mocks.createFemViewport.mockResolvedValue(viewport.viewport);
    const canvas = fakeCanvas();
    const status = { textContent: "" };

    const controller = await startWebGpuDemo({
      view: { canvas, status, rendererStatus: { textContent: "" } } as unknown as DemoView,
      canvas,
    });

    expect(controller).toBeUndefined();
    expect(viewport.destroy).toHaveBeenCalled();
    expect(status.textContent).toContain("frame submit exploded");
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

  it("reports a viewport recreation failure", async () => {
    const first = fakeViewport();
    mocks.createFemViewport.mockResolvedValueOnce(first.viewport);
    const canvas = fakeCanvas();
    const status = { textContent: "" };
    await startWebGpuDemo({
      view: { canvas, status, rendererStatus: { textContent: "" } } as unknown as DemoView,
      canvas,
    });
    demoWindow.femgxDemo?.destroyRenderer();
    mocks.createFemViewport.mockRejectedValueOnce(new Error("recreation failed"));

    await demoWindow.femgxDemo?.recreateRenderer();

    expect(canvas.dataset["renderer"]).toBe("unsupported");
    expect(status.textContent).toContain("recreation failed");
  });

  it("tears down the workbench before running the opt-in benchmark", async () => {
    const viewport = fakeViewport();
    mocks.createFemViewport.mockResolvedValue(viewport.viewport);
    const canvas = fakeCanvas();
    await startWebGpuDemo(startOptions(canvas));

    await expect(demoWindow.femgxDemo?.runBenchmark(true)).resolves.toEqual({ schemaVersion: 1 });
    expect(viewport.destroy).toHaveBeenCalledOnce();
    expect(mocks.runWebGpuBenchmark).toHaveBeenCalledWith(canvas, { includeLarge: true });
  });
});
