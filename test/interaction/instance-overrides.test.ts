import { describe, expect, it } from "vitest";
import { createInteractionState, setInstanceOverrides } from "../../src/entries/root";
import { readInteractionState } from "../../src/interaction/state";

describe("batched instance overrides", () => {
  it("applies the last duplicate and retains arbitrary occurrence identities", () => {
    const first = { emissive: 0.2 } as const;
    const last = { opacity: 0.4 } as const;
    const state = setInstanceOverrides(createInteractionState(), [
      ["stale/or-host-owned", first],
      ["1/0", first],
      ["1/0", last],
    ]);

    expect([...readInteractionState(state).instanceOverrides]).toEqual([
      ["stale/or-host-owned", first],
      ["1/0", last],
    ]);
  });

  it("clears overrides in one transition and preserves identity for net no-ops", () => {
    const override = { color: { r: 0.2, g: 0.7, b: 0.4, a: 1 } } as const;
    const initial = createInteractionState();
    const populated = setInstanceOverrides(initial, [
      ["1/0", override],
      ["1/1", override],
    ]);

    expect(setInstanceOverrides(populated, [["1/0", override]])).toBe(populated);
    expect(setInstanceOverrides(populated, [])).toBe(populated);
    const cleared = setInstanceOverrides(populated, [
      ["1/0", undefined],
      ["1/1", undefined],
    ]);
    expect(readInteractionState(cleared).instanceOverrides.size).toBe(0);
    expect(setInstanceOverrides(initial, [["missing", undefined]])).toBe(initial);
  });

  it("validates the complete batch before publishing a state", () => {
    expect(() =>
      setInstanceOverrides(createInteractionState(), [
        ["1/0", { opacity: 0.5 }],
        ["1/1", { opacity: 2 }],
      ]),
    ).toThrow(/opacity must be finite and in \[0, 1\]/);
  });
});
