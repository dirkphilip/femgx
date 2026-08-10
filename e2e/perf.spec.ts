import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { WebGpuBenchmarkReport } from "../demo/webgpu-benchmark";

const enabled = process.env["RUN_PERF"] === "1";
const includeLarge = process.env["RUN_PERF_LARGE"] === "1";
const PHONE_FREE_VIEWPORT = { width: 1_000, height: 760 };

interface BenchmarkSeam {
  readonly runBenchmark: (includeLargeCase: boolean) => Promise<WebGpuBenchmarkReport>;
}

test.skip(!enabled, "browser performance runs are opt-in via RUN_PERF=1");
test.setTimeout(includeLarge ? 15 * 60_000 : 10 * 60_000);

test("reports real WebGPU geometry and picking costs", async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:5173",
    viewport: PHONE_FREE_VIEWPORT,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.getAttribute("data-renderer")).not.toBeNull();
  const renderer = await canvas.getAttribute("data-renderer");
  test.skip(renderer !== "webgpu", "the opt-in benchmark requires a real WebGPU adapter");

  const report: WebGpuBenchmarkReport = await page.evaluate(
    (large) =>
      (
        window as typeof window & {
          femgxDemo: BenchmarkSeam;
        }
      ).femgxDemo.runBenchmark(large),
    includeLarge,
  );

  expect(report.resolution).toEqual({ width: 800, height: 600, dpr: 1 });
  expect(report.cases.map((entry) => entry.kind)).toContain("instancing-heavy");
  expect(report.cases.filter((entry) => entry.kind === "unique-geometry")).toHaveLength(
    includeLarge ? 3 : 2,
  );
  for (const entry of report.cases) {
    expect(entry.uniqueTriangles).toBeGreaterThan(0);
    expect(entry.submittedTriangles).toBeGreaterThanOrEqual(entry.uniqueTriangles);
    expect(entry.visibleTriangles).toBe(entry.submittedTriangles);
    for (const timing of Object.values(entry.timings) as Array<{
      readonly p50: number;
      readonly p95: number;
    }>) {
      expect(timing.p50).toBeGreaterThanOrEqual(0);
      expect(timing.p95).toBeGreaterThanOrEqual(timing.p50);
    }
  }

  const artifact = testInfo.outputPath("webgpu-benchmark.json");
  await writeFile(artifact, `${JSON.stringify(report, undefined, 2)}\n`, "utf8");
  await testInfo.attach("webgpu-benchmark", {
    path: artifact,
    contentType: "application/json",
  });
  console.log(`WEBGPU_BENCHMARK_JSON ${JSON.stringify(report)}`);
  await context.close();
});
