import { createCamera, resizeCamera, type Camera } from "../src/index";
import type { Bounds } from "../src/index";

/** Frames a camera to look at a model's world bounds. */
export function fitCamera(bounds: Bounds, width: number, height: number): Camera {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const size = Math.max(
    1,
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
  );
  const distance = size * 2.4;
  return resizeCamera(
    createCamera({
      target: [centerX, centerY, centerZ],
      position: [centerX + distance * 0.45, centerY + distance * 0.4, centerZ + distance],
    }),
    width,
    height,
  );
}
