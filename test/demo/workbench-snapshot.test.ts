import { describe, expect, it } from "vitest";
import { createInteractionState, createSceneRuntime } from "../../src/index";
import { createBoltedPlateFixture } from "../../demo/fixture/bolted-plate";
import {
  createWorkbenchSnapshot,
  WorkbenchSnapshotBridge,
  type WorkbenchSnapshotInput,
} from "../../demo/workbench/snapshot";
import type { WorkbenchModel } from "../../demo/workbench/model";

describe("workbench presentation snapshot", () => {
  it("contains presentation-sized values without runtime storage references", () => {
    const input = createSnapshotInput();
    const snapshot = createWorkbenchSnapshot(input);

    expect(snapshot.model.active).toEqual({
      id: input.model.id,
      name: input.model.name,
      source: "example",
    });
    expect(snapshot.model.partCount).toBe(input.model.scene.parts.size);
    expect(snapshot.hierarchy.occurrenceCount).toBe(input.runtime.occurrenceCount);
    expect(snapshot).not.toHaveProperty("runtime");
    expect(snapshot).not.toHaveProperty("interaction");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.model.available)).toBe(true);
  });

  it("publishes a fresh snapshot and stops after unsubscribe", () => {
    let input = createSnapshotInput();
    const bridge = new WorkbenchSnapshotBridge(() => input);
    const snapshots: string[] = [];
    const unsubscribe = bridge.subscribe((snapshot) => {
      snapshots.push(`${snapshot.toolbar.continuous}`);
    });

    input = { ...input, continuous: true };
    bridge.publish();
    unsubscribe();
    input = { ...input, continuous: false };
    bridge.publish();

    expect(snapshots).toEqual(["false", "true"]);
  });
});

function createSnapshotInput(): WorkbenchSnapshotInput {
  const fixture = createBoltedPlateFixture();
  const model: WorkbenchModel = {
    id: "fixture",
    name: "Fixture",
    source: "example",
    scene: fixture.scene,
    elementModels: fixture.elementModels,
    partNames: new Map(),
    partStyles: new Map(),
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
    results: undefined,
    issues: [],
  };
  return {
    model,
    models: [model],
    runtime: createSceneRuntime(model.scene),
    interaction: createInteractionState(),
    rendererName: "webgpu",
    rendererState: "",
    cameraMode: "orthographic",
    background: "studio",
    toggles: { edges: true, nodes: true, diagnostics: false },
    continuous: false,
    selectionGranularity: "element",
    resultMode: "base",
    deformationScale: 1,
    vectorDisplay: {
      fieldId: "__vectors_off__",
      glyph: "arrow",
      transform: "direction",
      lengthScale: 1,
    },
    sectionAxis: "off",
    sectionOffset: 0,
  };
}
