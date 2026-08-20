import { describe, expect, it } from "vitest";
import { buildOperationsReport, emitOperationsReport } from "../operation-report";
import { createSelectionFixture, selectionSyncOperations } from "./selection-sync-operation";

describe("local selection synchronization baseline", () => {
  it("emits the dense-selection owning-function report", () => {
    const fixture = createSelectionFixture();
    const report = buildOperationsReport(selectionSyncOperations(fixture));
    expect(report.operations).toHaveLength(7);
    for (const operation of report.operations) {
      expect(operation.timingsMs.p50).toBeGreaterThanOrEqual(0);
      expect(operation.timingsMs.p95).toBeGreaterThanOrEqual(operation.timingsMs.p50);
      expect(operation.workload.details?.["elementCount"]).toBe(131_712);
      expect(operation.workload.details?.["authoredFaceCount"]).toBe(526_848);
    }
    const allRanges = report.operations.find(
      (operation) => operation.name === "selection-all-build-draw-ranges",
    );
    expect(allRanges?.workload.details?.["boundaryFaceCount"]).toBe(9_408);
    emitOperationsReport(report);
  }, 120_000);
});
