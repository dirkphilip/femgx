import { expect, test } from "@playwright/test";
import type { GlbViewportBenchmarkReport } from "../../demo/benchmark/glb-viewport";
import { rendererMode } from "./demo-support";

const enabled = process.env["RUN_GLB_VIEWPORT_PERF"] === "1";
const baseURL = process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:5173";
const partCount = Number(process.env["GLB_VIEWPORT_PARTS"] ?? "74433");

interface GlbBenchmarkSeam {
  readonly runGlbViewportBenchmark: (
    primitiveCount?: number,
    holdMilliseconds?: number,
  ) => Promise<GlbViewportBenchmarkReport>;
}

test.skip(!enabled, "full GLB Viewport performance is opt-in");
test.setTimeout(2 * 60_000);

test("loads and presents a representative flat assembly GLB through Viewport", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1_000, height: 760 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  try {
    await page.goto("/");
    const canvas = page.getByTestId("view-canvas");
    await expect(canvas).toBeVisible();
    await expect.poll(() => rendererMode(page, canvas)).not.toBe("");
    if ((await rendererMode(page, canvas)) !== "webgpu") {
      test.skip(true, "the opt-in benchmark requires a real WebGPU adapter");
      return;
    }
    const reportPromise = page.evaluate(
      (requestedPartCount) =>
        (
          window as typeof window & {
            femgxDemo: GlbBenchmarkSeam;
          }
        ).femgxDemo.runGlbViewportBenchmark(requestedPartCount, 1_000),
      partCount,
    );
    const benchmarkCanvas = page.locator('canvas[data-glb-benchmark="visible"]');
    await expect(benchmarkCanvas).toBeVisible();
    await benchmarkCanvas.screenshot({ path: testInfo.outputPath("glb-viewport.png") });
    const report = await reportPromise;
    console.log(`GLB_VIEWPORT_BENCHMARK_JSON ${JSON.stringify(report)}`);
    expect(report.sourcePartCount).toBe(partCount);
    expect(report.partCount).toBeLessThanOrEqual(5);
    expect(report.timings.fileToVisibleMs).toBeLessThan(5_000);
    expect(report.timings.steadyFrameQueueMs).toBeLessThan(100);
    expect(report.timings.edgeSteadyQueueMs).toBeLessThan(100);
    expect(report.timings.nodeSteadyQueueMs).toBeLessThan(100);
  } finally {
    await context.close();
  }
});
