import { describe, expect, it } from "vitest";
import {
  createResultField,
  createScalarColorMap,
  type ViewportElementVectorState,
  type PickHit,
  type ViewportScalarState,
  type ViewportResultsState,
} from "../../src/index";
import { describePick } from "../../demo/workbench/inspect";

describe("demo result inspection", () => {
  it("shows the exact nodal value only for a node hit", () => {
    const field = createResultField({
      id: "temperature",
      name: "Temperature",
      location: "nodal",
      shape: "scalar",
      count: 3,
      unit: "C",
      values: new Float32Array([10, 20.5, Number.NaN]),
    });
    const results = resultState(field);
    const node = nodeHit(1);
    const face = faceHit(1);

    expect(describePick(node, undefined, results)).toContain("Temperature (nodal, C): 20.5");
    expect(describePick(face, undefined, results)).not.toContain("Temperature");
  });

  it("shows elemental values for owning element hits and labels missing data", () => {
    const field = createResultField({
      id: "stress",
      name: "Stress",
      location: "elemental",
      shape: "scalar",
      count: 3,
      unit: "MPa",
      values: new Float32Array([5, Number.NaN, 15]),
    });
    const results = resultState(field);

    expect(describePick(faceHit(1), undefined, results)).toContain(
      "Stress (elemental, MPa): missing",
    );
    expect(describePick(nodeHit(2, 2), undefined, results)).toContain(
      "Stress (elemental, MPa): 15",
    );
  });

  it("does not invent an elemental result for a standalone node hit", () => {
    const field = createResultField({
      id: "stress",
      name: "Stress",
      location: "elemental",
      shape: "scalar",
      count: 3,
      unit: "MPa",
      values: new Float32Array([5, 10, 15]),
    });

    expect(describePick(nodeHit(2), undefined, resultState(field))).not.toContain("Stress");
  });

  it("shows raw authored vector values and explicit missing/zero presentation states", () => {
    const field = createResultField({
      id: "orientation",
      name: "Orientation",
      location: "elemental",
      shape: "vector",
      count: 3,
      unit: "unitless",
      values: new Float32Array([1, 0.25, 0, Number.NaN, Number.NaN, Number.NaN, 0, 0, 0]),
    });
    const results = vectorResultState(field);
    expect(describePick(faceHit(0), undefined, results)).toContain(
      "Orientation (elemental, unitless): [1, 0.25, 0]",
    );
    expect(describePick(faceHit(1), undefined, results)).toContain("missing (not drawn)");
    expect(describePick(faceHit(2), undefined, results)).toContain("zero (not drawn)");
    expect(describePick(nodeHit(0), undefined, results)).not.toContain("Orientation");
  });
});

function resultState(field: ViewportScalarState["field"]): ViewportResultsState {
  const scalar: ViewportScalarState = {
    config: { field },
    field,
    range: { min: 0, max: 20 },
    colorMap: createScalarColorMap({ min: 0, max: 20 }),
  };
  return {
    config: { scalar: { field } },
    scalar,
    deformation: undefined,
    vectors: undefined,
  };
}

function vectorResultState(field: ViewportElementVectorState["field"]): ViewportResultsState {
  const vectors: ViewportElementVectorState = {
    config: { field, glyph: "arrow", transform: "normal" },
    field,
    glyph: "arrow",
    transform: "normal",
    lengthScale: 1,
  };
  return {
    config: { vectors: vectors.config },
    scalar: undefined,
    deformation: undefined,
    vectors,
  };
}

function nodeHit(nodeId: number, elementId?: number): PickHit {
  return {
    kind: "node",
    partId: 1,
    instanceId: "instance-1",
    ...(elementId === undefined ? {} : { elementId }),
    nodeId,
    localPosition: [0, 0, 0],
    worldPosition: [0, 0, 0],
    neighborElementIds: [0],
    neighborNodeIds: [0, 1],
  };
}

function faceHit(elementId: number): PickHit {
  return {
    kind: "face",
    partId: 1,
    instanceId: "instance-1",
    elementId,
    faceIndex: 0,
    key: "0:0:1:2",
    nodeIds: [0, 1, 2],
    neighborElementIds: [elementId],
    worldPosition: [0, 0, 0],
    normal: [0, 0, 1],
  };
}
