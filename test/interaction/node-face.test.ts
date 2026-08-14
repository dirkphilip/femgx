import { describe, expect, it } from "vitest";
import {
  setFaceHighlighted,
  setFaceSelected,
  emphasizedFaceRefs,
  resolveFaceStyle,
} from "../../src/interaction/faces";
import { resolveEdgeStyle, setEdgeSelected } from "../../src/interaction/edges";
import {
  createInteractionState,
  resolveElementStyle,
  setElementSelected,
  type ResolvedStyle,
} from "../../src/interaction/interaction";
import {
  setNodeHighlighted,
  setNodeSelected,
  emphasizedNodeRefs,
  resolveNodeStyle,
} from "../../src/interaction/nodes";
import { setTargetHovered } from "../../src/interaction/targets";
import { identity } from "../../src/math/mat4";
import type { Instance } from "../../src/scene/types";
import { readInteractionState } from "../../src/interaction/state";

const base: ResolvedStyle = {
  color: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
  emissive: 0,
  opacity: 1,
  lineWidthPixels: 2,
  edge: false,
  nodes: false,
};
const item: Instance = { index: 0, instanceId: "1/0", partId: 1, worldTransform: identity() };

const nodeRef = { instanceId: "1/0", nodeId: 7 };
const otherNodeRef = { instanceId: "1/0", nodeId: 8 };
const faceRef = { instanceId: "1/0", elementId: 3, faceIndex: 0 };
const otherFaceRef = { instanceId: "2/0", elementId: 5, faceIndex: 1 };
const edgeRef = { instanceId: "1/0", key: "7:8" };
const selectionColor = { r: 0.95, g: 0.5, b: 0.1, a: 1 };

describe("selection color", () => {
  it("uses one color for nodes, faces, edges, and elements including point elements", () => {
    let state = createInteractionState();
    state = setNodeSelected(state, nodeRef, true);
    state = setFaceSelected(state, faceRef, true);
    state = setEdgeSelected(state, edgeRef, true);
    state = setElementSelected(
      state,
      { instanceId: item.instanceId, elementId: faceRef.elementId },
      true,
    );

    expect(resolveNodeStyle(item, nodeRef, base, state).color).toEqual(selectionColor);
    expect(resolveFaceStyle(item, faceRef, base, state).color).toEqual(selectionColor);
    expect(resolveEdgeStyle(item, edgeRef, base, state).color).toEqual(selectionColor);
    expect(resolveElementStyle(item, faceRef.elementId, base, state).color).toEqual(selectionColor);
  });
});

describe("node selection state", () => {
  it("tracks selections per instance immutably", () => {
    const state = setNodeSelected(createInteractionState(), nodeRef, true);
    expect(readInteractionState(state).selectedNodeIds.get("1/0")?.has(7)).toBe(true);
    const cleared = setNodeSelected(state, nodeRef, false);
    expect(readInteractionState(cleared).selectedNodeIds.get("1/0")).toBeUndefined();
  });

  it("sets and clears hover immutably", () => {
    const initial = createInteractionState();
    const state = setTargetHovered(initial, { kind: "node", ...nodeRef });
    expect(readInteractionState(state).hoveredTarget).toEqual({ kind: "node", ...nodeRef });
    expect(setTargetHovered(state, { kind: "node", ...nodeRef })).toBe(state);
    expect(setTargetHovered(state, undefined)).not.toHaveProperty("hoveredTarget");
  });
});

describe("node emphasis collection", () => {
  it("collects emphasized nodes in deterministic order without duplicates", () => {
    let state = createInteractionState();
    state = setNodeSelected(state, nodeRef, true);
    state = setNodeHighlighted(state, otherNodeRef, true);
    state = setTargetHovered(state, { kind: "node", ...nodeRef });
    expect(emphasizedNodeRefs(state)).toEqual([nodeRef, otherNodeRef]);
  });
});

