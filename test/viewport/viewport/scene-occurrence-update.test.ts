import { describe, expect, it, vi } from "vitest";
import {
  createPart,
  createViewport,
  explicitScene,
  fakeCanvas,
  fakeGpuDevice,
  installNavigator,
  installTestGpuGlobals,
  isTargetSelected,
  identityScene,
  nodalResult,
  RendererAttachment,
  resultScene,
  setPartOverride,
  setTargetSelected,
  translation,
} from "./support";

describe("Viewport incremental part occurrences", () => {
  it("admits an unplaced definition without broad attachment preparation", async () => {
    installTestGpuGlobals();
    installNavigator();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: identityScene(false),
      device: fakeGpuDevice().device,
    });
    viewport.render();
    const runtime = viewport.runtime;
    const updateOccurrences = vi.spyOn(RendererAttachment.prototype, "updateOccurrences");
    const added = createPart(2, {
      geometries: [
        {
          positions: new Float32Array([0, 0, 0]),
          indices: new Uint32Array([0]),
          primitive: "points",
        },
      ],
    });

    viewport.updateScene((update) => {
      update.addPart(added);
    });

    expect(viewport.runtime).toBe(runtime);
    expect(viewport.scene.parts.get(2)).toBe(added);
    expect(updateOccurrences).not.toHaveBeenCalled();
    viewport.destroy();
  });

  it("admits a new definition and its first occurrence without broad attachment preparation", async () => {
    installTestGpuGlobals();
    installNavigator();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: identityScene(false),
      device: fakeGpuDevice().device,
    });
    viewport.render();
    const runtime = viewport.runtime;
    const prepareParts = vi.spyOn(RendererAttachment.prototype, "prepareParts");
    const updateOccurrences = vi.spyOn(RendererAttachment.prototype, "updateOccurrences");
    const added = createPart(2, {
      geometries: [
        {
          positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
          indices: new Uint32Array([0, 1, 2]),
          primitive: "triangles",
        },
      ],
    });

    viewport.updateScene((update) => {
      update.addPart(added);
      update.addPartOccurrence({
        assemblyId: 1,
        placementId: "new-part",
        partId: 2,
        transform: translation(5, 0, 0),
      });
    });
    viewport.render();

    expect(viewport.runtime).toBe(runtime);
    expect(viewport.scene.parts.get(2)).toBe(added);
    expect(viewport.runtime.getPartId("1/new-part")).toBe(2);
    expect(updateOccurrences).toHaveBeenCalledTimes(1);
    expect(prepareParts).not.toHaveBeenCalled();
    viewport.destroy();
  });

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

  it("preserves results explicitly owned by a retained part", async () => {
    installTestGpuGlobals();
    installNavigator();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: resultScene(3),
      results: { scalar: { ...nodalResult(3).scalar, partId: 1 } },
      device: fakeGpuDevice().device,
    });
    const added = createPart(2, {
      geometries: [
        {
          positions: new Float32Array([0, 0, 0]),
          indices: new Uint32Array([0]),
          primitive: "points",
        },
      ],
    });

    const outcome = viewport.updateScene((update) => {
      update.addPart(added);
      update.addPartOccurrence({
        assemblyId: 1,
        placementId: "uncolored",
        partId: 2,
        transform: translation(4, 0, 0),
      });
    });

    expect(outcome.results).toBe("preserved");
    expect(viewport.results.state?.config.scalar?.partId).toBe(1);
    viewport.destroy();
  });

  it("removes a part and all occurrences without replacing unrelated runtime or GPU state", async () => {
    installTestGpuGlobals();
    installNavigator();
    const geometry = {
      positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles" as const,
    };
    const removedPart = createPart(1, { geometries: [geometry] });
    const retainedPart = createPart(2, { geometries: [geometry] });
    const scene = explicitScene(
      [removedPart, retainedPart],
      [
        { kind: "part", placementId: "removed", partId: 1, transform: translation(0, 0, 0) },
        { kind: "part", placementId: "retained", partId: 2, transform: translation(1, 0, 0) },
      ],
    );
    const gpu = fakeGpuDevice();
    const updateOccurrences = vi.spyOn(RendererAttachment.prototype, "updateOccurrences");
    const clear = vi.spyOn(RendererAttachment.prototype, "clear");
    const viewport = await createViewport({ canvas: fakeCanvas(), scene, device: gpu.device });
    viewport.render();
    const runtime = viewport.runtime;
    let interaction = setTargetSelected(
      viewport.interaction.state,
      { kind: "part", partId: 1 },
      true,
    );
    interaction = setTargetSelected(interaction, { kind: "part", partId: 2 }, true);
    viewport.interaction.set(interaction);
    updateOccurrences.mockClear();
    clear.mockClear();

    viewport.updateScene((update) => {
      update.removePart(1, { occurrences: "remove" });
    });

    const attachment = updateOccurrences.mock.instances[0] as RendererAttachment | undefined;
    expect(viewport.runtime).toBe(runtime);
    expect(viewport.scene.parts.has(1)).toBe(false);
    expect(viewport.runtime.getPartOccurrence("1/removed")).toBeUndefined();
    expect(viewport.runtime.getPartId("1/retained")).toBe(2);
    expect(isTargetSelected(viewport.interaction.state, { kind: "part", partId: 1 })).toBe(false);
    expect(isTargetSelected(viewport.interaction.state, { kind: "part", partId: 2 })).toBe(true);
    expect(attachment?.layout?.partOrder).toEqual([2]);
    expect(attachment?.calls).toEqual([{ partId: 2, instanceCount: 1 }]);
    expect(updateOccurrences).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
    expect(gpu.buffers.some((buffer) => buffer.destroyed)).toBe(true);
    expect(gpu.buffers.some((buffer) => !buffer.destroyed)).toBe(true);
    viewport.destroy();
  });

  it("clears result roles owned by a removed part on the incremental path", async () => {
    installTestGpuGlobals();
    installNavigator();
    const part = resultScene(3).parts.get(1);
    if (part === undefined) throw new Error("result part missing");
    const scene = explicitScene(
      [part],
      [
        {
          kind: "part",
          placementId: "result",
          partId: 1,
          transform: translation(0, 0, 0),
        },
      ],
    );
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene,
      results: { scalar: { ...nodalResult(3).scalar, partId: 1 } },
      device: fakeGpuDevice().device,
    });

    const outcome = viewport.updateScene((update) => {
      update.removePart(1, { occurrences: "remove" });
    });

    expect(outcome.results).toBe("cleared");
    expect(viewport.results.state).toBeUndefined();
    viewport.destroy();
  });
});
