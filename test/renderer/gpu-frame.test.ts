import { afterEach, describe, expect, it } from "vitest";
import { pointSizeDevicePixels } from "../../src/renderer/gpu-frame";

const originalDevicePixelRatio = globalThis.devicePixelRatio;

afterEach(() => {
  Object.defineProperty(globalThis, "devicePixelRatio", {
    configurable: true,
    value: originalDevicePixelRatio,
  });
});

describe("pointSizeDevicePixels", () => {
  it("scales CSS point size by devicePixelRatio", () => {
    Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 2 });
    expect(pointSizeDevicePixels(8)).toBe(16);
    expect(pointSizeDevicePixels(8, 1)).toBe(8);
    expect(pointSizeDevicePixels(8, 3)).toBe(24);
  });

  it("never returns less than one device pixel", () => {
    expect(pointSizeDevicePixels(0.1, 1)).toBe(1);
  });
});
