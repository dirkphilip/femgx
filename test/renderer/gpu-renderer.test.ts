import { afterEach, describe, expect, it } from "vitest";
import { createWebGpuRenderer } from "../../src/renderer/gpu-renderer";
import { computeBounds } from "../../src/geometry/part";
import { createScene } from "../../src/scene/scene";
import { translation } from "../../src/math/mat4";
import type { Camera } from "../../src/camera/camera";

const originalNavigator = globalThis.navigator;
const originalDevicePixelRatio = globalThis.devicePixelRatio;

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, "devicePixelRatio", {
    configurable: true,
    value: originalDevicePixelRatio,
  });
});

describe("WebGPU renderer", () => {
  it("reports unavailable WebGPU clearly", async () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    await expect(createWebGpuRenderer({ canvas: fakeCanvas() })).rejects.toThrow(
      "WebGPU is unavailable",
    );
  });

  it("renders, uploads, picks, resizes, and destroys with a mocked device", async () => {
    const device = fakeDevice();
    let adapterCalls = 0;
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        gpu: {
          getPreferredCanvasFormat: () => "bgra8unorm",
          requestAdapter: () => {
            adapterCalls += 1;
            return Promise.resolve({ requestDevice: () => Promise.resolve(device) });
          },
        },
      },
    });
    Object.defineProperty(globalThis, "GPUShaderStage", {
      configurable: true,
      value: { VERTEX: 1 },
    });
    Object.defineProperty(globalThis, "GPUBufferUsage", {
      configurable: true,
      value: { UNIFORM: 1, COPY_DST: 2, VERTEX: 4, INDEX: 8, STORAGE: 16, MAP_READ: 32 },
    });
    Object.defineProperty(globalThis, "GPUTextureUsage", {
      configurable: true,
      value: { RENDER_ATTACHMENT: 1, COPY_SRC: 2 },
    });
    Object.defineProperty(globalThis, "GPUMapMode", { configurable: true, value: { READ: 1 } });
    Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 1 });

    const renderer = await createWebGpuRenderer({ canvas: fakeCanvas() });
    expect(adapterCalls).toBe(1);
    const scene = createScene()
      .addPart({
        id: 1,
        geometry: {
          positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
          indices: new Uint32Array([0, 1, 2]),
        },
        bounds: computeBounds({
          positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
          indices: new Uint32Array([0, 1, 2]),
        }),
      })
      .addAssembly({
        id: 1,
        name: "root",
        placements: [{ kind: "part", partId: 1, transform: translation(0, 0, 0) }],
      })
      .withRoot(1)
      .build();
    const camera: Camera = {
      mode: "perspective",
      position: [3, 3, 5],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fovY: Math.PI / 3,
      near: 0.01,
      far: 100,
      orthoHeight: 6,
      width: 800,
      height: 600,
    };
    await expect(renderer.pick(1, 1)).resolves.toBeUndefined();
    renderer.render(scene, camera);
    renderer.render(scene, camera);
    await expect(renderer.pick(400, 300)).resolves.toEqual({ kind: "instance", instanceId: "1/0" });
    renderer.resize(400, 300);
    renderer.destroy();
    renderer.destroy();
    expect(() => {
      renderer.render(scene, camera);
    }).toThrow("destroyed");
  });
});

function fakeCanvas(): HTMLCanvasElement {
  const context = {
    configure: () => undefined,
    getCurrentTexture: () => ({ createView: () => ({}) }),
  };
  return {
    width: 800,
    height: 600,
    clientWidth: 800,
    clientHeight: 600,
    getContext: () => context,
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
  } as unknown as HTMLCanvasElement;
}

function fakeDevice(): GPUDevice {
  const pass = {
    setPipeline: () => undefined,
    setBindGroup: () => undefined,
    setVertexBuffer: () => undefined,
    setIndexBuffer: () => undefined,
    drawIndexed: () => undefined,
    end: () => undefined,
  };
  const resource = () => ({ createView: () => ({}), destroy: () => undefined });
  const buffer = {
    destroy: () => undefined,
    mapAsync: () => Promise.resolve(),
    getMappedRange: () => new Uint32Array([1]).buffer,
    unmap: () => undefined,
  };
  return {
    queue: { writeBuffer: () => undefined, submit: () => undefined },
    createBindGroupLayout: () => ({}),
    createBuffer: () => buffer,
    createBindGroup: () => ({}),
    createPipelineLayout: () => ({}),
    createShaderModule: () => ({}),
    createRenderPipeline: () => ({}),
    createTexture: () => resource(),
    createCommandEncoder: () => ({
      beginRenderPass: () => pass,
      finish: () => ({}),
      copyTextureToBuffer: () => undefined,
    }),
  } as unknown as GPUDevice;
}
