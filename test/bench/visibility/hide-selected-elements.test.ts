import { describe, expect, it } from "vitest";
import { createInteractionState } from "@/interaction/interaction";
import { hideSelectedElements } from "@/interaction/selection-queries";
import { setTargetsSelected } from "@/interaction/targets";
import { readInteractionState } from "@/interaction/state";
import { buildOperationsReport, emitOperationsReport } from "../operation-report";

const ELEMENT_COUNT = 131_712;
const HIDDEN_COUNT = ELEMENT_COUNT / 2;
const PART_OCCURRENCE_ID = "benchmark/0";

describe("selected-element hide transition baseline", () => {
  it("packs a half-large-model hide into one immutable nested-set update", () => {
    const selected = setTargetsSelected(createInteractionState(), selectedTargets(), true);
    const report = buildOperationsReport([
      {
        name: "hide-selected-elements-half",
        workloadUnit: "selected element identities added to hidden visibility",
        workloadCount: HIDDEN_COUNT,
        workloadDetails: { elementCount: ELEMENT_COUNT, occurrenceCount: 1 },
        run: () => {
          const hidden = hideSelectedElements(selected);
          expect(readInteractionState(hidden).hiddenElementIds.get(PART_OCCURRENCE_ID)?.size).toBe(
            HIDDEN_COUNT,
          );
        },
      },
    ]);
    expect(report.operations).toHaveLength(1);
    expect(report.operations[0]?.timingsMs.p50).toBeLessThan(16.7);
    emitOperationsReport(report);
  }, 30_000);
});

function selectedTargets() {
  return Array.from({ length: HIDDEN_COUNT }, (_, elementId) => ({
    kind: "element" as const,
    partOccurrenceId: PART_OCCURRENCE_ID,
    elementId,
  }));
}
