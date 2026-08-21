import { describe, expect, it, vi } from "vitest";
import { createSceneBuilder } from "@/scene/scene";
import { RendererAttachment } from "@/renderer/attachment";
import {
  createPart,
  createViewport,
  fakeCanvas,
  fakeGpuDevice,
  installNavigator,
  installTestGpuGlobals,
  translationMatrix,
} from "./support";

describe("Viewport incremental hierarchy updates", () => {
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
});

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
