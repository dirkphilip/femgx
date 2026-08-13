import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { WebGpuBenchmarkReport } from "../demo/benchmark/runner";

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
  const interactiveCases = report.cases.filter((entry) => entry.interactive !== undefined);
  expect(interactiveCases.map((entry) => entry.id)).toEqual([
    "instanced-2.10m",
    "unique-1m",
    "many-parts-100",
  ]);
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
    if (entry.interactive === undefined) continue;
    for (const sample of [entry.interactive.fixedCamera, entry.interactive.movingCamera]) {
      expect(sample.durationMs).toBeGreaterThan(0);
      expect(sample.frameCount).toBeGreaterThan(0);
      expect(sample.fps).toBeGreaterThan(0);
      expect(sample.p95FrameIntervalMs).toBeGreaterThanOrEqual(sample.p50FrameIntervalMs);
      expect(sample.maxFrameIntervalMs).toBeGreaterThanOrEqual(sample.p95FrameIntervalMs);
      expect(sample.intervalsOver16_7Ms).toBeLessThanOrEqual(sample.frameCount - 1);
      expect(sample.intervalsOver33_3Ms).toBeLessThanOrEqual(sample.frameCount - 1);
      expect(sample.intervalsOver16_7Percent).toBeGreaterThanOrEqual(0);
      expect(sample.intervalsOver33_3Percent).toBeGreaterThanOrEqual(0);
    }
    expect(
      cameraDistance(
        entry.interactive.fixedCamera.finalCamera,
        entry.interactive.movingCamera.finalCamera,
      ),
    ).toBeGreaterThan(0);
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

function cameraDistance(
  first: { readonly position: readonly number[] },
  second: { readonly position: readonly number[] },
): number {
  return Math.hypot(
    (first.position[0] ?? 0) - (second.position[0] ?? 0),
    (first.position[1] ?? 0) - (second.position[1] ?? 0),
    (first.position[2] ?? 0) - (second.position[2] ?? 0),
  );
}
