import { describe, expect, it } from "vitest";
import {
  createElementModelFromFemModel,
  createModelBuilder,
  IoError,
  LINE_SHAPE,
  TET4_SHAPE,
  TRIANGLE_SHAPE,
} from "../../src/index";

describe("createElementModelFromFemModel", () => {
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

  it("converts interchange coordinates to the render model's single precision", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 1], [1_000_000_000, 0, 0, 1_000_000_001, 0, 0]);

    const result = createElementModelFromFemModel(builder.build());

    expect(result.nodes).toBeInstanceOf(Float32Array);
    expect(result.nodes[0]).toBe(result.nodes[3]);
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
