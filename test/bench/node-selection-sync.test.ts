import { describe, expect, it } from "vitest";
import { createMultiPlacementNodeFixture } from "./node-selection-sync-fixture";
import { buildOperationsReport, emitOperationsReport } from "./operation-report";
import {
  createNodeSelectionFixture,
  nodeSelectionCaseOperations,
  nodeSelectionOperations,
} from "./node-selection-sync-operation";
import { ELEMENT_COUNT, MULTI_CASE_ID, NODE_COUNT } from "./node-selection-sync-shared";

describe("local node-selection synchronization baseline", () => {
  it("emits the large Tet4 node-selection report", () => {
    const fixture = createNodeSelectionFixture();
    const multiFixture = createMultiPlacementNodeFixture(fixture);
    const report = buildOperationsReport([
      ...nodeSelectionOperations(fixture),
      ...nodeSelectionCaseOperations(multiFixture, MULTI_CASE_ID),
    ]);
    expect(report.operations).toHaveLength(26);
    expect(new Set(report.operations.map((operation) => operation.name)).size).toBe(26);
    for (const operation of report.operations) {
      expect(operation.timingsMs.p50).toBeGreaterThanOrEqual(0);
      expect(operation.timingsMs.p95).toBeGreaterThanOrEqual(operation.timingsMs.p50);
      expect(operation.workload.details?.["nodeCount"]).toBe(NODE_COUNT);
      expect(operation.workload.details?.["elementCount"]).toBe(ELEMENT_COUNT);
    }
    expect(
      report.operations.find((operation) => operation.name === "node-small-build-interaction-state")
        ?.workload.details?.["selectedNodes"],
    ).toBe(2);
    expect(
      report.operations.find((operation) => operation.name === "node-all-collect-emphasis-updates")
        ?.workload.details?.["selectedNodes"],
    ).toBe(NODE_COUNT);
    expect(
      report.operations.find((operation) => operation.name === "node-small-build-interaction-state")
        ?.workload.details?.["occurrenceCount"],
    ).toBe(1);
    expect(
      report.operations.filter(
        (operation) => operation.workload.details?.["occurrenceCount"] === 32,
      ),
    ).toHaveLength(6);
    emitOperationsReport(report);
  }, 120_000);
});
