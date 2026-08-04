import { describe, expect, it } from "vitest";
import { advanceCase, createCasePlayer, sampleDisplacements } from "../../src/results/case-player";
import { createResultField } from "../../src/results/fields";
import type { VectorField } from "../../src/results/fields";

function displacement(id: string, values: number[]): VectorField<"nodal"> {
  return createResultField({
    id,
    name: `Displacement ${id}`,
    location: "nodal",
    shape: "vector",
    count: values.length / 3,
    unit: "mm",
    values: new Float32Array(values),
  });
}

const bending = displacement("bending", [0, 0, 0, 1, 1, 1]);
const twist = displacement("twist", [2, 2, 2, 4, 4, 4]);
const third = displacement("third", [6, 6, 6, 8, 8, 8]);

describe("createCasePlayer", () => {
  it("creates a player with the default options", () => {
    const cases = [bending, twist];
    const player = createCasePlayer(cases);
    expect(player.cases).toBe(cases);
    expect(player.caseDuration).toBe(1);
    expect(player.loop).toBe("wrap");
    expect(player.interpolate).toBe(false);
    expect(player.caseIndex).toBe(0);
    expect(player.elapsed).toBe(0);
    expect(player.progress).toBe(0);
    expect(player.nextCaseIndex).toBe(1);
    expect(player.blend).toBe(0);
  });

  it("applies the provided options", () => {
    const player = createCasePlayer([bending, twist], {
      caseDuration: 0.5,
      loop: "clamp",
      interpolate: true,
    });
    expect(player.caseDuration).toBe(0.5);
    expect(player.loop).toBe("clamp");
    expect(player.interpolate).toBe(true);
  });

  it("has no next case for a single-case player", () => {
    expect(createCasePlayer([bending]).nextCaseIndex).toBe(-1);
  });

  it("rejects an empty case list", () => {
    expect(() => createCasePlayer([])).toThrow(/at least one displacement case/);
  });

  it("rejects a non-positive or non-finite case duration", () => {
    expect(() => createCasePlayer([bending], { caseDuration: 0 })).toThrow(
      /positive finite number/,
    );
    expect(() => createCasePlayer([bending], { caseDuration: Number.NaN })).toThrow(
      /positive finite number/,
    );
  });

  it("rejects an unknown loop mode", () => {
    expect(() => createCasePlayer([bending], { loop: "bounce" as "wrap" })).toThrow(
      /unknown case loop mode/i,
    );
  });

  it("rejects cases with mismatched counts or units", () => {
    const short = displacement("short", [0, 0, 0]);
    expect(() => createCasePlayer([bending, short])).toThrow(/same count and unit/);
  });
});

describe("advanceCase", () => {
  it("advances one case per full duration and wraps to the first", () => {
    let player = createCasePlayer([bending, twist]);
    player = advanceCase(player, 1);
    expect(player.caseIndex).toBe(1);
    expect(player.elapsed).toBe(0);
    player = advanceCase(player, 1);
    expect(player.caseIndex).toBe(0);
  });

  it("accumulates sub-duration advances into progress", () => {
    let player = createCasePlayer([bending, twist]);
    player = advanceCase(player, 0.25);
    player = advanceCase(player, 0.25);
    expect(player.caseIndex).toBe(0);
    expect(player.elapsed).toBeCloseTo(0.5);
    expect(player.progress).toBeCloseTo(0.5);
  });

  it("skips multiple cases with a large delta", () => {
    let player = createCasePlayer([bending, twist, third]);
    player = advanceCase(player, 2.5);
    expect(player.caseIndex).toBe(2);
    expect(player.elapsed).toBeCloseTo(0.5);
  });

  it("clamps at the last case", () => {
    let player = createCasePlayer([bending, twist], { loop: "clamp" });
    player = advanceCase(player, 1);
    expect(player.caseIndex).toBe(1);
    player = advanceCase(player, 5);
    expect(player.caseIndex).toBe(1);
    expect(player.progress).toBe(1);
  });

  it("clamps a negative delta to zero", () => {
    const player = createCasePlayer([bending, twist]);
    expect(advanceCase(player, -2).elapsed).toBe(0);
  });

  it("exposes a blend toward the next case when interpolating", () => {
    let player = createCasePlayer([bending, twist], { interpolate: true });
    player = advanceCase(player, 0.5);
    expect(player.nextCaseIndex).toBe(1);
    expect(player.blend).toBeCloseTo(0.5);
  });

  it("blends toward the first case when wrapping past the last", () => {
    let player = createCasePlayer([bending, twist], { interpolate: true });
    player = advanceCase(player, 1.5);
    expect(player.caseIndex).toBe(1);
    expect(player.nextCaseIndex).toBe(0);
    expect(player.blend).toBeCloseTo(0.5);
  });

  it("does not blend at a clamped end", () => {
    let player = createCasePlayer([bending, twist], { loop: "clamp", interpolate: true });
    player = advanceCase(player, 1.5);
    expect(player.caseIndex).toBe(1);
    expect(player.nextCaseIndex).toBe(-1);
    expect(player.blend).toBe(0);
  });
});

describe("sampleDisplacements", () => {
  it("returns the active case field directly when not interpolating", () => {
    let player = createCasePlayer([bending, twist]);
    player = advanceCase(player, 0.5);
    expect(sampleDisplacements(player)).toBe(bending);
  });

  it("returns the active case field directly before any blend", () => {
    const player = createCasePlayer([bending, twist], { interpolate: true });
    expect(sampleDisplacements(player)).toBe(bending);
  });

  it("interpolates between adjacent cases", () => {
    let player = createCasePlayer([bending, twist], { interpolate: true });
    player = advanceCase(player, 0.5);
    expect(Array.from(sampleDisplacements(player).values)).toEqual([1, 1, 1, 2.5, 2.5, 2.5]);
  });

  it("propagates missing values through the blend", () => {
    const missing = displacement("missing", [NaN, 2, 2, NaN, 4, 4]);
    let player = createCasePlayer([bending, missing], { interpolate: true });
    player = advanceCase(player, 0.5);
    const values = sampleDisplacements(player).values;
    expect(values[0]).toBeNaN();
    expect(values[1]).toBeCloseTo(1);
    expect(values[3]).toBeNaN();
    expect(values[4]).toBeCloseTo(2.5);
  });

  it("returns the last case at a clamped end", () => {
    let player = createCasePlayer([bending, twist], { loop: "clamp", interpolate: true });
    player = advanceCase(player, 1.5);
    expect(sampleDisplacements(player)).toBe(twist);
  });
});
