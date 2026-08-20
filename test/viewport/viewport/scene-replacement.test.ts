import { describe, expect, it, vi } from "vitest";
import {
  installNavigator,
  scene,
  explicitScene,
  invalidScene,
  resultScene,
  nodalResult,
  orientationResult,
  identityScene,
  createPart,
  setPartOverride,
  isTargetSelected,
  setTargetSelected,
  translationMatrix,
  createViewport,
  RendererAttachment,
  GpuRenderer,
  fakeCanvas,
  fakeGpuDevice,
  installTestGpuGlobals,
} from "./support";

describe("Viewport", () => {
  it("invalidates geometry resources before applying results to a replacement scene", async () => {
    installTestGpuGlobals();
    installNavigator();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: resultScene(3),
      results: nodalResult(3),
      device: fakeGpuDevice().device,
    });

    viewport.replaceScene(resultScene(6));
    expect(() => {
      viewport.results.set(nodalResult(6));
    }).not.toThrow();
    expect(() => {
      viewport.render();
    }).not.toThrow();
    viewport.destroy();
  });

  it("clears every renderer result role during full scene replacement", async () => {
    installTestGpuGlobals();
    installNavigator();
    const setOrientationGlyphs = vi.spyOn(GpuRenderer.prototype, "setOrientationGlyphs");
    const setDeformation = vi.spyOn(GpuRenderer.prototype, "setDeformation");
    const setResultColors = vi.spyOn(GpuRenderer.prototype, "setResultColors");
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: identityScene(false),
      results: orientationResult(),
      device: fakeGpuDevice().device,
    });

    setOrientationGlyphs.mockClear();
    setDeformation.mockClear();
    setResultColors.mockClear();
    viewport.replaceScene(scene());

    expect(setOrientationGlyphs).toHaveBeenLastCalledWith(undefined);
    expect(setDeformation).toHaveBeenLastCalledWith(undefined);
    expect(setResultColors).toHaveBeenLastCalledWith(undefined);
    expect(viewport.results.state).toBeUndefined();
    viewport.destroy();
  });

  it("resynchronizes compatible orientation results and clears incompatible ones", async () => {
    installTestGpuGlobals();
    installNavigator();
    const setOrientationGlyphs = vi.spyOn(GpuRenderer.prototype, "setOrientationGlyphs");
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: identityScene(false),
      results: orientationResult(),
      device: fakeGpuDevice().device,
    });

    setOrientationGlyphs.mockClear();
    const compatiblePart = identityScene(false).parts.get(1);
    if (compatiblePart === undefined) throw new Error("test part is missing");
    expect(
      viewport.updateScene((update) => {
        update.replacePart(compatiblePart);
      }),
    ).toEqual({
      results: "preserved",
    });
    expect(setOrientationGlyphs).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "arrow", transform: "direction" }),
    );
    expect(viewport.results.state?.orientation).toBeDefined();

    setOrientationGlyphs.mockClear();
    const incompatiblePart = scene().parts.get(1);
    if (incompatiblePart === undefined) throw new Error("test part is missing");
    expect(
      viewport.updateScene((update) => {
        update.replacePart(incompatiblePart);
      }),
    ).toMatchObject({
      results: "cleared",
    });
    expect(setOrientationGlyphs).toHaveBeenLastCalledWith(undefined);
    expect(viewport.results.state).toBeUndefined();
    viewport.destroy();
  });

  it("updates a scene transactionally while preserving surviving state", async () => {
    installTestGpuGlobals();
    installNavigator();
    const resetScene = vi.spyOn(RendererAttachment.prototype, "clear");
    const initial = identityScene(true);
    const replacement = identityScene(false);
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: initial,
      device: fakeGpuDevice().device,
    });
    const camera = viewport.view.camera;
    viewport.visibility.setPartOccurrenceVisible("1/keep", false);
    viewport.interaction.set(
      setTargetSelected(
        viewport.interaction.state,
        { kind: "partOccurrence", partOccurrenceId: "1/keep" },
        true,
      ),
    );

    const replacementPart = replacement.parts.get(1);
    if (replacementPart === undefined) throw new Error("test part is missing");
    const outcome = viewport.updateScene((update) => {
      update.replacePart(replacementPart);
    });

    expect(outcome).toEqual({ results: "none" });
    expect(viewport.scene).not.toBe(initial);
    expect(viewport.scene.parts.get(1)).toBe(replacementPart);
    expect(viewport.view.camera).toBe(camera);
    expect(
      Array.from(
        viewport.occurrences.partOccurrences(),
        ({ partOccurrenceId }) => partOccurrenceId,
      ),
    ).toEqual(["1/keep"]);
    expect(viewport.occurrences.isPartOccurrenceVisible("1/keep")).toBe(false);
    expect(
      isTargetSelected(viewport.interaction.state, {
        kind: "partOccurrence",
        partOccurrenceId: "1/keep",
      }),
    ).toBe(true);
    expect(resetScene).not.toHaveBeenCalled();
    viewport.destroy();
  });

  it("retains the current revision for no-ops and rejected update callbacks", async () => {
    installTestGpuGlobals();
    installNavigator();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: identityScene(false),
      device: fakeGpuDevice().device,
    });
    const currentScene = viewport.scene;
    const currentOccurrences = viewport.occurrences;

    expect(viewport.updateScene(() => undefined)).toEqual({ results: "none" });
    expect(viewport.scene).toBe(currentScene);
    expect(viewport.occurrences).toBe(currentOccurrences);
    expect(() =>
      viewport.updateScene(() => {
        viewport.updateScene(() => undefined);
      }),
    ).toThrow(/already active/);
    const asyncOperation = (() => Promise.resolve()) as unknown as Parameters<
      typeof viewport.updateScene
    >[0];
    expect(() => viewport.updateScene(asyncOperation)).toThrow(/synchronous/);
    expect(viewport.scene).toBe(currentScene);
    expect(viewport.occurrences).toBe(currentOccurrences);
    viewport.destroy();
  });

  it("prunes nested interaction identities that the replacement geometry removed", async () => {
    installTestGpuGlobals();
    installNavigator();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: identityScene(true),
      device: fakeGpuDevice().device,
    });
    const partOccurrenceId = "1/keep" as const;
    let interaction = viewport.interaction.state;
    interaction = setTargetSelected(
      interaction,
      { kind: "body", partOccurrenceId, bodyId: 1 },
      true,
    );
    interaction = setTargetSelected(
      interaction,
      { kind: "element", partOccurrenceId, elementId: 11 },
      true,
    );
    interaction = setTargetSelected(
      interaction,
      { kind: "node", partOccurrenceId, nodeId: 3 },
      true,
    );
    interaction = setTargetSelected(
      interaction,
      { kind: "face", partOccurrenceId, elementId: 11, faceIndex: 0 },
      true,
    );
    viewport.interaction.set(interaction);

    const replacementPart = identityScene(false).parts.get(1);
    if (replacementPart === undefined) throw new Error("test part is missing");
    viewport.updateScene((update) => {
      update.replacePart(replacementPart);
    });

    expect(
      isTargetSelected(viewport.interaction.state, { kind: "body", partOccurrenceId, bodyId: 1 }),
    ).toBe(false);
    expect(
      isTargetSelected(viewport.interaction.state, {
        kind: "element",
        partOccurrenceId,
        elementId: 11,
      }),
    ).toBe(false);
    expect(
      isTargetSelected(viewport.interaction.state, { kind: "node", partOccurrenceId, nodeId: 3 }),
    ).toBe(false);
    expect(
      isTargetSelected(viewport.interaction.state, {
        kind: "face",
        partOccurrenceId,
        elementId: 11,
        faceIndex: 0,
      }),
    ).toBe(false);
    viewport.destroy();
  });

  it("preserves compatible results and reports when scene coverage clears them", async () => {
    installTestGpuGlobals();
    installNavigator();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: resultScene(3),
      results: nodalResult(3),
      device: fakeGpuDevice().device,
    });

    const compatiblePart = resultScene(3).parts.get(1);
    if (compatiblePart === undefined) throw new Error("test part is missing");
    expect(
      viewport.updateScene((update) => {
        update.replacePart(compatiblePart);
      }),
    ).toEqual({
      results: "preserved",
    });
    expect(viewport.results.state).toBeDefined();
    const incompatiblePart = resultScene(6).parts.get(1);
    if (incompatiblePart === undefined) throw new Error("test part is missing");
    const cleared = viewport.updateScene((update) => {
      update.replacePart(incompatiblePart);
    });
    expect(cleared.results).toBe("cleared");
    if (cleared.results !== "cleared") throw new Error("expected cleared results");
    expect(cleared.reason).toMatch(/no value/);
    expect(viewport.results.state).toBeUndefined();
    viewport.destroy();
  });
});

