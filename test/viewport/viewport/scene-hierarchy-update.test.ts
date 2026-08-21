import { describe, expect, it, vi } from "vitest";
import { createSceneBuilder } from "@/scene/scene";
import { RendererAttachment } from "@/renderer/attachment";
import { RendererPicking } from "@/renderer/picking/renderer-picking";
import {
  createPart,
  createViewport,
  fakeCanvas,
  fakeGpuDevice,
  installNavigator,
  installTestGpuGlobals,
  GpuRenderer,
  isTargetSelected,
  nodalResult,
  resultScene,
  setTargetSelected,
  translationMatrix,
} from "./support";

describe("Viewport incremental hierarchy updates", () => {
  it("cleans partial occurrence storage allocation and keeps the prior renderer usable", async () => {
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
    const scene = hierarchyScene();
    const viewport = await createViewport({ canvas: fakeCanvas(), scene, device: gpu.device });
    viewport.render();
    const bufferStart = gpu.buffers.length;
    const writeStart = gpu.writes.length;
    const liveBuffers = new Set(gpu.buffers.map(({ resource }) => resource));
    const invalidatePicking = vi.spyOn(RendererPicking.prototype, "invalidate");
    invalidatePicking.mockClear();
    fail = true;

    expect(() =>
      viewport.updateScene((update) => {
        update.addPlacement(1, {
          kind: "assembly",
          placementId: "attached",
          assemblyId: 2,
          transform: translationMatrix(3, 0, 0),
        });
      }),
    ).toThrow("injected occurrence order allocation failure");

    expect(viewport.scene).toBe(scene);
    expect(viewport.occurrences.getAssemblyOccurrence("1/attached")).toBeUndefined();
    expect(gpu.buffers.slice(bufferStart).map(({ destroyCount }) => destroyCount)).toEqual([1]);
    expect(gpu.writes.slice(writeStart).some(({ buffer }) => liveBuffers.has(buffer))).toBe(false);
    expect(invalidatePicking).not.toHaveBeenCalled();
    fail = false;
    expect(() => {
      viewport.render();
    }).not.toThrow();
    await viewport.recover();
    expect(viewport.occurrences.getPartOccurrence("1/keep")).toMatchObject({ partId: 1 });
    viewport.destroy();
  });

  it("restores the exact prior runtime when renderer preparation fails and remains recoverable", async () => {
    installTestGpuGlobals();
    installNavigator();
    const scene = hierarchyScene();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene,
      device: fakeGpuDevice().device,
    });
    viewport.visibility.setPartOccurrenceVisible("1/keep", false);
    viewport.render();
    const before = [...viewport.occurrences.partOccurrences()].map(
      (occurrence) => occurrence.partOccurrenceId,
    );
    vi.spyOn(GpuRenderer.prototype, "prepareOccurrenceUpdate").mockImplementationOnce(() => {
      throw new Error("injected occurrence allocation failure");
    });

    expect(() =>
      viewport.updateScene((update) => {
        update.addPlacement(1, {
          kind: "assembly",
          placementId: "attached",
          assemblyId: 2,
          transform: translationMatrix(3, 0, 0),
        });
      }),
    ).toThrow("injected occurrence allocation failure");

    expect(viewport.scene).toBe(scene);
    expect(
      [...viewport.occurrences.partOccurrences()].map((item) => item.partOccurrenceId),
    ).toEqual(before);
    expect(viewport.occurrences.getAssemblyOccurrence("1/attached")).toBeUndefined();
    expect(viewport.occurrences.isPartOccurrenceVisible("1/keep")).toBe(false);
    viewport.render();
    await viewport.recover();
    expect(viewport.occurrences.isPartOccurrenceVisible("1/keep")).toBe(false);
    viewport.destroy();
  });

  it("attaches an assembly subtree without replacing the runtime or rebuilding retained attachments", async () => {
    installTestGpuGlobals();
    installNavigator();
    const scene = hierarchyScene();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene,
      device: fakeGpuDevice().device,
    });
    const occurrences = viewport.occurrences;
    const attachment = vi.spyOn(RendererAttachment.prototype, "prepareParts");
    const invalidatePicking = vi.spyOn(RendererPicking.prototype, "invalidate");
    invalidatePicking.mockClear();

    viewport.updateScene((update) => {
      update.addPlacement(1, {
        kind: "assembly",
        placementId: "attached",
        assemblyId: 2,
        transform: translationMatrix(3, 0, 0),
      });
    });

    expect(viewport.occurrences).toBe(occurrences);
    expect(attachment).not.toHaveBeenCalled();
    expect(viewport.occurrences.getAssemblyOccurrence("1/attached")).toMatchObject({
      assemblyId: 2,
    });
    expect(viewport.occurrences.getPartOccurrence("1/attached/leaf")).toMatchObject({
      partId: 2,
    });
    expect(invalidatePicking).toHaveBeenCalledTimes(1);
    viewport.destroy();
  });

  it("preserves unrelated results and interaction through a hierarchy transaction", async () => {
    installTestGpuGlobals();
    installNavigator();
    const scene = hierarchyResultScene();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene,
      results: { scalar: { ...nodalResult(3).scalar, partId: 1 } },
      device: fakeGpuDevice().device,
    });
    viewport.interaction.set(
      setTargetSelected(viewport.interaction.state, { kind: "part", partId: 1 }, true),
    );

    const outcome = viewport.updateScene((update) => {
      update.addPlacement(1, {
        kind: "assembly",
        placementId: "attached",
        assemblyId: 2,
        transform: translationMatrix(3, 0, 0),
      });
    });

    expect(outcome.results).toBe("preserved");
    expect(viewport.results.state?.config.scalar?.partId).toBe(1);
    expect(isTargetSelected(viewport.interaction.state, { kind: "part", partId: 1 })).toBe(true);
    viewport.destroy();
  });

  it("applies retained definition visibility to an added subtree and reconstructs it on recovery", async () => {
    installTestGpuGlobals();
    installNavigator();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: hierarchyScene(),
      device: fakeGpuDevice().device,
    });
    viewport.visibility.setAssemblyVisible(2, false);

    viewport.updateScene((update) => {
      update.addPlacement(1, {
        kind: "assembly",
        placementId: "attached",
        assemblyId: 2,
        transform: translationMatrix(3, 0, 0),
      });
    });

    expect(viewport.occurrences.isPartOccurrenceVisible("1/attached/leaf")).toBe(false);
    await viewport.recover();
    expect(viewport.occurrences.getPartOccurrence("1/attached/leaf")).toMatchObject({ partId: 2 });
    expect(viewport.occurrences.isPartOccurrenceVisible("1/attached/leaf")).toBe(false);
    viewport.destroy();
  });

  it("commits an unplaced empty assembly definition without recompiling or touching renderer resources", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const scene = hierarchyScene();
    const viewport = await createViewport({ canvas: fakeCanvas(), scene, device: gpu.device });
    const occurrences = viewport.occurrences;
    const prepareOccurrence = vi.spyOn(GpuRenderer.prototype, "prepareOccurrenceUpdate");
    const prepareParts = vi.spyOn(RendererAttachment.prototype, "prepareParts");
    const invalidatePicking = vi.spyOn(RendererPicking.prototype, "invalidate");
    prepareOccurrence.mockClear();
    prepareParts.mockClear();
    invalidatePicking.mockClear();
    const before = gpuActivity(gpu);

    const outcome = viewport.updateScene((update) => {
      update.addAssembly({ id: 3, placements: [] });
    });

    expect(outcome).toEqual({ results: "none" });
    expect(viewport.scene).not.toBe(scene);
    expect(viewport.scene.assemblies.get(3)).toEqual({ id: 3, placements: [] });
    expect(viewport.occurrences).toBe(occurrences);
    expect(prepareOccurrence).not.toHaveBeenCalled();
    expect(prepareParts).not.toHaveBeenCalled();
    expect(invalidatePicking).not.toHaveBeenCalled();
    expect(gpuActivity(gpu)).toEqual(before);
    viewport.destroy();
  });

  it("removes an unplaced assembly definition without recompiling or touching renderer resources", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const scene = hierarchyScene();
    const viewport = await createViewport({ canvas: fakeCanvas(), scene, device: gpu.device });
    const occurrences = viewport.occurrences;
    const prepareOccurrence = vi.spyOn(GpuRenderer.prototype, "prepareOccurrenceUpdate");
    const prepareParts = vi.spyOn(RendererAttachment.prototype, "prepareParts");
    const invalidatePicking = vi.spyOn(RendererPicking.prototype, "invalidate");
    prepareOccurrence.mockClear();
    prepareParts.mockClear();
    invalidatePicking.mockClear();
    const before = gpuActivity(gpu);

    const outcome = viewport.updateScene((update) => {
      update.removeAssembly(2);
    });

    expect(outcome).toEqual({ results: "none" });
    expect(viewport.scene).not.toBe(scene);
    expect(viewport.scene.assemblies.has(2)).toBe(false);
    expect(viewport.occurrences).toBe(occurrences);
    expect(prepareOccurrence).not.toHaveBeenCalled();
    expect(prepareParts).not.toHaveBeenCalled();
    expect(invalidatePicking).not.toHaveBeenCalled();
    expect(gpuActivity(gpu)).toEqual(before);
    viewport.destroy();
  });
});

