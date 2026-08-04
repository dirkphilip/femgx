import { expect, test } from "@playwright/test";

/**
 * Optional browser performance smoke. It is skipped by the default e2e gate and
 * only runs when `RUN_PERF=1`, which the opt-in `perf.yml` workflow sets. It
 * measures the demo's interaction round trip (pointer event -> render) in a
 * real browser as a loose regression signal; true WebGPU frame-time
 * benchmarking is tracked in `wiki/performance-issues.md`.
 */
const enabled = process.env["RUN_PERF"] === "1";

test.skip(!enabled, "browser performance runs are opt-in via RUN_PERF=1");

test("handles pointer-driven interaction within a loose bound", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("canvas has no bounding box");
  }

  const moveCount = 100;
  const start = performance.now();
  for (let i = 0; i < moveCount; i++) {
    await page.mouse.move(box.x + (i % 50) * 4, box.y + ((i * 7) % 60));
  }
  const elapsed = performance.now() - start;

  // Generous ceiling; the demo only renders a handful of triangles. This is a
  // smoke signal for interaction loops that accidentally block the main thread.
  expect(elapsed, `${moveCount} pointer moves took ${elapsed.toFixed(1)} ms`).toBeLessThan(2_000);
});
