import { describe, expect, it } from "vitest";
import { createNodalLoadField } from "../../src/results/fields";
import { resolveNodalLoadRecords } from "../../src/results/load-records";
import { createTestScene } from "../viewport/results/support";

function field(values: readonly number[], count = 3) {
  return createNodalLoadField({
    partId: 1,
    id: "load",
    name: "Load",
    count,
    forceUnit: "N",
    momentUnit: "N·m",
    values: new Float32Array(values),
  });
}

describe("authored nodal load records", () => {
  it("emits one straight force arrow with authored length and direction", () => {
    const part = createTestScene().parts.get(1);
    if (part === undefined) throw new Error("test part missing");
    const records = resolveNodalLoadRecords(
      part,
      field([2, 0, 0, NaN, NaN, NaN, ...missing(12)]),
      undefined,
      0.5,
    );
    expect(records.elementIds).toEqual(new Uint32Array([0]));
    expect(records.directions).toEqual(new Float32Array([1, 0, 0]));
    expect(records.referenceLengths).toEqual(new Float32Array([1]));
    expect(records.glyphModes).toEqual(new Uint32Array([0]));
  });

  it("does not resolve a field against a different part", () => {
    const part = createTestScene().parts.get(1);
    if (part === undefined) throw new Error("test part missing");
    const records = resolveNodalLoadRecords({ ...part, id: 2 }, field([1, 0, 0, ...missing(15)]));
    expect(records.elementIds).toHaveLength(0);
  });

  it("emits six moment segments with only the final arrowhead", () => {
    const part = createTestScene().parts.get(1);
    if (part === undefined) throw new Error("test part missing");
    const records = resolveNodalLoadRecords(
      part,
      field([...missing(3), ...missing(3), ...missing(3), 0, 0, 2, ...missing(6)]),
    );
    expect(records.elementIds).toHaveLength(6);
    expect(records.glyphModes).toEqual(new Uint32Array([3, 3, 3, 3, 3, 0]));
    expect(records.directions.slice(0, 3)).not.toEqual(new Float32Array([0, 0, 0]));
  });

  it("omits all-missing and zero vectors and carries deformed anchors", () => {
    const part = createTestScene().parts.get(1);
    if (part === undefined) throw new Error("test part missing");
    const values = [...missing(6), 0, 0, 0, 0, 0, 0, ...missing(6)];
    const records = resolveNodalLoadRecords(part, field(values), new Float32Array([0.25, 0, 0]), 1);
    expect(records.elementIds).toHaveLength(0);
    const force = resolveNodalLoadRecords(
      part,
      field([1, 0, 0, ...missing(3), ...missing(12)]),
      new Float32Array([0.25, 0, 0]),
    );
    expect(force.anchorDeltas).toEqual(new Float32Array([0.25, 0, 0]));
  });
});

function missing(count: number): number[] {
  return Array.from({ length: count }, () => Number.NaN);
}
