import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Camera } from "../../src/camera/camera";
import type { ModelPreset } from "../../src/fixture/presets";
import { createInteractionState, type InteractionState, type SceneRuntime } from "../../src/index";
import type { DemoView } from "../../demo/view";
import type { RendererHooks, WorkbenchController, WorkbenchOptions } from "../../demo/controller";
import { startWebGpuDemo } from "../../demo/webgpu-demo";

const mocks = vi.hoisted(() => {
  class FakeWorkbenchController {
    readonly hooks: RendererHooks;
    readonly onDestroy: (() => void) | undefined;
    rendererState = "";
    interaction: InteractionState = createInteractionState();
    runtime = { instanceCount: 0, visibleCount: 0 } as SceneRuntime;
    cameraRef = { camera: {} as Camera };
    preset = { scene: { parts: new Map<number, never>() } } as unknown as ModelPreset;

    constructor(options: WorkbenchOptions) {
      this.hooks = options.hooks;
      this.onDestroy = options.onDestroy;
    }

    render(): void {
      this.hooks.render(this as unknown as WorkbenchController, this.interaction);
    }

    destroy(): void {
      this.onDestroy?.();
    }
  }
  return {
    FakeWorkbenchController,
    createWebGpuRenderer: vi.fn(),
  };
});

vi.mock("../../demo/controller", () => ({
  WorkbenchController: mocks.FakeWorkbenchController,
}));
vi.mock("../../src/renderer/gpu-renderer", () => ({
  createWebGpuRenderer: mocks.createWebGpuRenderer,
}));

interface DemoSeam {
  readonly destroyRenderer: () => void;
  readonly recreateRenderer: () => Promise<void>;
  readonly forceDeviceLoss: () => void;
}

interface DemoWindow {
  readonly addEventListener: (type: string, listener: () => void) => void;
  femgxDemo?: DemoSeam;
}

const originalWindow = (globalThis as { readonly window?: unknown }).window;

let demoWindow: DemoWindow;

function fakeCanvas(): HTMLCanvasElement {
  const canvas = {
    dataset: {},
  } as unknown as HTMLCanvasElement;
  return canvas;
}

function fakeRenderer(): FakeRenderer {
  const renderer: FakeRenderer = {
    lost: false,
    recover: vi.fn((): Promise<void> => {
      renderer.lost = false;
      return Promise.resolve();
    }),
    render: vi.fn(),
    setDeformation: vi.fn(),
    updateInstances: vi.fn(),
    updateElements: vi.fn(),
    setEdgeDepthTest: vi.fn(),
    updateVisibility: vi.fn(),
    pick: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
    stats: vi.fn(() => ({ drawBatches: 0 })),
    device: {} as GPUDevice,
  };
  return renderer;
}

interface FakeRenderer {
  lost: boolean;
  recover: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  setDeformation: ReturnType<typeof vi.fn>;
  updateInstances: ReturnType<typeof vi.fn>;
  updateElements: ReturnType<typeof vi.fn>;
  setEdgeDepthTest: ReturnType<typeof vi.fn>;
  updateVisibility: ReturnType<typeof vi.fn>;
  pick: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  stats: ReturnType<typeof vi.fn>;
  device: GPUDevice;
}

function startOptions(canvas: HTMLCanvasElement): Parameters<typeof startWebGpuDemo>[0] {
  return {
    view: {
      canvas,
      rendererStatus: { textContent: "" },
      status: { textContent: "" },
    } as unknown as DemoView,
    canvas,
  };
}

/** A factory whose committed renderer reports its device lost before returning. */
function startupLossRenderer(): FakeRenderer {
  const renderer = fakeRenderer();
  renderer.lost = true;
  renderer.recover.mockImplementation(() => {
    renderer.lost = false;
  });
  mocks.createWebGpuRenderer.mockImplementation(
    (options: { readonly onDeviceLost?: (info: { reason: string; message: string }) => void }) => {
      options.onDeviceLost?.({
        reason: "destroyed",
        message: "device lost during startup wiring",
      });
      return Promise.resolve(renderer);
    },
  );
  return renderer;
}

beforeEach(() => {
  vi.clearAllMocks();
  demoWindow = {
    addEventListener: () => undefined,
  };
  (globalThis as { window?: unknown }).window = demoWindow;
});

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

