import { describe, expect, it } from "vitest";
import { createScalarColorMap, mapScalar } from "../../src/results/mapping";

describe("createScalarColorMap", () => {
  it("uses the default ramp, range, and missing color", () => {
    const map = createScalarColorMap({ min: 0, max: 100 });
    expect(map.stops.length).toBe(5);
    expect(map.stops[0]?.offset).toBe(0);
    expect(map.stops[4]?.offset).toBe(1);
    expect(map.missingColor).toEqual({ r: 0.55, g: 0.55, b: 0.55, a: 1 });
    expect(map.thresholds).toBeUndefined();
  });

  it("canonicalizes valid stops and thresholds without mutating caller arrays", () => {
    const stops = [
      { offset: 1, color: { r: 1, g: 0, b: 0, a: 1 } },
      { offset: 0, color: { r: 0, g: 0, b: 1, a: 1 } },
    ];
    const thresholds = [7, 3];
    const map = createScalarColorMap({
      min: 0,
      max: 10,
      stops,
      thresholds,
    });
    expect(map.stops[0]?.offset).toBe(0);
    expect(map.stops[1]?.offset).toBe(1);
    expect(map.thresholds).toEqual([3, 7]);
    expect(stops.map((stop) => stop.offset)).toEqual([1, 0]);
    expect(thresholds).toEqual([7, 3]);
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
    expect(() => createScalarColorMap({ min: 0, max: 10, thresholds: [3, 3] })).toThrow(
      /strictly increasing/,
    );
  });

  it("rejects empty and invalid stops or missing colors", () => {
    const validColor = { r: 0, g: 0, b: 0, a: 1 };
    expect(() => createScalarColorMap({ min: 0, max: 1, stops: [] })).toThrow(/at least one stop/);
    for (const offset of [NaN, Infinity, -Infinity, -0.1, 1.1]) {
      expect(() =>
        createScalarColorMap({
          min: 0,
          max: 1,
          stops: [{ offset, color: validColor }],
        }),
      ).toThrow(/stops\[0\]\.offset must be finite and in \[0, 1\]/);
    }
    expect(() =>
      createScalarColorMap({
        min: 0,
        max: 1,
        stops: [
          { offset: 0.5, color: validColor },
          { offset: 0.5, color: validColor },
        ],
      }),
    ).toThrow(/stop offsets must be strictly increasing/);

    for (const channel of ["r", "g", "b", "a"] as const) {
      for (const value of [NaN, Infinity, -Infinity, -0.1, 1.1]) {
        const color = { ...validColor, [channel]: value };
        expect(() =>
          createScalarColorMap({
            min: 0,
            max: 1,
            stops: [{ offset: 0, color }],
          }),
        ).toThrow(new RegExp(`stops\\[0\\]\\.color\\.${channel}`));
      }
    }
    for (const channel of ["r", "g", "b", "a"] as const) {
      for (const value of [NaN, Infinity, -Infinity, -0.1, 1.1]) {
        const missingColor = { ...validColor, [channel]: value };
        expect(() => createScalarColorMap({ min: 0, max: 1, missingColor })).toThrow(
          new RegExp(`missingColor\\.${channel}`),
        );
      }
    }
  });

  it("accepts normalized stop and color boundaries", () => {
    expect(() =>
      createScalarColorMap({
        min: 0,
        max: 1,
        stops: [
          { offset: 0, color: { r: 0, g: 0, b: 0, a: 0 } },
          { offset: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
        ],
        missingColor: { r: 0, g: 1, b: 0, a: 1 },
      }),
    ).not.toThrow();
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

  it("treats empty thresholds as a continuous map", () => {
    const gradient = createScalarColorMap({
      min: 0,
      max: 100,
      thresholds: [],
      stops: [
        { offset: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { offset: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
      ],
    });
    expect(gradient.thresholds).toBeUndefined();
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
