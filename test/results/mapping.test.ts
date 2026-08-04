import { describe, expect, it } from "vitest";
import { createScalarColorMap, legend, mapScalar } from "../../src/results/mapping";

describe("createScalarColorMap", () => {
  it("uses the default ramp, range, and missing color", () => {
    const map = createScalarColorMap({ min: 0, max: 100 });
    expect(map.stops.length).toBe(5);
    expect(map.stops[0]?.offset).toBe(0);
    expect(map.stops[4]?.offset).toBe(1);
    expect(map.missingColor).toEqual({ r: 0.55, g: 0.55, b: 0.55, a: 1 });
    expect(map.thresholds).toBeUndefined();
  });

  it("sorts stops by ascending offset", () => {
    const map = createScalarColorMap({
      min: 0,
      max: 10,
      stops: [
        { offset: 1, color: { r: 1, g: 0, b: 0, a: 1 } },
        { offset: 0, color: { r: 0, g: 0, b: 1, a: 1 } },
      ],
    });
    expect(map.stops[0]?.offset).toBe(0);
    expect(map.stops[1]?.offset).toBe(1);
  });

  it("keeps a custom missing color", () => {
    const map = createScalarColorMap({
      min: 0,
      max: 1,
      missingColor: { r: 1, g: 0, b: 0, a: 1 },
    });
    expect(map.missingColor).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  it("rejects an inverted or non-finite range", () => {
    expect(() => createScalarColorMap({ min: 100, max: 0 })).toThrow(/min < max/);
    expect(() => createScalarColorMap({ min: 0, max: 0 })).toThrow(/min < max/);
    expect(() => createScalarColorMap({ min: NaN, max: 0 })).toThrow(/must be finite/);
    expect(() => createScalarColorMap({ min: 0, max: Infinity })).toThrow(/must be finite/);
  });

  it("rejects thresholds outside or on the range boundary", () => {
    expect(() => createScalarColorMap({ min: 0, max: 10, thresholds: [-1] })).toThrow(
      /strictly inside/,
    );
    expect(() => createScalarColorMap({ min: 0, max: 10, thresholds: [10] })).toThrow(
      /strictly inside/,
    );
    expect(() => createScalarColorMap({ min: 0, max: 10, thresholds: [NaN] })).toThrow(
      /strictly inside/,
    );
  });
});

describe("mapScalar", () => {
  const map = createScalarColorMap({ min: 0, max: 100 });

  it("clips below-range values to the first stop color", () => {
    expect(mapScalar(map, -20)).toEqual(map.stops[0]?.color);
  });

  it("clips above-range values to the last stop color", () => {
    expect(mapScalar(map, 250)).toEqual(map.stops[4]?.color);
  });

  it("maps missing values to the missing color", () => {
    expect(mapScalar(map, NaN)).toEqual(map.missingColor);
    expect(mapScalar(createScalarColorMap({ min: 0, max: 1 }), NaN)).toEqual(map.missingColor);
  });

  it("interpolates linearly between two stops", () => {
    const gradient = createScalarColorMap({
      min: 0,
      max: 100,
      stops: [
        { offset: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { offset: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
      ],
    });
    expect(mapScalar(gradient, 50)).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 1 });
  });

  it("interpolates between interior stops", () => {
    const gradient = createScalarColorMap({
      min: 0,
      max: 2,
      stops: [
        { offset: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { offset: 0.5, color: { r: 1, g: 0, b: 0, a: 1 } },
        { offset: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
      ],
    });
    expect(mapScalar(gradient, 0.5)).toEqual({ r: 0.5, g: 0, b: 0, a: 1 });
    expect(mapScalar(gradient, 1.5)).toEqual({ r: 1, g: 0.5, b: 0.5, a: 1 });
  });

  it("returns the single color of a one-stop map", () => {
    const solid = createScalarColorMap({
      min: 0,
      max: 1,
      stops: [{ offset: 0, color: { r: 0.2, g: 0.4, b: 0.6, a: 1 } }],
    });
    expect(mapScalar(solid, 0.9)).toEqual({ r: 0.2, g: 0.4, b: 0.6, a: 1 });
  });

  it("maps into discrete bands when thresholds are set", () => {
    const banded = createScalarColorMap({
      min: 0,
      max: 100,
      thresholds: [50],
      stops: [
        { offset: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { offset: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
      ],
    });
    expect(mapScalar(banded, -5)).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(mapScalar(banded, 10)).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(mapScalar(banded, 50)).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(mapScalar(banded, 75)).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(mapScalar(banded, 200)).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(mapScalar(banded, NaN)).toEqual(banded.missingColor);
  });
});

describe("legend", () => {
  it("returns one entry per stop for continuous maps", () => {
    const map = createScalarColorMap({
      min: 0,
      max: 100,
      stops: [
        { offset: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { offset: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
      ],
    });
    const entries = legend(map);
    expect(entries.length).toBe(2);
    expect(entries[0]?.fraction).toBe(0);
    expect(entries[0]?.label).toBe("0");
    expect(entries[1]?.fraction).toBe(1);
    expect(entries[1]?.label).toBe("100");
  });

  it("returns one entry per band for thresholded maps with range labels", () => {
    const map = createScalarColorMap({
      min: 0,
      max: 100,
      thresholds: [50],
      stops: [
        { offset: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { offset: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
      ],
    });
    const entries = legend(map);
    expect(entries.length).toBe(2);
    expect(entries[0]?.label).toBe("0 – 50");
    expect(entries[1]?.label).toBe("50 – 100");
    expect(entries[0]?.color).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(entries[1]?.color).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  });
});
