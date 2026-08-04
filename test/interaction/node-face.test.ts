import { describe, expect, it } from "vitest";
import {
  setFaceHighlighted,
  setFaceSelected,
  setHoveredFace,
  emphasizedFaceRefs,
} from "../../src/interaction/faces";
import { createInteractionState } from "../../src/interaction/interaction";
import {
  setHoveredNode,
  setNodeHighlighted,
  setNodeSelected,
  emphasizedNodeRefs,
} from "../../src/interaction/nodes";

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
