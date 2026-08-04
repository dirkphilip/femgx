import { describe, expect, it } from "vitest";
import { required } from "./helpers";
import { createModelBuilder } from "../../src/io/build";
import { IoError } from "../../src/io/diagnostics";
import { TET4_SHAPE, HEX8_SHAPE } from "../../src/elements/shapes";

describe("createModelBuilder", () => {
  it("builds an empty model with the current format version", () => {
    const model = createModelBuilder().build();
    expect(model.formatVersion).toBe(1);
    expect(model.nodes.count).toBe(0);
    expect(model.elementBlocks).toEqual([]);
    expect(model.sets).toEqual([]);
    expect(model.metadata).toEqual({});
    expect(model.results).toEqual([]);
  });

  it("accumulates chunked nodes without materializing objects", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 1], [0, 0, 0, 1, 0, 0]);
    builder.appendNodes([2], [0, 1, 0]);
    const model = builder.build();
    expect(model.nodes.count).toBe(3);
    expect([...model.nodes.ids]).toEqual([0, 1, 2]);
    expect([...model.nodes.coordinates]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(builder.nodeCount).toBe(3);
  });

  it("groups elements into shape blocks, closing the open block implicitly", () => {
    const builder = createModelBuilder();
    builder.openElementBlock(TET4_SHAPE);
    builder.appendElements([1], [0, 1, 2, 3]);
    builder.openElementBlock(HEX8_SHAPE);
    builder.appendElements([2], [0, 1, 2, 3, 4, 5, 6, 7]);
    const model = builder.build();
    expect(model.elementBlocks.map((block) => block.shape.family)).toEqual(["tet", "hex"]);
    expect(model.elementBlocks[0]?.count).toBe(1);
    expect(model.elementBlocks[1]?.count).toBe(1);
    expect(builder.elementCount).toBe(2);
  });

  it("rejects nodes whose coordinate count does not match ids", () => {
    const builder = createModelBuilder();
    expect(() => {
      builder.appendNodes([0], [0, 0]);
    }).toThrow(IoError);
  });

  it("rejects element connectivity that does not match the block shape", () => {
    const builder = createModelBuilder();
    builder.openElementBlock(TET4_SHAPE);
    expect(() => {
      builder.appendElements([1], [0, 1, 2]);
    }).toThrow(IoError);
  });

  it("rejects appendElements without an open block", () => {
    const builder = createModelBuilder();
    expect(() => {
      builder.appendElements([1], [0, 1, 2, 3]);
    }).toThrow(IoError);
  });

  it("rejects non-integer ids", () => {
    const builder = createModelBuilder();
    expect(() => {
      builder.appendNodes([1.5], [0, 0, 0]);
    }).toThrow(IoError);
    expect(() => {
      builder.addSet("node", "s", [-1]);
    }).toThrow(IoError);
  });

  it("adds sets, metadata, and results in insertion order", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0, 1], [0, 0, 0, 1, 0, 0]);
    builder.addSet("node", "nset", [1]);
    builder.setMetadata("units", "mm");
    builder.setMetadata("count", 2);
    builder.addResult({
      name: "displacement",
      location: "node",
      components: 3,
      ids: new Uint32Array([0, 1]),
      values: new Float64Array([1, 2, 3, 4, 5, 6]),
    });
    const model = builder.build();
    expect(model.sets).toEqual([{ kind: "node", name: "nset", ids: new Uint32Array([1]) }]);
    expect(model.metadata).toEqual({ units: "mm", count: 2 });
    expect(model.results).toHaveLength(1);
    expect(model.results[0]?.name).toBe("displacement");
    expect([...required(model.results[0]).values]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("rejects empty set names and metadata keys", () => {
    const builder = createModelBuilder();
    expect(() => {
      builder.addSet("node", "", [0]);
    }).toThrow(IoError);
    expect(() => {
      builder.setMetadata("", 1);
    }).toThrow(IoError);
  });

  it("rejects malformed results", () => {
    const builder = createModelBuilder();
    expect(() => {
      builder.addResult({
        name: "",
        location: "node",
        components: 1,
        ids: new Uint32Array([0]),
        values: new Float64Array([1]),
      });
    }).toThrow(IoError);
    expect(() => {
      builder.addResult({
        name: "r",
        location: "node",
        components: 0,
        ids: new Uint32Array([0]),
        values: new Float64Array([]),
      });
    }).toThrow(IoError);
    expect(() => {
      builder.addResult({
        name: "r",
        location: "node",
        components: 1,
        ids: new Uint32Array([0]),
        values: new Float64Array([1, 2]),
      });
    }).toThrow(IoError);
  });

  it("builds deterministically: repeated builds are equal", () => {
    const builder = createModelBuilder();
    builder.appendNodes([0], [0, 0, 0]);
    builder.openElementBlock(TET4_SHAPE);
    builder.appendElements([1], [0, 0, 0, 0]);
    const first = builder.build();
    const second = builder.build();
    expect(second).toEqual(first);
  });
});
