import { describe, expect, it, vi } from "vitest";
import {
  createElementModelFromFemModel,
  createModelBuilder,
  IoError,
  LINE_SHAPE,
  TET4_SHAPE,
  TRIANGLE_SHAPE,
} from "../../../src/index";

describe("createElementModelFromFemModel", () => {
  it("converts an empty interchange model", () => {
    const result = createElementModelFromFemModel(createModelBuilder().build());

    expect(result.elements).toEqual([]);
    expect(result.nodes).toHaveLength(0);
  });

  it("converts mixed interchange blocks without partitioning the source", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 1, 2, 3, 4], [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 2, 0, 0]);
    builder.openElementShapeBlock(TRIANGLE_SHAPE);
    builder.appendElements([11], [0, 1, 2]);
    builder.openElementShapeBlock(TET4_SHAPE);
    builder.appendElements([12], [0, 1, 2, 3]);
    builder.openElementShapeBlock(LINE_SHAPE);
    builder.appendElements([13], [3, 4]);

    const result = createElementModelFromFemModel(builder.build());

    expect(result.elements.map((element) => [element.id, element.shape.family])).toEqual([
      [11, "triangle"],
      [12, "tet"],
      [13, "line"],
    ]);
    expect([...result.nodes]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 2, 0, 0]);
  });

  it("preserves the largest element id supported by the render model", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    builder.openElementShapeBlock(TRIANGLE_SHAPE);
    builder.appendElements([0xffff_fffe], [0, 1, 2]);

    const result = createElementModelFromFemModel(builder.build());

    expect(result.elements[0]?.id).toBe(0xffff_fffe);
  });

  it("reports out-of-range connectivity as an interchange diagnostic", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    builder.openElementShapeBlock(TRIANGLE_SHAPE);
    builder.appendElements([1], [0, 1, 3]);

    expect(() => createElementModelFromFemModel(builder.build())).toThrow(
      expect.objectContaining({
        name: "IoError",
        issues: [expect.objectContaining({ code: "missing-node" })],
      }),
    );
  });

  it("converts interchange coordinates to the render model's single precision", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 1], [1_000_000_000, 0, 0, 1_000_000_001, 0, 0]);

    const result = createElementModelFromFemModel(builder.build());

    expect(result.nodes).toBeInstanceOf(Float32Array);
    expect(result.nodes[0]).toBe(result.nodes[3]);
  });

  it("does not slice typed connectivity while converting elements", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    builder.openElementShapeBlock(TRIANGLE_SHAPE);
    builder.appendElements([1, 2], [0, 1, 2, 2, 1, 0]);
    const model = builder.build();
    const slice = vi.spyOn(Uint32Array.prototype, "slice").mockImplementation(() => {
      throw new Error("conversion must not slice typed connectivity");
    });

    try {
      const result = createElementModelFromFemModel(model);
      expect(result.elements.map((element) => element.nodeIds)).toEqual([
        [0, 1, 2],
        [2, 1, 0],
      ]);
    } finally {
      slice.mockRestore();
    }
  });

  it("keeps each converted connectivity collection owned and isolated", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    builder.openElementShapeBlock(TRIANGLE_SHAPE);
    builder.appendElements([1, 2], [0, 1, 2, 2, 1, 0]);
    const model = builder.build();
    const result = createElementModelFromFemModel(model);
    const first = result.elements[0];
    const second = result.elements[1];
    const sourceConnectivity = model.elementShapeBlocks[0]?.connectivity;
    if (first === undefined || second === undefined || sourceConnectivity === undefined) {
      throw new Error("expected two converted elements and one source block");
    }

    sourceConnectivity[0] = 2;
    expect(first.nodeIds).toEqual([0, 1, 2]);
    expect(second.nodeIds).toEqual([2, 1, 0]);
    expect(first.nodeIds).not.toBe(second.nodeIds);
  });

  it("preserves duplicate connectivity rejection at the conversion boundary", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    builder.openElementShapeBlock(TRIANGLE_SHAPE);
    builder.appendElements([1], [0, 1, 1]);

    expect(() => createElementModelFromFemModel(builder.build())).toThrow(
      "references node 1 more than once",
    );
  });

  it("reports non-dense interchange node ids as conversion diagnostics", () => {
    const builder = createModelBuilder();
    builder.appendNodes([10, 20, 30], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    builder.openElementShapeBlock(TRIANGLE_SHAPE);
    builder.appendElements([1], [10, 20, 30]);

    expect(() => createElementModelFromFemModel(builder.build())).toThrow(
      expect.objectContaining({
        name: "IoError",
        issues: [expect.objectContaining({ code: "non-dense-node-ids" })],
      }),
    );
  });

  it("preserves all model validation issues in the typed error", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    builder.openElementShapeBlock(TRIANGLE_SHAPE);
    builder.appendElements([1, 1], [0, 1, 2, 0, 1, 2]);

    try {
      createElementModelFromFemModel(builder.build());
      throw new Error("expected conversion to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(IoError);
      expect((error as IoError).issues).toEqual([
        expect.objectContaining({ code: "duplicate-element-id" }),
      ]);
    }
  });
});
