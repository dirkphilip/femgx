import { unprojectPoint, type Camera } from "../camera/camera";
import type { Vec3 } from "../math/vec3";
import { pickPixelCoordinates, readPickPixel, type PickTargets } from "./gpu-pick";

/** Reads and unprojects the exact nearest displayed fragment under a CSS point. */
export async function displayedPointFromPixel(options: {
  readonly device: GPUDevice;
  readonly canvas: HTMLCanvasElement;
  readonly pick: PickTargets;
  readonly camera: Camera;
  readonly x: number;
  readonly y: number;
}): Promise<Vec3 | undefined> {
  const { device, canvas, pick, camera, x, y } = options;
  const hit = await readPickPixel(device, canvas, pick, x, y);
  if (hit.instancePickId === 0 || !Number.isFinite(hit.ndcDepth) || hit.ndcDepth >= 1) {
    return undefined;
  }
  const pixel = pickPixelCoordinates(
    x,
    y,
    canvas.getBoundingClientRect(),
    canvas.width,
    canvas.height,
  );
  return unprojectPoint(camera, [
    ((pixel.x + 0.5) / canvas.width) * camera.width,
    ((pixel.y + 0.5) / canvas.height) * camera.height,
    hit.ndcDepth,
  ]);
}
