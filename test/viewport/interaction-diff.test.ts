import { describe, expect, it, vi } from "vitest";
import { createPart } from "../../src/geometry/part";
import {
  createInteractionState,
  setElementHighlighted,
  setElementSelected,
  setPartOccurrenceOverride,
  setPartOccurrenceSelected,
  setPartOverride,
  setPartHighlighted,
  type InteractionState,
} from "../../src/interaction/interaction";
import { setTargetHovered } from "../../src/interaction/targets";
import { setFaceHighlighted } from "../../src/interaction/faces";
import { setNodeSelected } from "../../src/interaction/nodes";
import { setElementVisible } from "../../src/interaction/elements";
import { translation } from "../../src/math/mat4";
import { changedInstanceSlots } from "../../src/viewport/interaction-diff";
import {
  createPackedSceneRuntime,
  type PackedSceneRuntime as SceneRuntime,
} from "../../src/scene-runtime/runtime";
import { createScene } from "../../src/scene/scene";

/** A two-part scene: three instances of part 1 (slots 0-2) and two of part 2 (slots 3-4). */
function runtime(): SceneRuntime {
  const geometry = {
    positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0]),
    indices: new Uint32Array([0, 1, 2]),
    primitive: "triangles" as const,
  };
  const place = (partId: number, x: number) => ({
    kind: "part" as const,
    partId,
    transform: translation(x, 0, 0),
  });
  const scene = createScene()
    .addPart(createPart(1, { geometries: [geometry] }))
    .addPart(createPart(2, { geometries: [geometry] }))
    .addAssembly({
      id: 1,
      name: "root",
      placements: [place(1, 0), place(1, 2), place(1, 4), place(2, 6), place(2, 8)],
    })
    .withRoot(1)
    .build();
  return createPackedSceneRuntime(scene);
}

describe("changedInstanceSlots", () => {
  it("returns no slots when the state is unchanged by reference", () => {
    const rt = runtime();
    const state = createInteractionState();
    expect(changedInstanceSlots(rt, state, state)).toEqual([]);
  });

  it("returns no slots for two equal states", () => {
    const rt = runtime();
    expect(changedInstanceSlots(rt, createInteractionState(), createInteractionState())).toEqual(
      [],
    );
  });

  it("reuses runtime identity indexes instead of scanning instance ids", () => {
    const rt = runtime();
    const getInstanceId = vi.spyOn(rt, "getInstanceId");
    const empty = createInteractionState();
    const highlighted = setPartHighlighted(empty, 1, true);

    expect(changedInstanceSlots(rt, empty, highlighted)).toEqual([0, 1, 2]);
    expect(getInstanceId).not.toHaveBeenCalled();
  });

  it("returns every slot of a part when a part highlight is added or cleared", () => {
    const rt = runtime();
    const empty = createInteractionState();
    const highlighted = setPartHighlighted(empty, 1, true);
    expect(changedInstanceSlots(rt, empty, highlighted)).toEqual([0, 1, 2]);
    expect(changedInstanceSlots(rt, highlighted, empty)).toEqual([0, 1, 2]);
  });

  it("returns the slot of an instance when its selection changes", () => {
    const rt = runtime();
    const empty = createInteractionState();
    const selected = setPartOccurrenceSelected(empty, "1/3", true);
    expect(changedInstanceSlots(rt, empty, selected)).toEqual([3]);
    expect(changedInstanceSlots(rt, selected, empty)).toEqual([3]);
  });

  it("returns part slots when a part override value changes or is cleared", () => {
    const rt = runtime();
    const empty = createInteractionState();
    const overridden = setPartOverride(empty, 2, { color: { r: 1, g: 0, b: 0, a: 1 } });
    expect(changedInstanceSlots(rt, empty, overridden)).toEqual([3, 4]);
    const changed = setPartOverride(overridden, 2, { edge: true });
    expect(changedInstanceSlots(rt, overridden, changed)).toEqual([3, 4]);
    const cleared = setPartOverride(changed, 2, undefined);
    expect(changedInstanceSlots(rt, changed, cleared)).toEqual([3, 4]);
  });

  it("returns the slot of an instance when its override changes", () => {
    const rt = runtime();
    const empty = createInteractionState();
    const overridden = setPartOccurrenceOverride(empty, "1/1", { emissive: 0.35 });
    expect(changedInstanceSlots(rt, empty, overridden)).toEqual([1]);
    const cleared = setPartOccurrenceOverride(overridden, "1/1", undefined);
    expect(changedInstanceSlots(rt, overridden, cleared)).toEqual([1]);
  });

  it("returns the previous and next slots when the hovered instance changes", () => {
    const rt = runtime();
    const hovered = setTargetHovered(createInteractionState(), {
      kind: "partOccurrence",
      partOccurrenceId: "1/0",
    });
    const moved = setTargetHovered(hovered, { kind: "partOccurrence", partOccurrenceId: "1/4" });
    expect(changedInstanceSlots(rt, hovered, moved)).toEqual([0, 4]);
    expect(changedInstanceSlots(rt, moved, hovered)).toEqual([0, 4]);
  });

  it("deduplicates slots across part and instance changes in ascending order", () => {
    const rt = runtime();
    const empty = createInteractionState();
    const state = setPartHighlighted(empty, 1, true);
    const state2 = setPartOccurrenceSelected(state, "1/1", true);
    expect(changedInstanceSlots(rt, empty, state2)).toEqual([0, 1, 2]);
  });

  it("ignores element, node, and face emphasis changes", () => {
    const rt = runtime();
    const empty = createInteractionState();
    let state: InteractionState = setElementSelected(
      empty,
      { partOccurrenceId: "1/0", elementId: 0 },
      true,
    );
    state = setNodeSelected(state, { partOccurrenceId: "1/0", nodeId: 0 }, true);
    state = setFaceHighlighted(
      state,
      { partOccurrenceId: "1/0", elementId: 0, faceIndex: 0 },
      true,
    );
    expect(changedInstanceSlots(rt, empty, state)).toEqual([]);
  });

  it("marks an element highlight's owning instance slot dirty", () => {
    const rt = runtime();
    const empty = createInteractionState();
    const highlighted = setElementHighlighted(
      empty,
      { partOccurrenceId: "1/3", elementId: 0 },
      true,
    );
    expect(changedInstanceSlots(rt, empty, highlighted)).toEqual([3]);
    expect(changedInstanceSlots(rt, highlighted, empty)).toEqual([3]);
  });

  it("marks an element visibility change's owning instance slot dirty", () => {
    const rt = runtime();
    const empty = createInteractionState();
    const hidden = setElementVisible(empty, { partOccurrenceId: "1/3", elementId: 0 }, false);
    expect(changedInstanceSlots(rt, empty, hidden)).toEqual([3]);
    expect(changedInstanceSlots(rt, hidden, empty)).toEqual([3]);
  });

  it("ignores stale instance handles from a previous preset", () => {
    const rt = runtime();
    const stale = createInteractionState();
    const staleState = setPartOccurrenceSelected(stale, "old/9", true);
    expect(changedInstanceSlots(rt, staleState, createInteractionState())).toEqual([]);
  });
});
