import { afterEach, describe, expect, it, vi } from "vitest";
import { createPart } from "../../src/geometry/part";
import { setBodyOverride, setBodyVisible } from "../../src/interaction/bodies";
import { setPartOverride } from "../../src/interaction/interaction";
import { setTargetSelected } from "../../src/interaction/targets";
import { translation } from "../../src/math/mat4";
import { createScene, type Scene } from "../../src/scene/scene";
import { createFemViewport } from "../../src/viewport/fem-viewport";
import { RendererAttachment } from "../../src/renderer/attachment";
import type { FemViewport } from "../../src/viewport/types";
import { fakeCanvas, fakeGpuDevice, installGpuGlobals } from "../renderer/fake-gpu";

let restoreGpuGlobals: (() => void) | undefined;
const originalNavigator = globalThis.navigator;

afterEach(() => {
  restoreGpuGlobals?.();
  restoreGpuGlobals = undefined;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
});

function installNavigator(): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: { getPreferredCanvasFormat: () => "bgra8unorm" } },
  });
}

function latestCameraUniform(gpu: ReturnType<typeof fakeGpuDevice>): Float32Array {
  const cameraBuffer = gpu.buffers.find(
    (buffer) => buffer.size === 128 && (buffer.usage & 1) !== 0,
  );
  const write = gpu.writes.filter((entry) => entry.buffer === cameraBuffer?.resource).at(-1);
  if (write === undefined) throw new Error("camera uniform was not written");
  return new Float32Array(write.bytes.buffer, write.bytes.byteOffset, write.bytes.byteLength / 4);
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

class KeyboardTarget {
  private listener: ((event: Event) => void) | undefined;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "keydown") this.listener = listener as (event: Event) => void;
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "keydown" && this.listener === listener) this.listener = undefined;
  }

  dispatchEvent(_event: Event): boolean {
    return false;
  }

  dispatch(event: Event): void {
    this.listener?.(event);
  }
}

function installTwoPhaseNavigator(first: GPUDevice, candidate: GPUDevice): () => void {
  const candidateRequest = deferred<GPUDevice>();
  let requestCount = 0;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      gpu: {
        getPreferredCanvasFormat: () => "bgra8unorm",
        requestAdapter: () => {
          requestCount += 1;
          return Promise.resolve({
            requestDevice: () =>
              requestCount === 1 ? Promise.resolve(first) : candidateRequest.promise,
          });
        },
      },
    },
  });
  return () => {
    candidateRequest.resolve(candidate);
  };
}

function scene(offset = 0) {
  const geometry = {
    positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
  };
  return createScene()
    .addPart(createPart(1, geometry))
    .addAssembly({
      id: 1,
      name: "root",
      placements: [{ kind: "part", partId: 1, transform: translation(offset, 0, 0) }],
    })
    .withRoot(1)
    .build();
}

function invalidScene(): Scene {
  const current = scene();
  const root = current.assemblies.get(1);
  if (root === undefined) throw new Error("test root assembly is missing");
  return {
    ...current,
    assemblies: new Map([
      [1, { ...root, placements: [{ kind: "part", partId: 1, transform: new Float32Array(15) }] }],
    ]),
  };
}

