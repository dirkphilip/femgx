import { describe, expect, it } from "vitest";
import { createStructuredFeModel } from "../../demo/benchmark/structured-fe";
import { elementPart } from "../../src/entries/model";
import { measureScaling, type ScalingMeasurement, type ScalingPoint } from "./measure";

const GRID_SIZES = [24, 35, 47] as const;
const ELEMENT_COUNTS = GRID_SIZES.map((size) => size ** 3);
const models = GRID_SIZES.map((size) => createStructuredFeModel("hex8", size));

interface LargeScalingCase {
  readonly name: string;
  readonly points: readonly ScalingPoint[];
}

const cases: readonly LargeScalingCase[] = [
  {
    name: "structured Hex8 part compilation through 100k elements",
    points: models.map((model, index) => ({
      size: model.elements.length,
      run: () => {
        elementPart(20_000 + index, model);
      },
    })),
  },
];

describe("large-model scaling", () => {
  it("uses the intended authored solid element counts", () => {
    expect(ELEMENT_COUNTS).toEqual([13_824, 42_875, 103_823]);
    expect(models.map((model) => model.elements.length)).toEqual(ELEMENT_COUNTS);
  });

  it.each(cases)("$name remains approximately linear", ({ name, points }) => {
    const measurements = measureScaling(points, { warmup: 0, samples: 3 });
    report(name, measurements);
    const normalized = measurements.map(({ millisecondsPerUnit }) => millisecondsPerUnit);
    const spread = Math.max(...normalized) / Math.min(...normalized);
    expect(
      spread,
      `${name} normalized cost spread was ${spread.toFixed(2)}x; expected at most 3x`,
    ).toBeLessThanOrEqual(3);
  });
});

function report(name: string, measurements: readonly ScalingMeasurement[]): void {
  console.log(
    `${name}: ${measurements
      .map(({ size, measuredMs }) => `${size}=${measuredMs.toFixed(3)} ms`)
      .join(", ")}`,
  );
}
