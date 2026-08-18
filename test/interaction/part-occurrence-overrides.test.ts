import { describe, expect, it } from "vitest";
import {
  createInteractionState,
  setPartOccurrenceOverrides,
  setPartOverrides,
} from "../../src/entries/root";
import { readInteractionState } from "../../src/interaction/state";

describe("batched part-occurrence overrides", () => {
  it("applies the last duplicate and retains arbitrary occurrence identities", () => {
    const first = { emissive: 0.2 } as const;
    const last = { opacity: 0.4 } as const;
    const state = setPartOccurrenceOverrides(createInteractionState(), [
      ["stale/or-host-owned", first],
      ["1/0", first],
      ["1/0", last],
    ]);

    expect([...readInteractionState(state).partOccurrenceOverrides]).toEqual([
      ["stale/or-host-owned", first],
      ["1/0", last],
    ]);
  });

  it("clears overrides in one transition and preserves identity for net no-ops", () => {
    const override = { color: { r: 0.2, g: 0.7, b: 0.4, a: 1 } } as const;
    const initial = createInteractionState();
    const populated = setPartOccurrenceOverrides(initial, [
      ["1/0", override],
      ["1/1", override],
    ]);

    expect(setPartOccurrenceOverrides(populated, [["1/0", override]])).toBe(populated);
    expect(setPartOccurrenceOverrides(populated, [])).toBe(populated);
    const cleared = setPartOccurrenceOverrides(populated, [
      ["1/0", undefined],
      ["1/1", undefined],
    ]);
    expect(readInteractionState(cleared).partOccurrenceOverrides.size).toBe(0);
    expect(setPartOccurrenceOverrides(initial, [["missing", undefined]])).toBe(initial);
  });

  it("validates the complete batch before publishing a state", () => {
    expect(() =>
      setPartOccurrenceOverrides(createInteractionState(), [
        ["1/0", { opacity: 0.5 }],
        ["1/1", { opacity: 2 }],
      ]),
    ).toThrow(/opacity must be finite and in \[0, 1\]/);
  });
});

describe("batched part overrides", () => {
  it("applies a large iterable in one immutable transition", () => {
    const override = { edge: false } as const;
    const entries = Array.from({ length: 10_000 }, (_, partId) => [partId, override] as const);

    const state = setPartOverrides(createInteractionState(), entries);

    expect(readInteractionState(state).partOverrides.size).toBe(entries.length);
    expect(setPartOverrides(state, entries)).toBe(state);
  });
});