describe("FemViewport", () => {
  it("does not resynchronize unchanged interaction state during camera-only frames", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const updateInstances = vi.spyOn(RendererAttachment.prototype, "updateInstances");
    const updateElements = vi.spyOn(RendererAttachment.prototype, "updateElements");
    const viewport = await createFemViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
    });

    expect(updateInstances).not.toHaveBeenCalled();
    expect(updateElements).toHaveBeenCalledOnce();
    viewport.render();
    viewport.setInteraction(viewport.interaction);
    expect(updateInstances).not.toHaveBeenCalled();
    expect(updateElements).toHaveBeenCalledOnce();

    viewport.setInteraction(setPartOverride(viewport.interaction, 1, { emissive: 0.25 }));
    expect(updateInstances).toHaveBeenCalledOnce();
    expect(updateElements).toHaveBeenCalledTimes(2);
    viewport.destroy();
  });

  it("validates and updates independent point and node diameters", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const onRender = vi.fn();
    const viewport = await createFemViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: gpu.device,
      pointSizePixels: 12.5,
      nodeSizePixels: 3.25,
      onRender,
    });

    expect(latestCameraUniform(gpu).slice(18, 22)).toEqual(new Float32Array([12.5, 3.25, 1, 0]));
    expect(() => {
      viewport.setPointSizePixels(0);
    }).toThrow(/pointSizePixels/);
    expect(() => {
      viewport.setNodeSizePixels(Number.POSITIVE_INFINITY);
    }).toThrow(/nodeSizePixels/);
    expect(onRender).toHaveBeenCalledOnce();

    viewport.setPointSizePixels(16);
    expect(onRender).toHaveBeenCalledTimes(2);
    viewport.setPointSizePixels(16);
    expect(onRender).toHaveBeenCalledTimes(2);
    viewport.setNodeSizePixels(12);
    expect(onRender).toHaveBeenCalledTimes(3);
    viewport.batch(() => {
      viewport.setPointSizePixels(20);
      viewport.setNodeSizePixels(24);
    });
    expect(onRender).toHaveBeenCalledTimes(4);
    expect(latestCameraUniform(gpu).slice(18, 22)).toEqual(new Float32Array([20, 24, 1, 0]));
    viewport.resize();
    viewport.setScene(scene(10));
    viewport.render();
    expect(latestCameraUniform(gpu).slice(18, 22)).toEqual(new Float32Array([20, 24, 1, 0]));
    viewport.destroy();

    await expect(
      createFemViewport({ canvas: fakeCanvas(), scene: scene(), pointSizePixels: 65 }),
    ).rejects.toThrow(/pointSizePixels/);
  });

  it("validates and switches the renderer-owned background without rebuilding the viewport", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const onRender = vi.fn();
    const viewport = await createFemViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      background: "white",
      device: gpu.device,
      onRender,
    });
    expect(onRender).toHaveBeenCalledOnce();
    const pipelineCount = gpu.renderPipelineDescriptors.length;
    viewport.setBackground("dark");
    expect(onRender).toHaveBeenCalledTimes(2);
    expect(gpu.renderPipelineDescriptors).toHaveLength(pipelineCount);
    viewport.setBackground("dark");
    expect(onRender).toHaveBeenCalledTimes(2);
    expect(() => {
      viewport.setBackground("invalid" as never);
    }).toThrow("Invalid viewport background");
    expect(onRender).toHaveBeenCalledTimes(2);
    viewport.destroy();

    await expect(
      createFemViewport({ canvas: fakeCanvas(), scene: scene(), background: "invalid" as never }),
    ).rejects.toThrow("Invalid viewport background");
    await expect(
      createFemViewport({ canvas: fakeCanvas(), scene: scene(), originTriad: "invalid" as never }),
    ).rejects.toThrow("Invalid originTriad");
  });

  it("rejects an orientation gizmo container that does not contain the canvas before setup", async () => {
    const canvas = fakeCanvas();
    const contains = vi.fn(() => false);
    const container = { contains } as unknown as HTMLElement;

    await expect(
      createFemViewport({
        canvas,
        scene: scene(),
        orientationGizmo: { container },
      }),
    ).rejects.toThrow("orientationGizmo.container must contain the canvas");
    expect(contains).toHaveBeenCalledWith(canvas);
  });

  it("owns fitted camera, runtime, interaction, visibility, resize, and teardown", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const canvas = fakeCanvas(640, 360);
    const onRender = vi.fn();
    const viewport = await createFemViewport({
      canvas,
      scene: scene(),
      device: gpu.device,
      onRender,
    });

    expect(viewport.runtime.instanceCount).toBe(1);
    expect(viewport.camera.width).toBe(640);
    expect(viewport.stats()).toEqual({ visibleInstances: 1, drawBatches: 1 });
    expect(onRender).toHaveBeenCalledOnce();

    const interaction = setPartOverride(viewport.interaction, 1, {
      color: { r: 1, g: 0, b: 0, a: 1 },
    });
    viewport.setInteraction(interaction);
    viewport.setEdgeDepthTest(false);
    viewport.render();
    expect(viewport.interaction).toBe(interaction);

    viewport.setPartVisible(1, false);
    expect(viewport.stats().visibleInstances).toBe(0);
    viewport.setPartVisible(1, true);
    viewport.setInstanceVisible("1/0", false);
    expect(viewport.stats().visibleInstances).toBe(0);

    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 320 });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 200 });
    viewport.resize();
    expect(viewport.camera.width).toBe(320);
    expect(viewport.camera.height).toBe(200);
    const manuallyFramed = { ...viewport.camera, orthoHeight: viewport.camera.orthoHeight * 0.5 };
    viewport.setCamera(manuallyFramed);
    Object.defineProperty(canvas, "clientWidth", { configurable: true, value: 640 });
    Object.defineProperty(canvas, "clientHeight", { configurable: true, value: 360 });
    viewport.resize();
    expect(viewport.camera.orthoHeight).toBe(manuallyFramed.orthoHeight);

    viewport.setScene(scene(10));
    viewport.render();
    expect(viewport.camera.target[0]).toBeCloseTo(10);
    viewport.setCamera({ ...viewport.camera, position: [20, 20, 20] });
    expect(viewport.camera.position).toEqual([20, 20, 20]);

    viewport.destroy();
    expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    expect(() => {
      viewport.render();
    }).toThrow("destroyed");
  });

  it("rejects every visibility mutation after destruction without changing state", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const viewport = await createFemViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: gpu.device,
    });
    const visibilitySetters: readonly ((current: FemViewport) => void)[] = [
      (current) => {
        current.setPartVisible(1, false);
      },
      (current) => {
        current.setAssemblyNodeVisible("1", false);
      },
      (current) => {
        current.setAssemblyVisible(1, false);
      },
      (current) => {
        current.setInstanceVisible("1/0", false);
      },
    ];
    const before = {
      drawList: viewport.runtime.getDrawList(),
      instances: viewport.runtime.getInstances(),
      nodes: viewport.runtime.getNodes(),
      submissions: gpu.submissionCount,
      writes: gpu.writes.length,
    };

    viewport.destroy();

    for (const setVisible of visibilitySetters) {
      expect(() => {
        setVisible(viewport);
      }).toThrow("FemViewport has been destroyed");
    }
    expect(viewport.runtime.getDrawList()).toEqual(before.drawList);
    expect(viewport.runtime.getInstances()).toEqual(before.instances);
    expect(viewport.runtime.getNodes()).toEqual(before.nodes);
    expect(gpu.submissionCount).toBe(before.submissions);
    expect(gpu.writes).toHaveLength(before.writes);
    expect(() => {
      viewport.destroy();
    }).not.toThrow();
  });

  it("includes instance transforms when fitting the scene", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const viewport = await createFemViewport({
      canvas: fakeCanvas(),
      scene: scene(25),
      device: fakeGpuDevice().device,
    });

    expect(viewport.camera.target[0]).toBeCloseTo(25);
    expect(viewport.runtime.getTransform("1/0")?.[12]).toBe(25);
    viewport.destroy();
  });

  it("rejects an invalid camera without replacing the current camera", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const onRender = vi.fn();
    const viewport = await createFemViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
      onRender,
    });
    const previous = viewport.camera;
    expect(() => {
      viewport.setCamera({ ...previous, near: 0 });
    }).toThrow(/near\/far/);
    expect(viewport.camera).toBe(previous);
    expect(onRender).toHaveBeenCalledOnce();
    viewport.destroy();
  });

  it("rejects an invalid scene replacement transactionally", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const viewport = await createFemViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: gpu.device,
    });
    const interaction = setPartOverride(viewport.interaction, 1, { emissive: 0.4 });
    viewport.setInteraction(interaction);
    const previous = {
      camera: viewport.camera,
      interaction: viewport.interaction,
      runtime: viewport.runtime,
      scene: viewport.scene,
      submissions: gpu.submissionCount,
      writes: gpu.writes.length,
    };

    expect(() => {
      viewport.setScene(invalidScene());
    }).toThrow(/transform must contain exactly 16 components/);
    expect(viewport.camera).toBe(previous.camera);
    expect(viewport.interaction).toBe(previous.interaction);
    expect(viewport.runtime).toBe(previous.runtime);
    expect(viewport.scene).toBe(previous.scene);
    expect(gpu.submissionCount).toBe(previous.submissions);
    expect(gpu.writes).toHaveLength(previous.writes);

    expect(() => {
      viewport.render();
    }).not.toThrow();
    viewport.destroy();
  });

  it("owns fit selection, validates transition durations, and scopes Z to the host target", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const keyboard = new KeyboardTarget();
    const viewport = await createFemViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
      keyboardTarget: keyboard,
    });
    const previous = viewport.camera;
    const invalid = { durationMs: Number.NaN };
    expect(() => {
      viewport.fitSelection(invalid);
    }).toThrow(/durationMs/);
    expect(() => {
      viewport.setCamera(previous, invalid);
    }).toThrow(/durationMs/);

    const preventDefault = vi.fn();
    keyboard.dispatch({
      key: "Z",
      repeat: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      target: null,
      preventDefault,
    } as unknown as Event);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(viewport.camera.target).toEqual(previous.target);

    viewport.destroy();
    keyboard.dispatch({ key: "z", preventDefault: vi.fn() } as unknown as Event);
  });

  it("leaves the camera unchanged when selected geometry is hidden or stale", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const viewport = await createFemViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
    });
    viewport.setInstanceVisible("1/0", false);
    viewport.setInteraction(
      setTargetSelected(viewport.interaction, { kind: "instance", instanceId: "1/0" }, true),
    );
    const before = viewport.camera;

    viewport.fitSelection({ durationMs: 0 });

    expect(viewport.camera).toBe(before);
    viewport.destroy();
  });

  it("coalesces body and visibility mutations inside one batch", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const onRender = vi.fn();
    const viewport = await createFemViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
      onRender,
    });
    expect(onRender).toHaveBeenCalledOnce();

    const finalInteraction = viewport.batch(() => {
      let interaction = setBodyVisible(
        viewport.interaction,
        { instanceId: "1/0", bodyId: 0 },
        false,
      );
      viewport.setInteraction(interaction);
      interaction = setBodyOverride(
        interaction,
        { instanceId: "1/0", bodyId: 0 },
        { emissive: 0.5 },
      );
      viewport.setInteraction(interaction);
      viewport.setPartVisible(1, false);
      viewport.setPartVisible(1, true);
      expect(onRender).toHaveBeenCalledOnce();
      return interaction;
    });

    expect(finalInteraction).toBe(viewport.interaction);
    expect(viewport.runtime.visibleCount).toBe(1);
    expect(onRender).toHaveBeenCalledTimes(2);
    viewport.destroy();
  });

  it("keeps runtime visibility isolated between viewports", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const first = await createFemViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
    });
    const second = await createFemViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
    });

    first.setPartVisible(1, false);
    expect(first.runtime.visibleCount).toBe(0);
    expect(second.runtime.visibleCount).toBe(1);
    expect(second.runtime.isInstanceVisible("1/0")).toBe(true);

    first.destroy();
    second.destroy();
  });

  it("owns unrecoverable device-loss cleanup and error reporting", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const onError = vi.fn();
    await createFemViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: gpu.device,
      onError,
    });

    gpu.lose("destroyed", "test loss");

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledOnce();
    });
    expect(gpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });

  it("suppresses recovery callbacks after viewport destruction", async () => {
    restoreGpuGlobals = installGpuGlobals();
    const first = fakeGpuDevice();
    const shaderInfo = deferred<GPUCompilationInfo>();
    const candidate = fakeGpuDevice({ shaderCompilationInfo: () => shaderInfo.promise });
    const resolveCandidate = installTwoPhaseNavigator(first.device, candidate.device);
    const onRecovered = vi.fn();
    const onError = vi.fn();
    const viewport = await createFemViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      onRecovered,
      onError,
    });

    first.lose("unknown", "test loss");
    await first.lost;
    resolveCandidate();
    await vi.waitFor(() => {
      expect(candidate.shaderModuleDescriptors.length).toBeGreaterThan(0);
    });
    viewport.destroy();
    shaderInfo.resolve({ messages: [] } as unknown as GPUCompilationInfo);

    await vi.waitFor(() => {
      expect(candidate.buffers.length).toBeGreaterThan(0);
    });
    expect(onRecovered).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(candidate.buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });

  it("coalesces concurrent viewport recovery callbacks", async () => {
    restoreGpuGlobals = installGpuGlobals();
    installNavigator();
    const onRecovered = vi.fn();
    const viewport = await createFemViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
      onRecovered,
    });

    const firstRecovery = viewport.recover();
    const secondRecovery = viewport.recover();
    expect(secondRecovery).toBe(firstRecovery);
    await firstRecovery;
    await secondRecovery;
    expect(onRecovered).toHaveBeenCalledOnce();
    viewport.destroy();
  });
});