function gpuActivity(gpu: ReturnType<typeof fakeGpuDevice>) {
  return {
    buffers: gpu.buffers.length,
    writes: gpu.writes.length,
    textures: gpu.textureCreations,
    bindGroups: gpu.bindGroupCreations,
    submissions: gpu.submissionCount,
  };
}

function hierarchyScene() {
  const geometry = {
    primitive: "triangles" as const,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  };
  const first = createPart(1, { geometries: [geometry] });
  const second = createPart(2, { geometries: [geometry] });
  return createSceneBuilder()
    .addPart(first)
    .addPart(second)
    .addAssembly({
      id: 2,
      placements: [
        { kind: "part", placementId: "leaf", partId: 2, transform: translationMatrix(0, 0, 0) },
      ],
    })
    .addAssembly({
      id: 1,
      placements: [
        { kind: "part", placementId: "keep", partId: 1, transform: translationMatrix(0, 0, 0) },
      ],
    })
    .setRootAssembly(1)
    .build();
}

function hierarchyResultScene() {
  const resultPart = resultScene(3).parts.get(1);
  if (resultPart === undefined) throw new Error("result part missing");
  const geometry = {
    primitive: "triangles" as const,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
  };
  return createSceneBuilder()
    .addPart(resultPart)
    .addPart(createPart(2, { geometries: [geometry] }))
    .addAssembly({
      id: 2,
      placements: [
        { kind: "part", placementId: "leaf", partId: 2, transform: translationMatrix(0, 0, 0) },
      ],
    })
    .addAssembly({
      id: 1,
      placements: [
        { kind: "part", placementId: "keep", partId: 1, transform: translationMatrix(0, 0, 0) },
      ],
    })
    .setRootAssembly(1)
    .build();
}
