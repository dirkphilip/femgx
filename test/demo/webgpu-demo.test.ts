import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Camera } from "../../src/camera/camera";
import type { ModelPreset } from "../../src/fixture/presets";
import { createInteractionState, type InteractionState, type SceneRuntime } from "../../src/index";
import type { RendererFactory, RendererOptions } from "../../demo/webgpu-probe";
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
    startCpuDemo: vi.fn(),
  };
});

vi.mock("../../demo/controller", () => ({
  WorkbenchController: mocks.FakeWorkbenchController,
}));
vi.mock("../../demo/cpu-demo", () => ({
  startCpuDemo: mocks.startCpuDemo,
}));

interface DemoSeam {
  readonly destroyRenderer: () => void;
  readonly recreateRenderer: () => Promise<void>;
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
    cloneNode: (): unknown => ({ dataset: {} }),
    replaceWith: (): void => undefined,
  } as unknown as HTMLCanvasElement;
  return canvas;
}

function fakeRenderer() {
  const renderer = {
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

type FakeRenderer = ReturnType<typeof fakeRenderer>;

function minimalPreset(): ModelPreset {
  return { scene: { parts: new Map<number, never>() } } as unknown as ModelPreset;
}

function startOptions(
  canvas: HTMLCanvasElement,
  createRenderer: RendererFactory,
): Parameters<typeof startWebGpuDemo>[0] {
  return {
    view: { canvas } as unknown as DemoView,
    canvas,
    preset: minimalPreset(),
    createRenderer,
  };
}

/** A factory whose committed renderer reports its device lost before returning. */
function startupLossFactory(renderer: FakeRenderer): RendererFactory {
  return (options?: RendererOptions) => {
    renderer.lost = true;
    options?.onDeviceLost?.({
      reason: "destroyed",
      message: "device destroyed during startup wiring",
    });
    return Promise.resolve(renderer);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  demoWindow = {
    addEventListener: () => undefined,
  };
  (globalThis as { window?: unknown }).window = demoWindow;
  mocks.startCpuDemo.mockImplementation((options: { readonly canvas: HTMLCanvasElement }) => {
    options.canvas.dataset["renderer"] = "cpu";
    return { rendererState: "", render: vi.fn() };
  });
});

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

describe("startWebGpuDemo", () => {
  it("starts without recovery when the committed device is healthy", async () => {
    const renderer = fakeRenderer();
    const canvas = fakeCanvas();
    const controller = await startWebGpuDemo(startOptions(canvas, () => Promise.resolve(renderer)));

    expect(renderer.recover).not.toHaveBeenCalled();
    expect(canvas.dataset["recovery"]).toBeUndefined();
    expect(canvas.dataset["renderer"]).toBe("webgpu");

    controller.render();
    expect(Number(canvas.dataset["frames"])).toBeGreaterThanOrEqual(1);
  });

  it("recovers a device lost during startup once the renderer and controller are wired up", async () => {
    const renderer = fakeRenderer();
    const canvas = fakeCanvas();
    const controller = await startWebGpuDemo(startOptions(canvas, startupLossFactory(renderer)));

    await vi.waitFor(() => {
      expect(canvas.dataset["recovery"]).toBe("recovered");
    });
    expect(renderer.recover).toHaveBeenCalledTimes(1);
    expect(renderer.lost).toBe(false);
    expect(controller.rendererState).toBe("recovered");

    controller.render();
    expect(Number(canvas.dataset["frames"])).toBeGreaterThanOrEqual(1);
  });

  it("falls back to the CPU renderer when a device lost during startup cannot recover", async () => {
    const renderer = fakeRenderer();
    renderer.recover.mockRejectedValue(new Error("cannot re-request a GPU device"));
    const canvas = fakeCanvas();
    await startWebGpuDemo(startOptions(canvas, startupLossFactory(renderer)));

    await vi.waitFor(() => {
      expect(mocks.startCpuDemo).toHaveBeenCalledTimes(1);
    });
    expect(renderer.destroy).toHaveBeenCalled();
    const fallback = mocks.startCpuDemo.mock.calls[0]?.[0] as
      { readonly canvas: HTMLCanvasElement } | undefined;
    expect(fallback?.canvas.dataset["recovery"]).toBe("cpu-fallback");
    expect(fallback?.canvas.dataset["renderer"]).toBe("cpu");
  });

  it("recovers a device lost while the renderer is being re-created", async () => {
    const first = fakeRenderer();
    const second = fakeRenderer();
    let calls = 0;
    const factory: RendererFactory = (options?: RendererOptions) => {
      calls += 1;
      if (calls === 1) return Promise.resolve(first);
      second.lost = true;
      options?.onDeviceLost?.({ reason: "destroyed", message: "lost during re-creation" });
      return Promise.resolve(second);
    };
    const canvas = fakeCanvas();
    await startWebGpuDemo(startOptions(canvas, factory));

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

  it("drives instance updates as a delta instead of a whole-runtime rewrite", async () => {
    const renderer = fakeRenderer();
    const canvas = fakeCanvas();
    const controller = await startWebGpuDemo(startOptions(canvas, () => Promise.resolve(renderer)));

    controller.render();
    controller.render();

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
});
