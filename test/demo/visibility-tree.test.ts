import { describe, expect, it } from "vitest";
import { createBoltedPlateFixture } from "../../src/fixture/bolted-plate";
import { createBoltedPlatePreset, visiblePartIdsForPreset } from "../../src/fixture/presets";
import { createSceneRuntime } from "../../src/scene-runtime/runtime";
import type { SceneRuntime } from "../../src/scene-runtime/runtime";
import {
  assemblyName,
  assemblySubtreeIds,
  assemblyVisibilityState,
} from "../../demo/visibility-tree";

/** A bolted runtime with the solid-mode part visibility the demo starts with. */
function solidRuntime(): SceneRuntime {
  const preset = createBoltedPlatePreset();
  const runtime = createSceneRuntime(preset.scene);
  const visible = visiblePartIdsForPreset(preset, "solid");
  for (const partId of preset.scene.parts.keys()) {
    runtime.setPartVisible(partId, visible.has(partId));
  }
  return runtime;
}

describe("assemblySubtreeIds", () => {
  it("returns the assembly and its nested sub-assemblies in pre-order", () => {
    const { scene, assemblyIds } = createBoltedPlateFixture();
    const firstFastener = assemblyIds.fastener[0];
    if (firstFastener === undefined) throw new Error("expected a fastener assembly id");
    expect(assemblySubtreeIds(scene.assemblies, assemblyIds.plateStack)).toEqual([2]);
    expect(assemblySubtreeIds(scene.assemblies, assemblyIds.fasteners)).toEqual([
      3, 4, 12, 5, 13, 6, 14, 7, 15, 8, 16, 9, 17, 10, 18, 11, 19,
    ]);
    expect(assemblySubtreeIds(scene.assemblies, firstFastener)).toEqual([4, 12]);
    expect(assemblySubtreeIds(scene.assemblies, assemblyIds.root)).toHaveLength(19);
  });
});

describe("assemblyVisibilityState", () => {
  it("reports every assembly checked when the scene starts fully visible", () => {
    const runtime = solidRuntime();
    const { scene, assemblyIds } = createBoltedPlateFixture();
    for (const id of assemblySubtreeIds(scene.assemblies, assemblyIds.root)) {
      expect(assemblyVisibilityState(runtime, id)).toBe("checked");
    }
  });

  it("hides the plate stack and leaves the joint mixed", () => {
    const { assemblyIds } = createBoltedPlateFixture();
    const runtime = solidRuntime();
    runtime.setAssemblyVisible(assemblyIds.plateStack, false);
    expect(assemblyVisibilityState(runtime, assemblyIds.plateStack)).toBe("unchecked");
    expect(assemblyVisibilityState(runtime, assemblyIds.fasteners)).toBe("checked");
    expect(assemblyVisibilityState(runtime, assemblyIds.root)).toBe("mixed");
    expect(runtime.visibleCount).toBe(32);
  });

  it("hides all fasteners and leaves only the plates visible", () => {
    const { assemblyIds } = createBoltedPlateFixture();
    const runtime = solidRuntime();
    runtime.setAssemblyVisible(assemblyIds.fasteners, false);
    expect(assemblyVisibilityState(runtime, assemblyIds.fasteners)).toBe("unchecked");
    expect(assemblyVisibilityState(runtime, assemblyIds.root)).toBe("mixed");
    expect(runtime.visibleCount).toBe(2);
  });

  it("marks the fastener group mixed when one fastener is hidden", () => {
    const { assemblyIds } = createBoltedPlateFixture();
    const runtime = solidRuntime();
    const first = assemblyIds.fastener[0];
    if (first === undefined) throw new Error("expected a fastener assembly id");
    runtime.setAssemblyVisible(first, false);
    expect(assemblyVisibilityState(runtime, first)).toBe("unchecked");
    expect(assemblyVisibilityState(runtime, assemblyIds.fasteners)).toBe("mixed");
    expect(assemblyVisibilityState(runtime, assemblyIds.root)).toBe("mixed");
    expect(runtime.visibleCount).toBe(30);
  });

  it("restores a mixed subtree by showing every descendant assembly", () => {
    const { scene, assemblyIds } = createBoltedPlateFixture();
    const runtime = solidRuntime();
    const first = assemblyIds.fastener[0];
    if (first === undefined) throw new Error("expected a fastener assembly id");
    runtime.setAssemblyVisible(first, false);
    expect(assemblyVisibilityState(runtime, assemblyIds.fasteners)).toBe("mixed");

    for (const id of assemblySubtreeIds(scene.assemblies, assemblyIds.fasteners)) {
      runtime.setAssemblyVisible(id, true);
    }
    expect(assemblyVisibilityState(runtime, assemblyIds.fasteners)).toBe("checked");
    expect(assemblyVisibilityState(runtime, assemblyIds.root)).toBe("checked");
    expect(runtime.visibleCount).toBe(34);
  });

  it("does not restore an author-hidden descendant with a single parent toggle", () => {
    const { assemblyIds } = createBoltedPlateFixture();
    const runtime = solidRuntime();
    const first = assemblyIds.fastener[0];
    if (first === undefined) throw new Error("expected a fastener assembly id");
    runtime.setAssemblyVisible(first, false);
    runtime.setAssemblyVisible(assemblyIds.fasteners, true);
    expect(assemblyVisibilityState(runtime, first)).toBe("unchecked");
    expect(assemblyVisibilityState(runtime, assemblyIds.fasteners)).toBe("mixed");
    expect(runtime.visibleCount).toBe(30);
  });
});

describe("assemblyName", () => {
  it("reads the optional display name from a registered assembly", () => {
    const { scene, assemblyIds } = createBoltedPlateFixture();
    expect(assemblyName(scene.assemblies.get(assemblyIds.root))).toBe("Bolted joint");
    expect(assemblyName(scene.assemblies.get(assemblyIds.fastener[0] ?? 0))).toBe("Fastener 1");
    expect(assemblyName(undefined)).toBeUndefined();
  });
});