describe("Viewport", () => {
  it("preserves surviving placement state across transactional scene replacement", async () => {
    installTestGpuGlobals();
    installNavigator();
    const geometry = {
      positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      primitive: "triangles" as const,
    };
    const keep = createPart(1, { geometries: [geometry] });
    const remove = createPart(2, { geometries: [geometry] });
    const added = createPart(3, { geometries: [geometry] });
    const initial = explicitScene(
      [remove, keep],
      [
        { kind: "part", placementId: "remove", partId: 2, transform: translationMatrix(0, 0, 0) },
        { kind: "part", placementId: "keep", partId: 1, transform: translationMatrix(1, 0, 0) },
      ],
    );
    const replacement = explicitScene(
      [keep, added],
      [
        { kind: "part", placementId: "keep", partId: 1, transform: translationMatrix(10, 0, 0) },
        { kind: "part", placementId: "added", partId: 3, transform: translationMatrix(20, 0, 0) },
      ],
    );
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: initial,
      device: fakeGpuDevice().device,
    });
    viewport.view.setCamera({
      ...viewport.view.camera,
      target: [4, 5, 6] as [number, number, number],
    });
    const camera = viewport.view.camera;
    viewport.visibility.setPartOccurrenceVisible("1/keep", false);
    let interaction = setTargetSelected(
      viewport.interaction.state,
      { kind: "partOccurrence", partOccurrenceId: "1/keep" },
      true,
    );
    interaction = setTargetSelected(interaction, { kind: "part", partId: 2 }, true);
    viewport.interaction.set(interaction);

    viewport.replaceScene(replacement);

    expect(viewport.view.camera).toBe(camera);
    expect(
      Array.from(
        viewport.occurrences.partOccurrences(),
        ({ partOccurrenceId }) => partOccurrenceId,
      ),
    ).toEqual(["1/keep", "1/added"]);
    expect(viewport.occurrences.isPartOccurrenceVisible("1/keep")).toBe(false);
    expect(
      isTargetSelected(viewport.interaction.state, {
        kind: "partOccurrence",
        partOccurrenceId: "1/keep",
      }),
    ).toBe(true);
    expect(isTargetSelected(viewport.interaction.state, { kind: "part", partId: 2 })).toBe(false);
    viewport.destroy();
  });

  it("rejects an invalid camera without replacing the current camera", async () => {
    installTestGpuGlobals();
    installNavigator();
    const onRender = vi.fn();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: fakeGpuDevice().device,
      onRender,
    });
    const previous = viewport.view.camera;
    expect(() => {
      viewport.view.setCamera({ ...previous, near: 0 });
    }).toThrow(/near\/far/);
    expect(viewport.view.camera).toBe(previous);
    expect(onRender).toHaveBeenCalledOnce();
    viewport.destroy();
  });

  it("rejects an invalid scene replacement transactionally", async () => {
    installTestGpuGlobals();
    installNavigator();
    const gpu = fakeGpuDevice();
    const viewport = await createViewport({
      canvas: fakeCanvas(),
      scene: scene(),
      device: gpu.device,
    });
    const interaction = setPartOverride(viewport.interaction.state, 1, { emissive: 0.4 });
    viewport.interaction.set(interaction);
    const previous = {
      camera: viewport.view.camera,
      interaction: viewport.interaction.state,
      occurrences: viewport.occurrences,
      scene: viewport.scene,
      submissions: gpu.submissionCount,
      writes: gpu.writes.length,
    };

    expect(() => {
      viewport.replaceScene(invalidScene());
    }).toThrow(/transform must contain exactly 16 components/);
    expect(viewport.view.camera).toBe(previous.camera);
    expect(viewport.interaction.state).toBe(previous.interaction);
    expect(viewport.occurrences).toBe(previous.occurrences);
    expect(viewport.scene).toBe(previous.scene);
    expect(gpu.submissionCount).toBe(previous.submissions);
    expect(gpu.writes).toHaveLength(previous.writes);

    expect(() => {
      viewport.render();
    }).not.toThrow();
    viewport.destroy();
  });
});
