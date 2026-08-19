import { describe, expect, it, vi } from "vitest";
import {
  createViewport,
  fakeCanvas,
  fakeGpuDevice,
  identityScene,
  installNavigator,
  installTestGpuGlobals,
  RendererAttachment,
  translation,
} from "./support";

describe("Viewport incremental scene transforms", () => {
  it("patches the retained renderer attachment without rebuilding scene storage", async () => {
    installTestGpuGlobals();
    installNavigator();
    const updateInstances = vi.spyOn(RendererAttachment.prototype, "updateInstances");
    const clear = vi.spyOn(RendererAttachment.prototype, "clear");
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: identityScene(false),
      device: fakeGpuDevice().device,
    });
    viewport.render();
    updateInstances.mockClear();

    const outcome = viewport.updateScene((update) => {
      update.setPartOccurrenceTransform({
        assemblyId: 1,
        placementId: "keep",
        transform: translation(7, 0, 0),
      });
    });

    expect(outcome).toEqual({ results: "none" });
    expect(viewport.runtime.getTransform("1/keep")?.[12]).toBe(7);
    expect(updateInstances).toHaveBeenCalledTimes(1);
    expect(updateInstances.mock.calls[0]?.[2]).toEqual([0]);
    expect(clear).not.toHaveBeenCalled();
    viewport.destroy();
  });
});
