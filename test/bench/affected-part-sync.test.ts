import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installGpuGlobals } from "../renderer/fake-gpu";
import {
  createAffectedPartFixture,
  destroyAffectedPartFixture,
  measureAffectedPartOperation,
  type AffectedPartRow,
  type SceneShape,
  type SyncOperation,
} from "./affected-part-sync-fixture";

const TIERS: Readonly<Record<SceneShape, readonly number[]>> = {
  "distinct-parts": [100, 1_000, 4_000],
  "shared-part": [1_000, 10_000, 100_000],
};
const COMMON_OPERATIONS: readonly SyncOperation[] = [
  "hover",
  "selection-one",
  "recolor",
  "visibility",
];
let restoreGpuGlobals: (() => void) | undefined;

beforeAll(() => {
  restoreGpuGlobals = installGpuGlobals();
});

afterAll(() => {
  restoreGpuGlobals?.();
});

describe("affected-part renderer synchronization", () => {
  it("measures one affected part without permitting cross-part writes", async () => {
    const rows: AffectedPartRow[] = [];
    for (const shape of ["distinct-parts", "shared-part"] as const) {
      for (const size of TIERS[shape]) {
        const fixture = await createAffectedPartFixture(shape, size);
        try {
          const operations: readonly SyncOperation[] =
            shape === "shared-part"
              ? [...COMMON_OPERATIONS, "selection-half", "selection-all"]
              : COMMON_OPERATIONS;
          for (const operation of operations) {
            rows.push(measureAffectedPartOperation(fixture, operation));
          }
        } finally {
          destroyAffectedPartFixture(fixture);
        }
      }
    }
    expect(rows).toHaveLength(30);
    console.log(JSON.stringify({ schemaVersion: 1, rows }, undefined, 2));
  }, 300_000);
});
