import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { installGpuGlobals } from "../../renderer/fake-gpu";
import { buildOperationsReport, emitOperationsReport } from "../operation-report";
import {
  createSelectionHideWorkflowFixture,
  destroySelectionHideWorkflowFixture,
  selectionHideWorkflowOperations,
  type SelectionHideWorkflowFixture,
} from "./selection-hide-workflow-fixture";

let restoreGpuGlobals: (() => void) | undefined;
let fixture: SelectionHideWorkflowFixture | undefined;

beforeAll(() => {
  restoreGpuGlobals = installGpuGlobals();
});

afterAll(() => {
  if (fixture !== undefined) destroySelectionHideWorkflowFixture(fixture);
  restoreGpuGlobals?.();
});

describe("large Tet4 selection-hide workflow", () => {
  it("separates state construction from renderer synchronization with overlays shown", async () => {
    fixture = await createSelectionHideWorkflowFixture();
    const report = buildOperationsReport(selectionHideWorkflowOperations(fixture));
    expect(report.operations.map((operation) => operation.name)).toEqual([
      "tet4-half-select-state-build-nodes-edges",
      "tet4-half-hide-state-build-nodes-edges",
      "tet4-half-selection-sync-nodes-edges",
      "tet4-half-hide-sync-nodes-edges",
    ]);
    for (const operation of report.operations) {
      expect(operation.workload.details?.["elementCount"]).toBe(131_712);
      expect(operation.workload.details?.["selectedElementCount"]).toBe(65_856);
      expect(operation.workload.details?.["nodeCount"]).toBe(24_389);
      expect(operation.workload.details?.["edgeCount"]).toBe(160_804);
      expect(operation.timingsMs.p95).toBeGreaterThanOrEqual(operation.timingsMs.p50);
    }
    emitOperationsReport(report);
  }, 120_000);
});
