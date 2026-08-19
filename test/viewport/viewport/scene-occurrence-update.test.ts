import { describe, expect, it, vi } from "vitest";
import {
  createPart,
  createViewport,
  explicitScene,
  fakeCanvas,
  fakeGpuDevice,
  installNavigator,
  installTestGpuGlobals,
  identityScene,
  RendererAttachment,
  setPartOverride,
  translation,
} from "./support";

describe("Viewport incremental part occurrences", () => {
  it("updates retained runtime and GPU attachment slots without clearing scene storage", async () => {
    installTestGpuGlobals();
    installNavigator();
    const geometry = {
      positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles" as const,
    };
    const first = createPart(1, { geometries: [geometry] });
    const second = createPart(2, { geometries: [geometry] });
    const scene = explicitScene(
      [first, second],
      [
        { kind: "part", placementId: "remove", partId: 1, transform: translation(0, 0, 0) },
        { kind: "part", placementId: "keep", partId: 1, transform: translation(1, 0, 0) },
      ],
    );
    const updateOccurrences = vi.spyOn(RendererAttachment.prototype, "updateOccurrences");
    const clear = vi.spyOn(RendererAttachment.prototype, "clear");
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene,
      device: fakeGpuDevice().device,
    });
    viewport.render();
    updateOccurrences.mockClear();
    clear.mockClear();

    viewport.updateScene((update) => {
      update.removePartOccurrence({ assemblyId: 1, placementId: "remove" });
      update.rebindPartOccurrence({ assemblyId: 1, placementId: "keep", partId: 2 });
      update.addPartOccurrence({
        assemblyId: 1,
        placementId: "added",
        partId: 2,
        transform: translation(2, 0, 0),
      });
    });
    viewport.render();

    expect(viewport.runtime.partOccurrenceCount).toBe(2);
    expect(viewport.runtime.getPartId("1/keep")).toBe(2);
    expect(viewport.runtime.getPartId("1/added")).toBe(2);
    expect(viewport.runtime.getPartOccurrence("1/remove")).toBeUndefined();
    expect(updateOccurrences).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
    viewport.destroy();
  });

  it("retains optional edge, node, and transparency orders for changed occurrences", async () => {
    installTestGpuGlobals();
    installNavigator();
    const updateOccurrences = vi.spyOn(RendererAttachment.prototype, "updateOccurrences");
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: identityScene(false),
      device: fakeGpuDevice().device,
    });
    viewport.interaction.set(
      setPartOverride(viewport.interaction.state, 1, {
        edge: true,
        nodes: true,
        opacity: 0.5,
      }),
    );
    viewport.render();
    updateOccurrences.mockClear();

    viewport.updateScene((update) => {
      update.removePartOccurrence({ assemblyId: 1, placementId: "keep" });
      update.addPartOccurrence({
        assemblyId: 1,
        placementId: "added",
        partId: 1,
        transform: translation(0, 0, 0),
      });
    });

    const attachment = updateOccurrences.mock.instances[0] as RendererAttachment | undefined;
    expect(attachment?.edgeCalls).toEqual([{ partId: 1, instanceCount: 1 }]);
    expect(attachment?.nodeCalls).toEqual([{ partId: 1, instanceCount: 1 }]);
    expect(attachment?.transparentCalls).toEqual([{ partId: 1, instanceCount: 1 }]);
    viewport.destroy();
  });
});
