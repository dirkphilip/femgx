import { describe, expect, it } from "vitest";
import { createScene } from "../../../src/scene/scene";
import { UnknownSceneIdentityError } from "../../../src/viewport/visibility-error";
import {
  createViewport,
  fakeCanvas,
  fakeGpuDevice,
  identityScene,
  installNavigator,
  installTestGpuGlobals,
  translation,
} from "./support";

describe("Viewport scene-update visibility", () => {
  it("preserves definition visibility without flattening it into occurrence overrides", async () => {
    const viewport = await testViewport();
    viewport.visibility.setPart(1, false);
    const replacementPart = identityScene(false).parts.get(1);
    if (replacementPart === undefined) throw new Error("test part is missing");

    viewport.updateScene((update) => {
      update.replacePart(replacementPart);
    });
    viewport.visibility.setPart(1, true);

    expect(viewport.runtime.isPartOccurrenceVisible("1/keep")).toBe(true);
    viewport.destroy();
  });

  it("preserves occurrence visibility when a replacement runtime changes its slot", async () => {
    const viewport = await testViewport();
    viewport.updateScene((update) => {
      update.addPartOccurrence({
        assemblyId: 1,
        placementId: "retained",
        partId: 1,
        transform: translation(0, 0, 0),
      });
    });
    viewport.visibility.setPartOccurrence("1/retained", false);
    viewport.updateScene((update) => {
      update.removePartOccurrence({ assemblyId: 1, placementId: "keep" });
      const replacementPart = identityScene(false).parts.get(1);
      if (replacementPart === undefined) throw new Error("test part is missing");
      update.replacePart(replacementPart);
    });

    expect(viewport.runtime.isPartOccurrenceVisible("1/retained")).toBe(false);
    viewport.destroy();
  });

  it("keeps a definition policy without occurrences and applies it to a new occurrence", async () => {
    const viewport = await testViewport();
    viewport.visibility.setPart(1, false);
    viewport.updateScene((update) => {
      update.removePartOccurrence({ assemblyId: 1, placementId: "keep" });
    });
    viewport.updateScene((update) => {
      update.addPartOccurrence({
        assemblyId: 1,
        placementId: "added",
        partId: 1,
        transform: translation(0, 0, 0),
      });
    });

    expect(viewport.runtime.isPartOccurrenceVisible("1/added")).toBe(false);
    viewport.visibility.setPart(1, true);
    expect(viewport.runtime.isPartOccurrenceVisible("1/added")).toBe(true);
    viewport.destroy();
  });

  it("prunes a removed occurrence override before the same identity is added again", async () => {
    const viewport = await testViewport();
    viewport.visibility.setPartOccurrence("1/keep", false);
    viewport.updateScene((update) => {
      update.removePartOccurrence({ assemblyId: 1, placementId: "keep" });
    });
    expect(() => {
      viewport.visibility.setPartOccurrences(["1/keep"], false);
    }).toThrow(UnknownSceneIdentityError);
    viewport.updateScene((update) => {
      update.addPartOccurrence({
        assemblyId: 1,
        placementId: "keep",
        partId: 1,
        transform: translation(0, 0, 0),
      });
    });

    expect(viewport.runtime.isPartOccurrenceVisible("1/keep")).toBe(true);
    viewport.destroy();
  });

  it("preserves independent assembly definition and occurrence causes", async () => {
    const viewport = await testViewport(nestedScene());
    viewport.visibility.setAssemblyOccurrence("1/child", false);
    viewport.visibility.setAssembly(2, false);
    const replacementPart = identityScene(true).parts.get(1);
    if (replacementPart === undefined) throw new Error("test part is missing");
    viewport.updateScene((update) => {
      update.replacePart(replacementPart);
    });

    viewport.visibility.setAssembly(2, true);
    expect(viewport.runtime.isPartOccurrenceVisible("1/child/keep")).toBe(false);
    viewport.visibility.setAssemblyOccurrence("1/child", true);
    expect(viewport.runtime.isPartOccurrenceVisible("1/child/keep")).toBe(true);
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
  return createScene()
    .addPart(part)
    .addAssembly({
      id: 2,
      placements: [
        { kind: "part", placementId: "keep", partId: 1, transform: translation(0, 0, 0) },
      ],
    })
    .addAssembly({
      id: 1,
      placements: [
        { kind: "assembly", placementId: "child", assemblyId: 2, transform: translation(0, 0, 0) },
      ],
    })
    .withRoot(1)
    .build();
}
