import {
  createCamera,
  createSceneRuntime,
  createWebGpuRenderer,
  resizeCamera,
  type Vec3,
  type WebGpuRenderer,
} from "../src/index";
import type { DemoFixture } from "./fixture";

/** Creates a WebGPU renderer, or `undefined` when WebGPU is unusable. */
export type RendererFactory = () => Promise<WebGpuRenderer | undefined>;

/**
 * Probes WebGPU on a hidden canvas. The returned factory only commits to the
 * real view canvas when presentation, rasterization, and pick readback work;
 * otherwise it returns `undefined` so the demo falls back to the CPU renderer.
 */
export function createWebGpuProbe(
  fixture: DemoFixture,
  canvas: HTMLCanvasElement,
): RendererFactory {
  const probeTarget: Vec3 = [
    (fixture.elementFixture.bounds.minX + fixture.elementFixture.bounds.maxX) / 2,
    (fixture.elementFixture.bounds.minY + fixture.elementFixture.bounds.maxY) / 2,
    (fixture.elementFixture.bounds.minZ + fixture.elementFixture.bounds.maxZ) / 2,
  ];
  return async () => {
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
      const runtime = createSceneRuntime(fixture.scene);
      probe.render(runtime, probeCamera, fixture.scene.parts);
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
      return await createWebGpuRenderer({ canvas });
    } catch {
      probe?.destroy();
      probeCanvas?.remove();
      return undefined;
    }
  };
}
