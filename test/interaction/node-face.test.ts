import { describe, expect, it } from "vitest";
import {
  setFaceHighlighted,
  setFaceSelected,
  setHoveredFace,
  emphasizedFaceRefs,
  resolveFaceStyle,
} from "../../src/interaction/faces";
import { createInteractionState, type ResolvedStyle } from "../../src/interaction/interaction";
import {
  setHoveredNode,
  setNodeHighlighted,
  setNodeSelected,
  emphasizedNodeRefs,
  resolveNodeStyle,
} from "../../src/interaction/nodes";
import { identity } from "../../src/math/mat4";
import type { Instance } from "../../src/scene/types";

const base: ResolvedStyle = {
  color: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
  emissive: 0,
  opacity: 1,
  edge: false,
};
const item: Instance = { index: 0, instanceId: "1/0", partId: 1, worldTransform: identity() };

const nodeRef = { instanceId: "1/0", nodeId: 7 };
const otherNodeRef = { instanceId: "1/0", nodeId: 8 };
const faceRef = { instanceId: "1/0", elementId: 3, faceKey: "0,1,2,3" };
const otherFaceRef = { instanceId: "2/0", elementId: 5, faceKey: "4,5,6,7" };

describe("node selection state", () => {
  it("tracks selections per instance immutably", () => {
    const state = setNodeSelected(createInteractionState(), nodeRef, true);
    expect(state.selectedNodeIds.get("1/0")?.has(7)).toBe(true);
    expect(setNodeSelected(state, nodeRef, true)).toBe(state);
    const cleared = setNodeSelected(state, nodeRef, false);
    expect(cleared.selectedNodeIds.get("1/0")).toBeUndefined();
  });

  it("removes the per-instance entry when the last node is deselected", () => {
    const state = setNodeSelected(createInteractionState(), nodeRef, true);
    const cleared = setNodeSelected(state, nodeRef, false);
    expect(cleared.selectedNodeIds.has("1/0")).toBe(false);
  });

  it("sets and clears hover immutably", () => {
    const initial = createInteractionState();
    const state = setHoveredNode(initial, nodeRef);
    expect(state.hoveredNode).toEqual(nodeRef);
    expect(setHoveredNode(state, nodeRef)).toBe(state);
    expect(setHoveredNode(state, undefined)).not.toHaveProperty("hoveredNode");
  });
});

describe("node emphasis collection", () => {
  it("collects emphasized nodes in deterministic order without duplicates", () => {
    let state = createInteractionState();
    state = setNodeSelected(state, nodeRef, true);
    state = setNodeHighlighted(state, otherNodeRef, true);
    state = setHoveredNode(state, nodeRef);
    expect(emphasizedNodeRefs(state)).toEqual([nodeRef, otherNodeRef]);
  });
});

describe("face selection state", () => {
  it("tracks selections per instance immutably with their element", () => {
    const state = setFaceSelected(createInteractionState(), faceRef, true);
    expect(state.selectedFaces.get("1/0")?.get("0,1,2,3")).toBe(3);
    expect(setFaceSelected(state, faceRef, true)).toBe(state);
    const cleared = setFaceSelected(state, faceRef, false);
    expect(cleared.selectedFaces.has("1/0")).toBe(false);
  });

  it("sets and clears hover immutably", () => {
    const state = setHoveredFace(createInteractionState(), faceRef);
    expect(state.hoveredFace).toEqual(faceRef);
    expect(setHoveredFace(state, faceRef)).toBe(state);
    expect(setHoveredFace(state, undefined)).not.toHaveProperty("hoveredFace");
  });
});

describe("face emphasis collection", () => {
  it("collects emphasized faces in deterministic order without duplicates", () => {
    let state = createInteractionState();
    state = setFaceSelected(state, faceRef, true);
    state = setFaceHighlighted(state, otherFaceRef, true);
    state = setHoveredFace(state, faceRef);
    expect(emphasizedFaceRefs(state)).toEqual([faceRef, otherFaceRef]);
  });
});

describe("resolveNodeStyle", () => {
  it("applies node hover over the base instance style", () => {
    const state = setHoveredNode(createInteractionState(), nodeRef);
    expect(resolveNodeStyle(item, nodeRef, base, state)).toMatchObject({ emissive: 0.45 });
    expect(resolveNodeStyle(item, otherNodeRef, base, state)).toBe(base);
  });

  it("applies node selection over hover", () => {
    const state = setNodeSelected(setHoveredNode(createInteractionState(), nodeRef), nodeRef, true);
    expect(resolveNodeStyle(item, nodeRef, base, state)).toMatchObject({
      color: { r: 1, g: 0.42, b: 0.12, a: 1 },
      emissive: 0.7,
    });
  });

  it("applies node highlight under hover", () => {
    const state = setNodeHighlighted(createInteractionState(), nodeRef, true);
    expect(resolveNodeStyle(item, nodeRef, base, state)).toMatchObject({ emissive: 0.35 });
  });
});

describe("resolveFaceStyle", () => {
  it("applies face hover over the base instance style", () => {
    const state = setHoveredFace(createInteractionState(), faceRef);
    expect(resolveFaceStyle(item, faceRef, base, state)).toMatchObject({ emissive: 0.3 });
    expect(resolveFaceStyle(item, otherFaceRef, base, state)).toBe(base);
  });

  it("applies face selection over hover", () => {
    const state = setFaceSelected(setHoveredFace(createInteractionState(), faceRef), faceRef, true);
    expect(resolveFaceStyle(item, faceRef, base, state)).toMatchObject({
      color: { r: 0.45, g: 1, b: 0.4, a: 1 },
      emissive: 0.5,
    });
  });

  it("applies face highlight under hover", () => {
    const state = setFaceHighlighted(createInteractionState(), faceRef, true);
    expect(resolveFaceStyle(item, faceRef, base, state)).toMatchObject({ emissive: 0.35 });
  });
});
