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
  translation,
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

    viewport.setScene(resultScene(6));
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
    viewport.setScene(scene());

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
    expect(viewport.updateScene(identityScene(false))).toEqual({ results: "preserved" });
    expect(setOrientationGlyphs).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: "arrow", transform: "direction" }),
    );
    expect(viewport.results.state?.vectors).toBeDefined();

    setOrientationGlyphs.mockClear();
    expect(viewport.updateScene(scene())).toMatchObject({ results: "cleared" });
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
    viewport.visibility.setInstance("1/keep", false);
    viewport.interaction.set(
      setTargetSelected(
        viewport.interaction.state,
        { kind: "instance", instanceId: "1/keep" },
        true,
      ),
    );

    const outcome = viewport.updateScene(replacement);

    expect(outcome).toEqual({ results: "none" });
    expect(viewport.scene).toBe(replacement);
    expect(viewport.view.camera).toBe(camera);
    expect(viewport.runtime.getInstanceIds()).toEqual(["1/keep"]);
    expect(viewport.runtime.isInstanceVisible("1/keep")).toBe(false);
    expect(
      isTargetSelected(viewport.interaction.state, { kind: "instance", instanceId: "1/keep" }),
    ).toBe(true);
    expect(resetScene).not.toHaveBeenCalled();
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
    const instanceId = "1/keep" as const;
    let interaction = viewport.interaction.state;
    interaction = setTargetSelected(interaction, { kind: "body", instanceId, bodyId: 1 }, true);
    interaction = setTargetSelected(
      interaction,
      { kind: "element", instanceId, elementId: 11 },
      true,
    );
    interaction = setTargetSelected(interaction, { kind: "node", instanceId, nodeId: 3 }, true);
    interaction = setTargetSelected(
      interaction,
      { kind: "face", instanceId, elementId: 11, faceIndex: 0 },
      true,
    );
    viewport.interaction.set(interaction);

    viewport.updateScene(identityScene(false));

    expect(
      isTargetSelected(viewport.interaction.state, { kind: "body", instanceId, bodyId: 1 }),
    ).toBe(false);
    expect(
      isTargetSelected(viewport.interaction.state, { kind: "element", instanceId, elementId: 11 }),
    ).toBe(false);
    expect(
      isTargetSelected(viewport.interaction.state, { kind: "node", instanceId, nodeId: 3 }),
    ).toBe(false);
    expect(
      isTargetSelected(viewport.interaction.state, {
        kind: "face",
        instanceId,
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

    expect(viewport.updateScene(resultScene(3))).toEqual({ results: "preserved" });
    expect(viewport.results.state).toBeDefined();
    const cleared = viewport.updateScene(resultScene(6));
    expect(cleared.results).toBe("cleared");
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
        { kind: "part", placementId: "remove", partId: 2, transform: translation(0, 0, 0) },
        { kind: "part", placementId: "keep", partId: 1, transform: translation(1, 0, 0) },
      ],
    );
    const replacement = explicitScene(
      [keep, added],
      [
        { kind: "part", placementId: "keep", partId: 1, transform: translation(10, 0, 0) },
        { kind: "part", placementId: "added", partId: 3, transform: translation(20, 0, 0) },
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
    viewport.visibility.setInstance("1/keep", false);
    let interaction = setTargetSelected(
      viewport.interaction.state,
      { kind: "instance", instanceId: "1/keep" },
      true,
    );
    interaction = setTargetSelected(interaction, { kind: "part", partId: 2 }, true);
    viewport.interaction.set(interaction);

    viewport.setScene(replacement);

    expect(viewport.view.camera).toBe(camera);
    expect(viewport.runtime.getInstanceIds()).toEqual(["1/keep", "1/added"]);
    expect(viewport.runtime.isInstanceVisible("1/keep")).toBe(false);
    expect(
      isTargetSelected(viewport.interaction.state, { kind: "instance", instanceId: "1/keep" }),
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
      runtime: viewport.runtime,
      scene: viewport.scene,
      submissions: gpu.submissionCount,
      writes: gpu.writes.length,
    };

    expect(() => {
      viewport.setScene(invalidScene());
    }).toThrow(/transform must contain exactly 16 components/);
    expect(viewport.view.camera).toBe(previous.camera);
    expect(viewport.interaction.state).toBe(previous.interaction);
    expect(viewport.runtime).toBe(previous.runtime);
    expect(viewport.scene).toBe(previous.scene);
    expect(gpu.submissionCount).toBe(previous.submissions);
    expect(gpu.writes).toHaveLength(previous.writes);

    expect(() => {
      viewport.render();
    }).not.toThrow();
    viewport.destroy();
  });
});
