import { expect, it, describe } from "vitest";
import {
  MAX_PART_ID,
  translation,
  createDrawResources,
  EMISSIVE_BYTE_OFFSET,
  encodeInstanceRecord,
  INSTANCE_EDGE_OVERLAY_FLAG,
  patchInstances,
  defaultStyle,
  fakeGpuDevice,
  installGpuGlobals,
  part,
  record,
  writeRanges,
} from "./support";

describe("GPU draw path", () => {
  it("encodes transform, style, emissive, and stable pick id into a record", () => {
    const data = encodeInstanceRecord(
      translation(1, 2, 3),
      {
        color: { r: 1, g: 0.5, b: 0.25, a: 1 },
        emissive: 0.4,
        opacity: 0.5,
        lineWidthPixels: 7,
        edge: false,
        nodes: false,
      },
      7,
    );
    const floats = new Float32Array(data);
    const ids = new Uint32Array(data);
    expect(floats[12]).toBe(1);
    expect(floats[13]).toBe(2);
    expect(floats[14]).toBe(3);
    expect(floats[16]).toBe(1);
    expect(floats[19]).toBeCloseTo(0.5);
    expect(ids[20]).toBe(7);
    expect(new Float32Array(data, EMISSIVE_BYTE_OFFSET, 1)[0]).toBeCloseTo(0.4);
    expect(floats[23]).toBeCloseTo(7);
  });

  it("encodes whether the occurrence requests its edge overlay", () => {
    const style = { ...defaultStyle, edge: true };
    const flags = new Uint32Array(encodeInstanceRecord(translation(0, 0, 0), style, 1));
    expect(flags[22]).toBe(INSTANCE_EDGE_OVERLAY_FLAG);
  });

  it("preserves the maximum direct-u32 part identity in instance storage", () => {
    const ids = new Uint32Array(
      encodeInstanceRecord(translation(0, 0, 0), defaultStyle, MAX_PART_ID),
    );
    expect(ids[20]).toBe(MAX_PART_ID);
  });

  it("writes one complete record for a changed slot", () => {
    const restore = installGpuGlobals();
    try {
      const gpu = fakeGpuDevice();
      const draw = createDrawResources(gpu.device);
      patchInstances(draw, part.id, [{ slot: 0, data: record(1) }]);
      const afterInitial = gpu.writes.length;
      patchInstances(draw, part.id, [{ slot: 0, data: record(1) }]);
      expect(gpu.writes.length).toBe(afterInitial);
      patchInstances(draw, part.id, [{ slot: 0, data: record(9) }]);
      expect(writeRanges(gpu, afterInitial)).toEqual([[0, 96]]);
    } finally {
      restore();
    }
  });
});
