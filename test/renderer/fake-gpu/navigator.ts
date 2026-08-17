import { fakeGpuDevice } from "./device";
import type { FakeGpu } from "./types";

/**
 * Installs a navigator whose adapter requests each yield a fake device,
 * returning the created devices in request order so tests can drive loss and
 * recovery against the whole device sequence. `seed` is a device that already
 * exists (used by the initial bundle) and is recorded but never served, so
 * recovery requests always yield a fresh device.
 */
export function installFreshDeviceNavigator(seed?: FakeGpu): readonly FakeGpu[] {
  const gpus: FakeGpu[] = seed === undefined ? [] : [seed];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      gpu: {
        getPreferredCanvasFormat: () => "bgra8unorm",
        requestAdapter: () => {
          const gpu = fakeGpuDevice();
          gpus.push(gpu);
          return Promise.resolve({ requestDevice: () => Promise.resolve(gpu.device) });
        },
      },
    },
  });
  return gpus;
}
