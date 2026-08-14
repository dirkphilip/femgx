import { describe, expect, it } from "vitest";
import {
  createResultField,
  createScalarColorMap,
  type PickHit,
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
});

function resultState(field: ViewportResultsState["scalarField"]): ViewportResultsState {
  return {
    config: { field },
    scalarField: field,
    range: { min: 0, max: 20 },
    colorMap: createScalarColorMap({ min: 0, max: 20 }),
    deformation: undefined,
  };
}

function nodeHit(nodeId: number, elementId = 0): PickHit {
  return {
    kind: "node",
    partId: 1,
    instanceId: "instance-1",
    elementId,
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
