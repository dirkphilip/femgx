import { describe, expect, it } from "vitest";
import { required } from "./assertions";
import { createModelBuilder } from "../../src/io/model-builder";
import { validateModel } from "../../src/io/model-validation";
import { ElementShape } from "../../src/elements/shapes";

function validModel() {
  const builder = createModelBuilder();
  builder.appendNodes([0, 1, 2, 3], [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  builder.openElementShapeBlock(ElementShape.Tet4);
  builder.appendElements([1], [0, 1, 2, 3]);
  return builder.build();
}

describe("validateModel", () => {
  it("returns no issues for a valid model", () => {
    expect(validateModel(validModel())).toEqual([]);
  });

  it("flags duplicate node ids", () => {
    const model = validModel();
    model.nodes.ids[1] = 0;
    const codes = validateModel(model).map((issue) => issue.code);
    expect(codes).toContain("duplicate-node-id");
  });

  it("flags a malformed node table", () => {
    const model = validModel();
    const shorter = new Float64Array(model.nodes.coordinates.length - 1);
    shorter.set(model.nodes.coordinates.subarray(0, model.nodes.coordinates.length - 1));
    const issues = validateModel({ ...model, nodes: { ...model.nodes, coordinates: shorter } });
    expect(issues.map((issue) => issue.code)).toContain("node-table-shape");
  });

  it("flags malformed element blocks and unknown nodes", () => {
    const model = validModel();
    const bad = validateModel({
      ...model,
      elementShapeBlocks: [
        { ...required(model.elementShapeBlocks[0]), connectivity: new Uint32Array(3) },
      ],
    });
    expect(bad.map((issue) => issue.code)).toContain("element-block-shape");

    const unknown = validateModel({
      ...model,
      elementShapeBlocks: [
        { ...required(model.elementShapeBlocks[0]), connectivity: new Uint32Array([0, 1, 2, 99]) },
      ],
    });
    expect(unknown.map((issue) => issue.code)).toContain("missing-node");
  });

  it("flags duplicate element ids across blocks", () => {
    const model = validModel();
    const blocks = [...model.elementShapeBlocks, { ...required(model.elementShapeBlocks[0]) }];
    const codes = validateModel({ ...model, elementShapeBlocks: blocks }).map(
      (issue) => issue.code,
    );
    expect(codes).toContain("duplicate-element-id");
  });

  it("flags set references to unknown entities", () => {
    const model = validModel();
    const issues = validateModel({
      ...model,
      sets: [
        { kind: "node", name: "n", ids: new Uint32Array([42]) },
        { kind: "element", name: "e", ids: new Uint32Array([42]) },
      ],
    });
    expect(issues.map((issue) => issue.code)).toEqual(["missing-set-id", "missing-set-id"]);
  });

  it("flags an empty set name", () => {
    const model = validModel();
    const issues = validateModel({
      ...model,
      sets: [{ kind: "node", name: "", ids: new Uint32Array([0]) }],
    });
    expect(issues.map((issue) => issue.code)).toContain("empty-set-name");
  });

  it("flags malformed results and unknown result ids", () => {
    const model = validModel();
    const issues = validateModel({
      ...model,
      results: [
        {
          name: "r",
          location: "node",
          components: 2,
          ids: new Uint32Array([0]),
          values: new Float64Array([1]),
        },
        {
          name: "s",
          location: "node",
          components: 1,
          ids: new Uint32Array([42]),
          values: new Float64Array([1]),
        },
      ],
    });
    expect(issues.map((issue) => issue.code)).toEqual(["result-shape", "missing-result-id"]);
  });
});
