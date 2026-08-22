import { describe, expect, it, vi } from "vitest";
import { ViewportLifecycleController } from "@/viewport/core/lifecycle-controller";
import {
  createViewport,
  fakeCanvas,
  fakeGpuDevice,
  installNavigator,
  installTestGpuGlobals,
  scene,
} from "./support";

describe("Viewport lifecycle invariants", () => {
  it("checks liveness once before root operations that invalidate", async () => {
    installTestGpuGlobals();
    installNavigator();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
    });
    const ensureAlive = vi.spyOn(ViewportLifecycleController.prototype, "ensureAlive");
    const before = ensureAlive.mock.calls.length;

    viewport.view.fit({ durationMs: 0 });
    expect(ensureAlive).toHaveBeenCalledTimes(before + 1);
    viewport.replaceScene(scene(10));
    expect(ensureAlive).toHaveBeenCalledTimes(before + 2);
    viewport.resize();
    expect(ensureAlive).toHaveBeenCalledTimes(before + 3);

    ensureAlive.mockRestore();
    viewport.destroy();
  });
});