describe("face selection state", () => {
  it("tracks selections per instance immutably with their element", () => {
    const state = setFaceSelected(createInteractionState(), faceRef, true);
    expect(readInteractionState(state).selectedFaces.get("1/0")?.get("3/0")).toEqual(faceRef);
    const cleared = setFaceSelected(state, faceRef, false);
    expect(readInteractionState(cleared).selectedFaces.has("1/0")).toBe(false);
  });

  it("sets and clears hover immutably", () => {
    const state = setTargetHovered(createInteractionState(), {
      kind: "face",
      instanceId: faceRef.instanceId,
      elementId: faceRef.elementId,
      faceIndex: faceRef.faceIndex,
    });
    expect(readInteractionState(state).hoveredTarget).toEqual({
      kind: "face",
      instanceId: faceRef.instanceId,
      elementId: faceRef.elementId,
      faceIndex: faceRef.faceIndex,
    });
    expect(
      setTargetHovered(state, {
        kind: "face",
        instanceId: faceRef.instanceId,
        elementId: faceRef.elementId,
        faceIndex: faceRef.faceIndex,
      }),
    ).toBe(state);
    expect(setTargetHovered(state, undefined)).not.toHaveProperty("hoveredTarget");
  });
});

describe("face emphasis collection", () => {
  it("collects emphasized faces in deterministic order without duplicates", () => {
    let state = createInteractionState();
    state = setFaceSelected(state, faceRef, true);
    state = setFaceHighlighted(state, otherFaceRef, true);
    state = setTargetHovered(state, {
      kind: "face",
      instanceId: faceRef.instanceId,
      elementId: faceRef.elementId,
      faceIndex: faceRef.faceIndex,
    });
    expect(emphasizedFaceRefs(state)).toEqual([faceRef, otherFaceRef]);
  });
});

describe("resolveNodeStyle", () => {
  it("applies node hover over the base instance style", () => {
    const state = setTargetHovered(createInteractionState(), { kind: "node", ...nodeRef });
    expect(resolveNodeStyle(item, nodeRef, base, state)).toMatchObject({ emissive: 0.45 });
    expect(resolveNodeStyle(item, otherNodeRef, base, state)).toBe(base);
  });

  it("keeps node hover visible over selection", () => {
    const state = setNodeSelected(
      setTargetHovered(createInteractionState(), { kind: "node", ...nodeRef }),
      nodeRef,
      true,
    );
    expect(resolveNodeStyle(item, nodeRef, base, state)).toMatchObject({
      color: { r: 0.95, g: 0.5, b: 0.1, a: 1 },
    });
  });

  it("applies node highlight under hover", () => {
    const state = setNodeHighlighted(createInteractionState(), nodeRef, true);
    expect(resolveNodeStyle(item, nodeRef, base, state)).toMatchObject({ emissive: 0.35 });
  });
});

describe("resolveFaceStyle", () => {
  it("applies face hover over the base instance style", () => {
    const state = setTargetHovered(createInteractionState(), {
      kind: "face",
      instanceId: faceRef.instanceId,
      elementId: faceRef.elementId,
      faceIndex: faceRef.faceIndex,
    });
    expect(resolveFaceStyle(item, faceRef, base, state)).toMatchObject({ emissive: 0.3 });
    expect(resolveFaceStyle(item, otherFaceRef, base, state)).toBe(base);
  });

  it("keeps face hover visible over selection", () => {
    const state = setFaceSelected(
      setTargetHovered(createInteractionState(), {
        kind: "face",
        instanceId: faceRef.instanceId,
        elementId: faceRef.elementId,
        faceIndex: faceRef.faceIndex,
      }),
      faceRef,
      true,
    );
    expect(resolveFaceStyle(item, faceRef, base, state)).toMatchObject({
      color: { r: 0.95, g: 0.5, b: 0.1, a: 1 },
    });
  });

  it("applies face highlight under hover", () => {
    const state = setFaceHighlighted(createInteractionState(), faceRef, true);
    expect(resolveFaceStyle(item, faceRef, base, state)).toMatchObject({ emissive: 0.35 });
  });
});
