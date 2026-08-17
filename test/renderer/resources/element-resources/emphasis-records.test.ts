import { expect, it, describe } from "vitest";
import { ELEMENT_RECORD_STRIDE, encodeEmphasisRecord, style } from "./support";

describe("encodeEmphasisRecord", () => {
  it("encodes element, face, and node pick ids at the documented offsets", () => {
    const data = encodeEmphasisRecord({
      slot: 2,
      elementPickId: 0,
      facePickId: 6,
      nodePickId: 9,
      style,
    });
    const ids = new Uint32Array(data);
    const floats = new Float32Array(data);
    expect(data.byteLength).toBe(ELEMENT_RECORD_STRIDE);
    expect(ids[0]).toBe(2);
    expect(ids[1]).toBe(0);
    expect(ids[2]).toBe(6);
    expect(ids[3]).toBe(9);
    expect(floats[4]).toBeCloseTo(style.color.r);
    expect(floats[7]).toBeCloseTo(style.color.a * style.opacity);
    expect(floats[8]).toBeCloseTo(style.emissive);
  });

  it("encodes explicit element, face, node, and body emphasis records", () => {
    const ids = new Uint32Array(
      encodeEmphasisRecord({
        slot: 2,
        elementPickId: 4,
        facePickId: 0,
        nodePickId: 0,
        style,
      }),
    );
    expect(ids[1]).toBe(4);
    expect(ids[2]).toBe(0);
    expect(ids[3]).toBe(0);

    const faceIds = new Uint32Array(
      encodeEmphasisRecord({
        slot: 2,
        elementPickId: 0,
        facePickId: 4,
        nodePickId: 0,
        style,
      }),
    );
    expect(faceIds[1]).toBe(0);
    expect(faceIds[2]).toBe(4);
    expect(faceIds[3]).toBe(0);

    const nodeIds = new Uint32Array(
      encodeEmphasisRecord({
        slot: 2,
        elementPickId: 0,
        facePickId: 0,
        nodePickId: 4,
        style,
      }),
    );
    expect(nodeIds[1]).toBe(0);
    expect(nodeIds[2]).toBe(0);
    expect(nodeIds[3]).toBe(4);

    const bodyIds = new Uint32Array(
      encodeEmphasisRecord({
        slot: 2,
        elementPickId: 0,
        facePickId: 0,
        nodePickId: 0,
        bodyPickId: 4,
        hidden: true,
        selected: true,
        style,
      }),
    );
    expect(bodyIds[0]).toBe(2);
    expect(bodyIds[1]).toBe(4);
    expect(bodyIds[2]).toBe(0xffffffff);
    expect(bodyIds[9]).toBe(1);
    expect(bodyIds[10]).toBe(1);

    const preservedIds = new Uint32Array(
      encodeEmphasisRecord({
        slot: 2,
        elementPickId: 11,
        facePickId: 0,
        nodePickId: 0,
        preservesDisplayedColor: true,
        style,
      }),
    );
    expect(preservedIds[11]).toBe(1);
  });
});
