import { describe, expect, it } from "vitest";
import {
  authoredNodeTargets,
  denseNodeSelectionStorage,
} from "../../../demo/benchmark/node-selection";

describe("WebGPU dense node-selection benchmark", () => {
  it("builds distinct authored targets without inventing node identities", () => {
    const targets = authoredNodeTargets("assembly/part", 3);
    expect(targets).toEqual([
      { kind: "node", partOccurrenceId: "assembly/part", nodeId: 0 },
      { kind: "node", partOccurrenceId: "assembly/part", nodeId: 1 },
      { kind: "node", partOccurrenceId: "assembly/part", nodeId: 2 },
    ]);
    expect(() => authoredNodeTargets("assembly/part", 0)).toThrow(/positive integer/);
  });

  it("accounts for the Tet4 slot table, node bitset, header, and sparse sentinel", () => {
    expect(denseNodeSelectionStorage(24_389, 1, 1)).toEqual({
      payloadBytes: 3_056,
      storageBytes: 3_200,
    });
  });
});
