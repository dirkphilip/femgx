import { describe, expect, it, vi } from "vitest";
import { createElementModelFromFemModel, createFemModelBuilder, IoError } from "@/entries/io";
import { ElementShape } from "@/entries/model";

describe("createElementModelFromFemModel", () => {
  it("converts an empty interchange model", () => {
    const result = createElementModelFromFemModel(createFemModelBuilder().build());

    expect(result.elements.count).toBe(0);
    expect(result.nodes).toHaveLength(0);
  });

  it("converts mixed interchange blocks without partitioning the source", () => {
    const builder = createFemModelBuilder();
    builder.appendNodes([0, 1, 2, 3, 4], [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 2, 0, 0]);
    builder.openElementShapeBlock(ElementShape.Triangle);
    builder.appendElements([11], [0, 1, 2]);
    builder.openElementShapeBlock(ElementShape.Tet4);
    builder.appendElements([12], [0, 1, 2, 3]);
    builder.openElementShapeBlock(ElementShape.Line);
    builder.appendElements([13], [3, 4]);

    const result = createElementModelFromFemModel(builder.build());

    expect([...result.elements].map((element) => [element.id, element.shape])).toEqual([
      [11, ElementShape.Triangle],
      [12, ElementShape.Tet4],
      [13, ElementShape.Line],
    ]);
    expect([...result.nodes]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 2, 0, 0]);
  });

  it("attaches validated body ownership during the single dense conversion", () => {
    const builder = createFemModelBuilder();
    builder.appendNodes([0, 1, 2, 3], [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    builder.openElementShapeBlock(ElementShape.Triangle);
    builder.appendElements([11, 12], [0, 1, 2, 0, 2, 3]);

    const result = createElementModelFromFemModel(builder.build(), {
      bodies: [{ id: 7, name: "plate", elementIds: [11, 12] }],
    });

    expect([...(result.bodies ?? [])]).toEqual([{ id: 7, name: "plate", elementIds: [11, 12] }]);
  });

  it("preserves the largest element id supported by the render model", () => {
    const builder = createFemModelBuilder();
    builder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    builder.openElementShapeBlock(ElementShape.Triangle);
    builder.appendElements([0xffff_fffe], [0, 1, 2]);

    const result = createElementModelFromFemModel(builder.build());

    expect(result.elements.at(0)?.id).toBe(0xffff_fffe);
  });

  it("reports out-of-range connectivity as an interchange diagnostic", () => {
    const builder = createFemModelBuilder();
    builder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    builder.openElementShapeBlock(ElementShape.Triangle);
    builder.appendElements([1], [0, 1, 3]);

    expect(() => createElementModelFromFemModel(builder.build())).toThrow(
      expect.objectContaining({
        name: "IoError",
        issues: [expect.objectContaining({ code: "missing-node" })],
      }),
    );
  });

  it("converts interchange coordinates to the render model's single precision", () => {
    const builder = createFemModelBuilder();
    builder.appendNodes([0, 1], [1_000_000_000, 0, 0, 1_000_000_001, 0, 0]);

    const result = createElementModelFromFemModel(builder.build());

    expect(result.nodes).toBeInstanceOf(Float32Array);
    expect(result.nodes[0]).toBe(result.nodes[3]);
  });

  it("does not slice typed connectivity while converting elements", () => {
    const builder = createFemModelBuilder();
    builder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    builder.openElementShapeBlock(ElementShape.Triangle);
    builder.appendElements([1, 2], [0, 1, 2, 2, 1, 0]);
    const model = builder.build();
    const slice = vi.spyOn(Uint32Array.prototype, "slice").mockImplementation(() => {
      throw new Error("conversion must not slice typed connectivity");
    });

    try {
      const result = createElementModelFromFemModel(model);
      expect([...result.elements].map((element) => element.nodeIds)).toEqual([
        [0, 1, 2],
        [2, 1, 0],
      ]);
    } finally {
      slice.mockRestore();
    }
  });

  it("keeps each converted connectivity collection owned and isolated", () => {
    const builder = createFemModelBuilder();
    builder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    builder.openElementShapeBlock(ElementShape.Triangle);
    builder.appendElements([1, 2], [0, 1, 2, 2, 1, 0]);
    const model = builder.build();
    const result = createElementModelFromFemModel(model);
    const first = result.elements.at(0);
    const second = result.elements.at(1);
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
    const builder = createFemModelBuilder();
    builder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    builder.openElementShapeBlock(ElementShape.Triangle);
    builder.appendElements([1], [0, 1, 1]);

    expect(() => createElementModelFromFemModel(builder.build())).toThrow(
      "references node 1 more than once",
    );
  });

  it("preserves sparse interchange node ids in compact authored order", () => {
    const builder = createFemModelBuilder();
    builder.appendNodes([10, 20, 30], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    builder.openElementShapeBlock(ElementShape.Triangle);
    builder.appendElements([1], [10, 20, 30]);

    const converted = createElementModelFromFemModel(builder.build());
    expect(Array.from(converted.nodeIds)).toEqual([10, 20, 30]);
    expect(Array.from(converted.elementNodeIds)).toEqual([10, 20, 30]);
  });

  it("preserves all model validation issues in the typed error", () => {
    const builder = createFemModelBuilder();
    builder.appendNodes([0, 1, 2], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    builder.openElementShapeBlock(ElementShape.Triangle);
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
