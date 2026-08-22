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
  GpuRenderer,
  RendererAttachment,
  resultScene,
  setPartOverride,
  setTargetSelected,
  translationMatrix,
} from "./support";

describe("Viewport incremental part occurrences", () => {
  it("rolls back runtime and renderer state when prepared placement resources fail", async () => {
    installTestGpuGlobals();
    installNavigator();
    let fail = false;
    const gpu = fakeGpuDevice({
      onCreateBuffer: (_creation, descriptor) => {
        if (fail && descriptor.label === "femgx instance order") {
          throw new Error("injected occurrence order allocation failure");
        }
      },
    });
    const scene = identityScene(false);
    const viewport = await createViewport({ canvas: fakeCanvas(), scene, device: gpu.device });
    viewport.visibility.setPartOccurrenceVisible("1/keep", false);
    viewport.render();
    const bufferStart = gpu.buffers.length;
    const writeStart = gpu.writes.length;
    const liveBuffers = new Set(gpu.buffers.map(({ resource }) => resource));
    fail = true;

    expect(() =>
      viewport.updateScene((update) => {
        update.addPlacement(1, {
          kind: "part",
          placementId: "failed",
          partId: 1,
          transform: translationMatrix(3, 0, 0),
        });
      }),
    ).toThrow("injected occurrence order allocation failure");

    expect(viewport.scene).toBe(scene);
    expect(viewport.occurrences.getPartOccurrence("1/failed")).toBeUndefined();
    expect(viewport.occurrences.isPartOccurrenceVisible("1/keep")).toBe(false);
    expect(gpu.buffers.slice(bufferStart).some(({ destroyed }) => destroyed)).toBe(true);
    expect(gpu.writes.slice(writeStart).some(({ buffer }) => liveBuffers.has(buffer))).toBe(false);
    fail = false;
    expect(() => {
      viewport.render();
    }).not.toThrow();
    viewport.destroy();
  });

  it("admits an unplaced definition without broad attachment preparation", async () => {
    installTestGpuGlobals();
    installNavigator();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: identityScene(false),
      device: fakeGpuDevice().device,
    });
    viewport.render();
    const occurrences = viewport.occurrences;
    const prepareOccurrenceUpdate = vi.spyOn(GpuRenderer.prototype, "prepareOccurrenceUpdate");
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

    expect(viewport.occurrences).toBe(occurrences);
    expect(viewport.scene.parts.get(2)).toBe(added);
    expect(prepareOccurrenceUpdate).toHaveBeenCalledTimes(1);
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
    const occurrences = viewport.occurrences;
    const prepareParts = vi.spyOn(RendererAttachment.prototype, "prepareParts");
    const prepareOccurrenceUpdate = vi.spyOn(GpuRenderer.prototype, "prepareOccurrenceUpdate");
    prepareOccurrenceUpdate.mockClear();
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
      update.addPlacement(1, {
        kind: "part",
        placementId: "new-part",
        partId: 2,
        transform: translationMatrix(5, 0, 0),
      });
    });
    viewport.render();

    expect(viewport.occurrences).toBe(occurrences);
    expect(viewport.scene.parts.get(2)).toBe(added);
    expect(viewport.occurrences.getPartId("1/new-part")).toBe(2);
    expect(prepareOccurrenceUpdate).toHaveBeenCalledTimes(1);
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
        { kind: "part", placementId: "remove", partId: 1, transform: translationMatrix(0, 0, 0) },
        { kind: "part", placementId: "keep", partId: 1, transform: translationMatrix(1, 0, 0) },
      ],
    );
    const prepareOccurrenceUpdate = vi.spyOn(GpuRenderer.prototype, "prepareOccurrenceUpdate");
    const clear = vi.spyOn(RendererAttachment.prototype, "clear");
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene,
      device: fakeGpuDevice().device,
    });
    viewport.render();
    prepareOccurrenceUpdate.mockClear();
    clear.mockClear();

    viewport.updateScene((update) => {
      update.removePlacement(1, "remove");
      update.replacePlacement(1, {
        kind: "part",
        placementId: "keep",
        partId: 2,
        transform: translationMatrix(1, 0, 0),
      });
      update.addPlacement(1, {
        kind: "part",
        placementId: "added",
        partId: 2,
        transform: translationMatrix(2, 0, 0),
      });
    });
    viewport.render();

    expect(viewport.occurrences.partOccurrenceCount).toBe(2);
    expect(viewport.occurrences.getPartId("1/keep")).toBe(2);
    expect(viewport.occurrences.getPartId("1/added")).toBe(2);
    expect(viewport.occurrences.getPartOccurrence("1/remove")).toBeUndefined();
    expect(prepareOccurrenceUpdate).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
    viewport.destroy();
  });

  it("retains optional edge, node, and transparency orders for changed occurrences", async () => {
    installTestGpuGlobals();
    installNavigator();
    const prepareOccurrenceUpdate = vi.spyOn(GpuRenderer.prototype, "prepareOccurrenceUpdate");
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: identityScene(false),
      device: fakeGpuDevice().device,
    });
    viewport.interaction.set(
      setPartOverride(viewport.interaction.state, 1, {
        opacity: 0.5,
      }),
    );
    viewport.presentation.setEdgesVisible(true);
    viewport.presentation.setNodesVisible(true);
    viewport.render();
    prepareOccurrenceUpdate.mockClear();

    viewport.updateScene((update) => {
      update.removePlacement(1, "keep");
      update.addPlacement(1, {
        kind: "part",
        placementId: "added",
        partId: 1,
        transform: translationMatrix(0, 0, 0),
      });
    });

    const renderer = prepareOccurrenceUpdate.mock.instances[0] as GpuRenderer | undefined;
    const attachment = renderer?.attachment;
    expect(attachment?.edgeCalls).toEqual([{ partId: 1, instanceCount: 1 }]);
    expect(attachment?.nodeCalls).toEqual([{ partId: 1, instanceCount: 1 }]);
    expect(attachment?.transparentCalls).toEqual([{ partId: 1, instanceCount: 1 }]);
    viewport.destroy();
  });

  it("preserves results explicitly owned by a retained part", async () => {
    installTestGpuGlobals();
    installNavigator();
    const implicit = resultScene(3);
    const root = implicit.assemblies.get(1);
    if (root === undefined) throw new Error("test root is missing");
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: {
        ...implicit,
        assemblies: new Map([
          [
            1,
            {
              ...root,
              placements: root.placements.map((placement) => ({
                ...placement,
                placementId: "retained",
              })),
            },
          ],
        ]),
      },
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
      update.addPlacement(1, {
        kind: "part",
        placementId: "uncolored",
        partId: 2,
        transform: translationMatrix(4, 0, 0),
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
        { kind: "part", placementId: "removed", partId: 1, transform: translationMatrix(0, 0, 0) },
        { kind: "part", placementId: "retained", partId: 2, transform: translationMatrix(1, 0, 0) },
      ],
    );
    const gpu = fakeGpuDevice();
    const prepareOccurrenceUpdate = vi.spyOn(GpuRenderer.prototype, "prepareOccurrenceUpdate");
    const clear = vi.spyOn(RendererAttachment.prototype, "clear");
    const viewport = await createViewport({ canvas: fakeCanvas(), scene, device: gpu.device });
    viewport.render();
    const occurrences = viewport.occurrences;
    let interaction = setTargetSelected(
      viewport.interaction.state,
      { kind: "part", partId: 1 },
      true,
    );
    interaction = setTargetSelected(interaction, { kind: "part", partId: 2 }, true);
    viewport.interaction.set(interaction);
    prepareOccurrenceUpdate.mockClear();
    clear.mockClear();

    viewport.updateScene((update) => {
      update.removePart(1, { placements: "remove" });
    });

    const renderer = prepareOccurrenceUpdate.mock.instances[0] as GpuRenderer | undefined;
    const attachment = renderer?.attachment;
    expect(viewport.occurrences).toBe(occurrences);
    expect(viewport.scene.parts.has(1)).toBe(false);
    expect(viewport.occurrences.getPartOccurrence("1/removed")).toBeUndefined();
    expect(viewport.occurrences.getPartId("1/retained")).toBe(2);
    expect(isTargetSelected(viewport.interaction.state, { kind: "part", partId: 1 })).toBe(false);
    expect(isTargetSelected(viewport.interaction.state, { kind: "part", partId: 2 })).toBe(true);
    expect(attachment?.layout?.partOrder).toEqual([2]);
    expect(attachment?.calls).toEqual([{ partId: 2, instanceCount: 1 }]);
    expect(prepareOccurrenceUpdate).toHaveBeenCalledTimes(1);
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
          transform: translationMatrix(0, 0, 0),
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
      update.removePart(1, { placements: "remove" });
    });

    expect(outcome.results).toBe("cleared");
    expect(viewport.results.state).toBeUndefined();
    viewport.destroy();
  });
});
