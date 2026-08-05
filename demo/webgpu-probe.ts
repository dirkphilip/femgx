import {
  createCamera,
  createSceneRuntime,
  createWebGpuRenderer,
  resizeCamera,
  type DeviceLostInfo,
  type Vec3,
  type WebGpuRenderer,
} from "../src/index";
import type { ModelPreset } from "../src/fixture/presets";

/** Options for creating the demo's WebGPU renderer. */
export interface RendererOptions {
  /** Called with a typed reason when the GPU device is lost. */
  readonly onDeviceLost?: (info: DeviceLostInfo) => void;
}

/**
 * Creates a WebGPU renderer, or `undefined` when WebGPU is unusable. The
 * optional `onDeviceLost` callback is wired to the committed renderer so the
 * demo can recover from device loss or fall back.
 */
export type RendererFactory = (options?: RendererOptions) => Promise<WebGpuRenderer | undefined>;

/**
 * Probes WebGPU on a hidden canvas. The returned factory only commits to the
 * real view canvas when presentation, rasterization, and pick readback work;
 * otherwise it returns `undefined` so the demo falls back to the CPU renderer.
 */
export function createWebGpuProbe(preset: ModelPreset, canvas: HTMLCanvasElement): RendererFactory {
  const bounds = preset.bounds;
  const probeTarget: Vec3 = [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ];
  return async (options) => {
    let probe: WebGpuRenderer | undefined;
    let probeCanvas: HTMLCanvasElement | undefined;
    try {
      probeCanvas = document.createElement("canvas");
      probeCanvas.width = 800;
      probeCanvas.height = 600;
      probeCanvas.style.position = "fixed";
      probeCanvas.style.top = "0";
      probeCanvas.style.left = "0";
      probeCanvas.style.width = "800px";
      probeCanvas.style.height = "600px";
      probeCanvas.style.opacity = "0.01";
      probeCanvas.style.pointerEvents = "none";
      probeCanvas.style.zIndex = "-1";
      document.body.appendChild(probeCanvas);
      probe = await createWebGpuRenderer({ canvas: probeCanvas });
      const probeCamera = resizeCamera(
        createCamera({
          target: probeTarget,
          position: [probeTarget[0], probeTarget[1] + 3, probeTarget[2] + 5],
        }),
        probeCanvas.width,
        probeCanvas.height,
      );
      const runtime = createSceneRuntime(preset.scene);
      probe.render(runtime, probeCamera, preset.scene.parts);
      const width = probeCanvas.clientWidth;
      const height = probeCanvas.clientHeight;
      let verified = false;
      for (const [dx, dy] of [
        [0, 0],
        [-0.15, -0.15],
        [0.15, -0.15],
        [-0.15, 0.15],
        [0.15, 0.15],
      ]) {
        const dxF = dx ?? 0;
        const dyF = dy ?? 0;
        const target = await probe.pick(width / 2 + dxF * width, height / 2 + dyF * height);
        if (target?.kind === "instance" || target?.kind === "element") {
          verified = true;
          break;
        }
      }
      probe.destroy();
      probe = undefined;
      probeCanvas.remove();
      probeCanvas = undefined;
      if (!verified) return undefined;
      const committed =
        options?.onDeviceLost === undefined
          ? { canvas }
          : { canvas, onDeviceLost: options.onDeviceLost };
      return await createWebGpuRenderer(committed);
    } catch {
      probe?.destroy();
      probeCanvas?.remove();
      return undefined;
    }
  };
}
