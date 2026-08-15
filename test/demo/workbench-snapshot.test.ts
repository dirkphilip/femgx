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
    expect(snapshot.toolbar).toMatchObject({
      secondaryOpen: false,
      secondaryBusy: false,
      boxSelectionStrategy: "visible-surface",
    });
    expect(
      createWorkbenchSnapshot({ ...input, secondaryOpen: true, secondaryBusy: true }).toolbar,
    ).toMatchObject({
      secondaryOpen: true,
      secondaryBusy: true,
    });
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

  it("projects loading, feedback, inspection, diagnostics, and menu state", () => {
    const input: WorkbenchSnapshotInput = {
      ...createSnapshotInput(),
      presentation: {
        loading: true,
        modelSelectionDisabled: true,
        modelOpenDisabled: true,
        feedback: { message: "Building model…", kind: "info" },
        rendererStatus: "Renderer webgpu",
        rendererStatusVisible: true,
        status: "Fixture · webgpu · 1 visible",
        statusVisible: true,
        inspection: { visible: true, text: "Element 4" },
        diagnostics: { visible: true, text: "draw calls: 2" },
        resultLegend: { visible: true, text: "Demo stress\nRange 10 – 80" },
        contextMenu: {
          visible: true,
          x: 24,
          y: 48,
          title: "Element 4",
          entries: [{ kind: "button", label: "Highlight", action: "highlight" }],
        },
      },
    };

    const snapshot = createWorkbenchSnapshot(input);

    expect(snapshot.model).toMatchObject({
      loading: true,
      selectionDisabled: true,
      openDisabled: true,
    });
    expect(snapshot.overlays).toMatchObject({
      feedback: { message: "Building model…", kind: "info" },
      inspection: { visible: true, text: "Element 4" },
      diagnostics: true,
      diagnosticsText: "draw calls: 2",
      resultLegend: { visible: true, text: "Demo stress\nRange 10 – 80" },
      contextMenu: { visible: true, title: "Element 4" },
    });
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
    boxSelectionStrategy: "visible-surface",
    secondaryOpen: false,
    secondaryBusy: false,
    scalarFieldId: "__base__",
    resultMode: "base",
    deformationScale: 1,
    vectorDisplay: {
      fieldId: "__vectors_off__",
      glyph: "arrow",
      transform: "direction",
      lengthScale: 1,
      widthPixels: 2,
    },
    sectionAxis: "off",
    sectionOffset: 0,
  };
}
