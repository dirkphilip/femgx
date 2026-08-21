import { describe, expect, it, vi } from "vitest";
import {
  createPart,
  createSceneBuilder,
  identityMatrix,
  type Scene,
  type SceneUpdate,
  type SceneUpdateOutcome,
} from "@/entries/root";
import { prepareSceneUpdate } from "@/scene/update";
import { applyLivePartEditForOwner } from "../../../demo/workbench/controllers/controller-live-part-edit";
import { WorkbenchModelCatalog } from "../../../demo/workbench/models/model-catalog";
import type { WorkbenchModel } from "../../../demo/workbench/models/model";
import type { WorkbenchViewportSlot } from "../../../demo/workbench/viewport/viewport-slots";

describe("live part edit controller", () => {
  it("restores every committed slot's presentation when a later slot rejects the edit", () => {
    const before = model(scene());
    const primary = fakeSlot("primary", before.scene, { results: "preserved" });
    const secondary = fakeSlot("secondary", before.scene, { results: "preserved" }, true);
    const restored = new Set<string>();
    const owner = ownerFor(before, [primary.slot, secondary.slot], (slotId) => {
      restored.add(slotId);
      slotFor(slotId, primary, secondary).presentationRestored = true;
    });

    applyLivePartEditForOwner(owner, "2", "1");

    expect(primary.viewport.replaceScene).toHaveBeenCalledWith(before.scene);
    expect(primary.viewport.render).toHaveBeenCalledOnce();
    expect(restored).toEqual(new Set(["primary"]));
    expect(primary.presentationRestored).toBe(true);
    expect(owner.presentation.setFeedback).toHaveBeenCalledWith(
      expect.stringContaining("Live edit could not be applied"),
      "error",
    );
    expect(owner.model).toBe(before);
  });

  it("resets result controls and reports an update that clears authored results", () => {
    const before = model(scene());
    const primary = fakeSlot("primary", before.scene, {
      results: "cleared",
      reason: "Field live-stress omits Part 2",
    });
    const owner = ownerFor(before, [primary.slot]);
    owner.showState("primary").resultMode = "colored";
    owner.showState("primary").scalarFieldId = "live-stress";

    applyLivePartEditForOwner(owner, "1", "1");

    expect(owner.showState("primary")).toMatchObject({
      resultMode: "base",
      scalarFieldId: "__base__",
      resultPlaybackActive: false,
      resultPlaybackPlaying: false,
    });
    expect(owner.presentation.setFeedback).toHaveBeenCalledWith(
      expect.stringContaining("Results cleared: Field live-stress omits Part 2."),
    );
  });
});

interface FakeSlot {
  readonly slot: WorkbenchViewportSlot;
  readonly viewport: {
    scene: Scene;
    readonly results: { state: unknown };
    readonly updateScene: ReturnType<typeof vi.fn>;
    readonly replaceScene: ReturnType<typeof vi.fn>;
    readonly render: ReturnType<typeof vi.fn>;
  };
  presentationRestored: boolean;
}

function fakeSlot(
  id: "primary" | "secondary",
  initialScene: Scene,
  outcome: SceneUpdateOutcome,
  reject = false,
): FakeSlot {
  const viewport = {
    scene: initialScene,
    results: { state: outcome.results === "cleared" ? undefined : { retained: true } },
    updateScene: vi.fn((operation: (update: SceneUpdate) => void) => {
      if (reject) throw new Error(`${id} update failed`);
      viewport.scene = prepareSceneUpdate(viewport.scene, operation) ?? viewport.scene;
      viewport.results.state = outcome.results === "cleared" ? undefined : { retained: true };
      return outcome;
    }),
    replaceScene: vi.fn((next: Scene) => {
      viewport.scene = next;
      viewport.results.state = undefined;
    }),
    render: vi.fn(),
  };
  return {
    slot: { id, viewport } as unknown as WorkbenchViewportSlot,
    viewport,
    presentationRestored: false,
  };
}

function ownerFor(
  initialModel: WorkbenchModel,
  slots: readonly WorkbenchViewportSlot[],
  applyState = (_slotId: "primary" | "secondary") => undefined,
) {
  const states = new Map<
    "primary" | "secondary",
    {
      resultMode: "base" | "colored" | "deformed";
      scalarFieldId: string;
      resultPlaybackActive: boolean;
      resultPlaybackPlaying: boolean;
    }
  >(
    slots.map((slot) => [
      slot.id,
      {
        resultMode: "base" as const,
        scalarFieldId: "__base__",
        resultPlaybackActive: false,
        resultPlaybackPlaying: false,
      },
    ]),
  );
  const primary = slots[0];
  if (primary === undefined) throw new Error("live edit requires a primary slot");
  const catalog = new WorkbenchModelCatalog([initialModel], []);
  const owner = {
    model: initialModel,
    livePartDialog: { kind: "add" as const },
    viewport: primary.viewport,
    viewportSlots: { all: () => slots },
    presentation: { setFeedback: vi.fn() },
    showState: (slotId: "primary" | "secondary") => {
      const state = states.get(slotId);
      if (state === undefined) throw new Error(`missing ${slotId} show state`);
      return state;
    },
    applyState: vi.fn((slotId: "primary" | "secondary") => {
      applyState(slotId);
    }),
    visibilityPanel: { rebuild: vi.fn() },
    runtime: { partOccurrenceCount: 2 },
    render: vi.fn(),
    publishSnapshot: vi.fn(),
    catalog,
    models: catalog.models,
  };
  return owner;
}

function slotFor(id: string, primary: FakeSlot, secondary: FakeSlot): FakeSlot {
  return id === "primary" ? primary : secondary;
}

function scene(): Scene {
  const part = createPart(1, {
    geometries: [
      {
        primitive: "points",
        positions: new Float32Array([0, 0, 0]),
        indices: new Uint32Array([0]),
      },
    ],
  });
  return createSceneBuilder()
    .addPart(part)
    .addAssembly({
      id: 1,
      placements: [{ kind: "part", partId: 1, placementId: "source", transform: identityMatrix() }],
    })
    .setRootAssembly(1)
    .build();
}

function model(scene: Scene): WorkbenchModel {
  return {
    id: "live-edit-test",
    name: "Live edit test",
    source: "example",
    scene,
    elementModels: new Map(),
    partNames: new Map([[1, "Source"]]),
    partStyles: new Map(),
    bounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
    results: undefined,
    issues: [],
  };
}
