import { describe, expect, it } from "vitest";
import { createSceneBuilder } from "../../../src/scene/scene";
import { UnknownSceneIdentityError } from "../../../src/viewport/visibility-error";
import {
  createViewport,
  fakeCanvas,
  fakeGpuDevice,
  identityScene,
  installNavigator,
  installTestGpuGlobals,
  translationMatrix,
} from "./support";

describe("Viewport scene-update visibility", () => {
  it("preserves definition visibility without flattening it into occurrence overrides", async () => {
    const viewport = await testViewport();
    viewport.visibility.setPartVisible(1, false);
    const replacementPart = identityScene(false).parts.get(1);
    if (replacementPart === undefined) throw new Error("test part is missing");

    viewport.updateScene((update) => {
      update.replacePart(replacementPart);
    });
    viewport.visibility.setPartVisible(1, true);

    expect(viewport.occurrences.isPartOccurrenceVisible("1/keep")).toBe(true);
    viewport.destroy();
  });

  it("preserves occurrence visibility when a replacement runtime changes its slot", async () => {
    const viewport = await testViewport();
    viewport.updateScene((update) => {
      update.addPlacement(1, {
        kind: "part",
        placementId: "retained",
        partId: 1,
        transform: translationMatrix(0, 0, 0),
      });
    });
    viewport.visibility.setPartOccurrenceVisible("1/retained", false);
    viewport.updateScene((update) => {
      update.removePlacement(1, "keep");
      const replacementPart = identityScene(false).parts.get(1);
      if (replacementPart === undefined) throw new Error("test part is missing");
      update.replacePart(replacementPart);
    });

    expect(viewport.occurrences.isPartOccurrenceVisible("1/retained")).toBe(false);
    viewport.destroy();
  });

  it("keeps a definition policy without occurrences and applies it to a new occurrence", async () => {
    const viewport = await testViewport();
    viewport.visibility.setPartVisible(1, false);
    viewport.updateScene((update) => {
      update.removePlacement(1, "keep");
    });
    viewport.updateScene((update) => {
      update.addPlacement(1, {
        kind: "part",
        placementId: "added",
        partId: 1,
        transform: translationMatrix(0, 0, 0),
      });
    });

    expect(viewport.occurrences.isPartOccurrenceVisible("1/added")).toBe(false);
    viewport.visibility.setPartVisible(1, true);
    expect(viewport.occurrences.isPartOccurrenceVisible("1/added")).toBe(true);
    viewport.destroy();
  });

  it("prunes a removed occurrence override before the same identity is added again", async () => {
    const viewport = await testViewport();
    viewport.visibility.setPartOccurrenceVisible("1/keep", false);
    viewport.updateScene((update) => {
      update.removePlacement(1, "keep");
    });
    expect(() => {
      viewport.visibility.setPartOccurrences(["1/keep"], false);
    }).toThrow(UnknownSceneIdentityError);
    viewport.updateScene((update) => {
      update.addPlacement(1, {
        kind: "part",
        placementId: "keep",
        partId: 1,
        transform: translationMatrix(0, 0, 0),
      });
    });

    expect(viewport.occurrences.isPartOccurrenceVisible("1/keep")).toBe(true);
    viewport.destroy();
  });

  it("prunes removed part policy before the same definition id is registered again", async () => {
    const viewport = await testViewport();
    const occurrences = viewport.occurrences;
    const part = viewport.scene.parts.get(1);
    if (part === undefined) throw new Error("test part is missing");
    viewport.visibility.setPartVisible(1, false);
    viewport.updateScene((update) => {
      update.removePart(1, { placements: "remove" });
    });
    viewport.updateScene((update) => {
      update.addPart(part);
      update.addPlacement(1, {
        kind: "part",
        placementId: "restored",
        partId: 1,
        transform: translationMatrix(0, 0, 0),
      });
    });

    expect(viewport.occurrences).toBe(occurrences);
    expect(viewport.occurrences.isPartOccurrenceVisible("1/restored")).toBe(true);
    viewport.destroy();
  });

  it("preserves independent assembly definition and occurrence causes", async () => {
    const viewport = await testViewport(nestedScene());
    viewport.visibility.setAssemblyOccurrenceVisible("1/child", false);
    viewport.visibility.setAssemblyVisible(2, false);
    const replacementPart = identityScene(true).parts.get(1);
    if (replacementPart === undefined) throw new Error("test part is missing");
    viewport.updateScene((update) => {
      update.replacePart(replacementPart);
    });

    viewport.visibility.setAssemblyVisible(2, true);
    expect(viewport.occurrences.isPartOccurrenceVisible("1/child/keep")).toBe(false);
    viewport.visibility.setAssemblyOccurrenceVisible("1/child", true);
    expect(viewport.occurrences.isPartOccurrenceVisible("1/child/keep")).toBe(true);
    viewport.destroy();
  });
});

async function testViewport(scene = identityScene(false)) {
  installTestGpuGlobals();
  installNavigator();
  return createViewport({
    canvas: fakeCanvas(),
    scene,
    device: fakeGpuDevice().device,
  });
}

function nestedScene() {
  const part = identityScene(false).parts.get(1);
  if (part === undefined) throw new Error("test part is missing");
  return createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 2,
      placements: [
        { kind: "part", placementId: "keep", partId: 1, transform: translationMatrix(0, 0, 0) },
      ],
    })
    .addAssembly({
      id: 1,
      placements: [
        {
          kind: "assembly",
          placementId: "child",
          assemblyId: 2,
          transform: translationMatrix(0, 0, 0),
        },
      ],
    })
    .setRootAssembly(1)
    .build();
}