describe("startWebGpuDemo", () => {
  it("starts the renderer without recovery when the device is healthy", async () => {
    const renderer = fakeRenderer();
    mocks.createWebGpuRenderer.mockResolvedValue(renderer);
    const canvas = fakeCanvas();
    const controller = await startWebGpuDemo(startOptions(canvas));

    expect(renderer.recover).not.toHaveBeenCalled();
    expect(canvas.dataset["recovery"]).toBeUndefined();
    expect(canvas.dataset["renderer"]).toBe("webgpu");

    controller?.render();
    expect(Number(canvas.dataset["frames"])).toBeGreaterThanOrEqual(1);
  });

  it("recovers a device lost during startup once the renderer and controller are wired up", async () => {
    const renderer = startupLossRenderer();
    const canvas = fakeCanvas();
    const controller = await startWebGpuDemo(startOptions(canvas));

    expect(controller).toBeDefined();
    await vi.waitFor(() => {
      expect(canvas.dataset["recovery"]).toBe("recovered");
    });
    expect(renderer.recover).toHaveBeenCalledTimes(1);
    expect(renderer.lost).toBe(false);
    expect(controller?.rendererState).toBe("recovered");

    controller?.render();
    expect(Number(canvas.dataset["frames"])).toBeGreaterThanOrEqual(1);
  });

  it("reports an explicit error and destroys the renderer when recovery is impossible", async () => {
    const renderer = startupLossRenderer();
    renderer.recover.mockRejectedValue(new Error("cannot re-request a GPU device"));
    const canvas = fakeCanvas();
    await startWebGpuDemo(startOptions(canvas));

    await vi.waitFor(() => {
      expect(canvas.dataset["recovery"]).toBe("error");
    });
    expect(renderer.destroy).toHaveBeenCalled();
    expect(canvas.dataset["renderer"]).toBe("unsupported");
  });

  it("reports an explicit unsupported message when the renderer cannot be created", async () => {
    mocks.createWebGpuRenderer.mockRejectedValue(new Error("no WebGPU adapter"));
    const canvas = fakeCanvas();
    const status = { textContent: "" };
    const rendererStatus = { textContent: "" };
    const controller = await startWebGpuDemo({
      view: { canvas, status, rendererStatus } as unknown as DemoView,
      canvas,
    });

    expect(controller).toBeUndefined();
    expect(canvas.dataset["renderer"]).toBe("unsupported");
    expect(status.textContent).toContain("femgx requires a usable WebGPU renderer");
    expect(status.textContent).toContain("no WebGPU adapter");
    expect(rendererStatus.textContent).toBe("Renderer unsupported");
  });

  it("reports a first-frame submission failure and destroys the renderer", async () => {
    const renderer = fakeRenderer();
    renderer.render.mockImplementation(() => {
      throw new Error("frame submit exploded");
    });
    mocks.createWebGpuRenderer.mockResolvedValue(renderer);
    const canvas = fakeCanvas();
    const status = { textContent: "" };
    const rendererStatus = { textContent: "" };
    const controller = await startWebGpuDemo({
      view: { canvas, status, rendererStatus } as unknown as DemoView,
      canvas,
    });

    expect(controller).toBeUndefined();
    expect(canvas.dataset["renderer"]).toBe("unsupported");
    expect(status.textContent).toContain("femgx requires a usable WebGPU renderer");
    expect(status.textContent).toContain("frame submit exploded");
    expect(renderer.destroy).toHaveBeenCalled();
  });

  it("drives instance updates as a delta instead of a whole-runtime rewrite", async () => {
    const renderer = fakeRenderer();
    mocks.createWebGpuRenderer.mockResolvedValue(renderer);
    const canvas = fakeCanvas();
    const controller = await startWebGpuDemo(startOptions(canvas));

    controller?.render();
    controller?.render();

    const changedLists: unknown[] = renderer.updateInstances.mock.calls.map(
      (call) => call[2] as unknown,
    );
    expect(changedLists.length).toBeGreaterThanOrEqual(2);
    for (const changed of changedLists) {
      // With an unchanged (empty) interaction state nothing is styled, so no
      // instance slot needs a patch; the demo must never rewrite every slot.
      expect(changed).toEqual([]);
    }
  });

  it("recovers a device lost while the renderer is being re-created", async () => {
    const first = fakeRenderer();
    const second = fakeRenderer();
    let calls = 0;
    mocks.createWebGpuRenderer.mockImplementation(
      (options: {
        readonly onDeviceLost?: (info: { reason: string; message: string }) => void;
      }) => {
        calls += 1;
        if (calls === 1) return Promise.resolve(first);
        second.lost = true;
        options.onDeviceLost?.({ reason: "destroyed", message: "lost during re-creation" });
        return Promise.resolve(second);
      },
    );
    const canvas = fakeCanvas();
    await startWebGpuDemo(startOptions(canvas));

    const seam = demoWindow.femgxDemo;
    expect(seam).toBeDefined();
    seam?.destroyRenderer();
    await seam?.recreateRenderer();

    await vi.waitFor(() => {
      expect(canvas.dataset["recovery"]).toBe("recovered");
    });
    expect(second.recover).toHaveBeenCalledTimes(1);
    expect(second.lost).toBe(false);
  });

  it("reports a renderer re-creation failure instead of swallowing it", async () => {
    const first = fakeRenderer();
    mocks.createWebGpuRenderer.mockResolvedValueOnce(first);
    const canvas = fakeCanvas();
    const status = { textContent: "" };
    const rendererStatus = { textContent: "" };
    await startWebGpuDemo({
      view: { canvas, status, rendererStatus } as unknown as DemoView,
      canvas,
    });

    const seam = demoWindow.femgxDemo;
    expect(seam).toBeDefined();
    seam?.destroyRenderer();
    mocks.createWebGpuRenderer.mockRejectedValue(new Error("re-creation failed"));
    await seam?.recreateRenderer();

    expect(canvas.dataset["renderer"]).toBe("unsupported");
    expect(status.textContent).toContain("femgx requires a usable WebGPU renderer");
    expect(status.textContent).toContain("re-creation failed");
    expect(rendererStatus.textContent).toBe("Renderer unsupported");
  });
});
