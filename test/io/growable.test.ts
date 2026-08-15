import { describe, expect, it } from "vitest";
import { Float64Buffer, Uint32Buffer } from "../../src/io/growable";

describe("growable typed-array buffers", () => {
  it("preserves growth, sparse defaults, ranges, and typed output", () => {
    const integers = new Uint32Buffer();
    const floats = new Float64Buffer();
    const integerValues = Array.from({ length: 1025 }, (_, index) => index + 1);
    const floatValues = Array.from({ length: 1025 }, (_, index) => index + 0.5);

    integers.append({ length: 2, 0: 7 });
    integers.push(9);
    integers.append(integerValues);
    floats.append({ length: 2, 0: 1.5 });
    floats.push(2.5);
    floats.append(floatValues);

    expect(integers.at(-1)).toBeUndefined();
    expect(integers.at(1)).toBe(0);
    expect(integers.at(integers.size)).toBeUndefined();
    expect(integers.slice(-2, 3)).toEqual(new Uint32Array([7, 0, 9]));
    expect(floats.slice(1, 3)).toEqual(new Float64Array([0, 2.5]));
    expect(integers.toArray()).toBeInstanceOf(Uint32Array);
    expect(floats.toArray()).toBeInstanceOf(Float64Array);
    expect(integers.byteLength).toBe(2048 * Uint32Array.BYTES_PER_ELEMENT);
    expect(floats.byteLength).toBe(2048 * Float64Array.BYTES_PER_ELEMENT);
    expect(integers).toBeInstanceOf(Uint32Buffer);
    expect(floats).toBeInstanceOf(Float64Buffer);
  });
});
