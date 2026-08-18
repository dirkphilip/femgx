import type { BenchmarkGpuCostSnapshot } from "./types";

/** Rejects a benchmark frame that omitted the requested element emphasis draws. */
export function assertElementEmphasisDraw(
  cost: BenchmarkGpuCostSnapshot,
  label: string,
  expectedIndices?: number,
): void {
  for (const pass of ["selection-visible", "selection-hidden"] as const) {
    const draw = cost.draws[pass];
    if (
      draw === undefined ||
      draw.calls === 0 ||
      draw.indices === 0 ||
      draw.instances === 0 ||
      (expectedIndices !== undefined &&
        (draw.calls !== 1 || draw.indices !== expectedIndices || draw.instances !== 1))
    ) {
      throw new Error(
        `${label} omitted ${pass} element emphasis work: ${JSON.stringify({ draw, expectedIndices })}`,
      );
    }
  }
}

/** Rejects a cleared benchmark frame that retained element emphasis draws. */
export function assertNoElementEmphasisDraw(cost: BenchmarkGpuCostSnapshot, label: string): void {
  for (const pass of ["selection-visible", "selection-hidden"] as const) {
    if ((cost.draws[pass]?.calls ?? 0) !== 0) throw new Error(`${label} retained ${pass} work`);
  }
}

/** Returns a positive highlight-buffer write delta for one interaction sync. */
export function highlightWriteBytesSince(
  before: BenchmarkGpuCostSnapshot,
  after: BenchmarkGpuCostSnapshot,
  label: string,
): number {
  const calls = (after.writes["highlight"]?.calls ?? 0) - (before.writes["highlight"]?.calls ?? 0);
  const bytes = (after.writes["highlight"]?.bytes ?? 0) - (before.writes["highlight"]?.bytes ?? 0);
  if (calls <= 0 || bytes <= 0) throw new Error(`${label} omitted highlight-buffer writes`);
  return bytes;
}

/** Rejects a frame that omitted the expected ordinary opaque surface draw. */
export function assertOpaqueSurfaceDraw(
  cost: BenchmarkGpuCostSnapshot,
  label: string,
  indices: number,
  instances: number,
): void {
  const draw = cost.draws["opaque"];
  if (draw?.calls !== 1 || draw.indices !== indices || draw.instances !== instances) {
    throw new Error(`${label} omitted opaque surface work: ${JSON.stringify({ draw })}`);
  }
}
