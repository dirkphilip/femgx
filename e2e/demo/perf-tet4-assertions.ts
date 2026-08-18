import { expect } from "@playwright/test";
import type { WebGpuBenchmarkCaseResult } from "../../demo/benchmark/types";

const DENSE_TET4_HOVER_BUDGET_MS = {
  coldPick: 250,
  firstHoveredFrame: 250,
  steadyP95: 33.3,
  clearHover: 250,
} as const;

/** Guards dense Tet4 hover coverage and the deliberately loose cold-path budgets. */
export function expectDenseTet4HoverReport(entry: WebGpuBenchmarkCaseResult): void {
  expect(entry.hover, `${entry.id} must include dense Tet4 hover evidence`).toMatchObject({
    targetKind: "element",
    selectedOccurrenceCount: 1,
  });
  const hover = entry.hover;
  if (hover === undefined) throw new Error(`${entry.id} hover report is missing`);
  expect(hover.pickMs, `${entry.id} cold pick/readback regressed`).toBeLessThanOrEqual(
    DENSE_TET4_HOVER_BUDGET_MS.coldPick,
  );
  expect(
    hover.firstHoveredFrameMs,
    `${entry.id} first hovered frame regressed`,
  ).toBeLessThanOrEqual(DENSE_TET4_HOVER_BUDGET_MS.firstHoveredFrame);
  expect(
    hover.steadyHoveredFrameMs.p95,
    `${entry.id} steady hover p95 regressed`,
  ).toBeLessThanOrEqual(DENSE_TET4_HOVER_BUDGET_MS.steadyP95);
  expect(hover.clearHoverMs, `${entry.id} hover clear regressed`).toBeLessThanOrEqual(
    DENSE_TET4_HOVER_BUDGET_MS.clearHover,
  );
  expect(hover.interactionHighlightWriteBytes).toBeGreaterThan(0);
}
