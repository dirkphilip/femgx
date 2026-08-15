import type { Camera } from "../../camera/camera";
import type { Vec3 } from "../../math/vec3";
import { pickWorldPosition, readPickPixel, type PickTargets } from "./gpu-pick";

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
  return pickWorldPosition(canvas, camera, x, y, hit.ndcDepth);
}
