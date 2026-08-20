import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  resolveBodyStyle,
  resolveElementStyle,
  type InteractionState,
  type ResolvedStyle,
} from "../../src/interaction/interaction";
import { setBodyHighlighted, setBodySelected } from "../../src/interaction/bodies";
import { setFaceSelected, resolveFaceStyle } from "../../src/interaction/faces";
import { setNodeSelected, resolveNodeStyle } from "../../src/interaction/nodes";
import { setElementSelected } from "../../src/interaction/interaction";
import {
  setPartOccurrenceHighlighted,
  setPartHighlighted,
} from "../../src/interaction/interaction";
import { identityMatrix } from "../../src/math/mat4";
import type { PartOccurrence } from "../../src/scene/types";

const base: ResolvedStyle = {
  color: { r: 0.2, g: 0.3, b: 0.4, a: 1 },
  emissive: 0,
  opacity: 1,
  lineWidthPixels: 2,
  edge: false,
  nodes: false,
};
const item: PartOccurrence = {
  partOccurrenceId: "1/0",
  partId: 1,
  worldTransform: identityMatrix(),
};
const bodyRef = { partOccurrenceId: "1/0", bodyId: 3 } as const;
const elementRef = { partOccurrenceId: "1/0", elementId: 4 } as const;
const faceRef = { partOccurrenceId: "1/0", elementId: 4, faceIndex: 0 } as const;
const nodeRef = { partOccurrenceId: "1/0", nodeId: 7 } as const;

interface PrecedenceCase {
  readonly name: string;
  readonly apply: (state: InteractionState) => InteractionState;
  readonly resolve: (state: InteractionState) => ResolvedStyle;
  readonly expected: Pick<ResolvedStyle, "color" | "emissive">;
}

const cases: readonly PrecedenceCase[] = [
  {
    name: "body",
    apply: (state) => setBodySelected(state, bodyRef, true),
    resolve: (state) => resolveBodyStyle(item, bodyRef.bodyId, base, state),
    expected: { color: { r: 0.95, g: 0.5, b: 0.1, a: 1 }, emissive: 0.35 },
  },
  {
    name: "element",
    apply: (state) => setElementSelected(state, elementRef, true),
    resolve: (state) =>
      resolveElementStyle(item, elementRef.elementId, base, state, bodyRef.bodyId),
    expected: { color: { r: 0.95, g: 0.5, b: 0.1, a: 1 }, emissive: 0.35 },
  },
  {
    name: "face",
    apply: (state) => setFaceSelected(state, faceRef, true),
    resolve: (state) => resolveFaceStyle(item, faceRef, base, state, bodyRef.bodyId),
    expected: { color: { r: 0.95, g: 0.5, b: 0.1, a: 1 }, emissive: 0.35 },
  },
  {
    name: "node",
    apply: (state) => setNodeSelected(state, nodeRef, true),
    resolve: (state) => resolveNodeStyle(item, nodeRef, base, state, bodyRef.bodyId),
    expected: { color: { r: 0.95, g: 0.5, b: 0.1, a: 1 }, emissive: 0.35 },
  },
];

describe("interaction precedence", () => {
  it.each(cases)("applies the $name layer after part, instance, and body state", (testCase) => {
    let state = createInteractionState();
    state = setPartHighlighted(state, item.partId, true);
    state = setPartOccurrenceHighlighted(state, item.partOccurrenceId, true);
    state = setBodyHighlighted(state, bodyRef, true);
    state = testCase.apply(state);
    expect(testCase.resolve(state)).toMatchObject(testCase.expected);
  });

  it("keeps the resolved alpha of a translucent face under selection tint", () => {
    const translucent: ResolvedStyle = {
      ...base,
      color: { ...base.color, a: 0.28 },
      opacity: 0.6,
    };
    const state = setFaceSelected(createInteractionState(), faceRef, true);
    expect(resolveFaceStyle(item, faceRef, translucent, state)).toMatchObject({
      color: { r: 0.95, g: 0.5, b: 0.1, a: 0.28 },
      opacity: 0.6,
    });
  });
});
