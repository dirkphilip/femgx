import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { WebGpuBenchmarkReport } from "../demo/benchmark/runner";

const enabled = process.env["RUN_PERF"] === "1";
const includeLarge = process.env["RUN_PERF_LARGE"] === "1";
const baseURL = process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:5173";
const PHONE_FREE_VIEWPORT = { width: 1_000, height: 760 };
const DPR2_READBACK_CASE_ID = "unique-250k";
const CASE_TIMEOUT_MS = includeLarge ? 5 * 60_000 : 2 * 60_000;
let caseArtifactDirectory: string | undefined;

// Keep browser-only benchmark dependencies out of ordinary e2e collection.
const benchmarkCaseSpecs = enabled
  ? (await import("../demo/benchmark/model")).benchmarkCaseSpecs
  : () => [];

interface BenchmarkSeam {
  readonly runBenchmark: (
    includeLargeCase: boolean,
    caseId?: string,
  ) => Promise<WebGpuBenchmarkReport>;
}

test.skip(!enabled, "browser performance runs are opt-in via RUN_PERF=1");
test.setTimeout(CASE_TIMEOUT_MS);

test.afterAll(async ({ browser: _browser }, testInfo) => {
  if (caseArtifactDirectory === undefined) return;
  const reports: WebGpuBenchmarkReport[] = [];
  for (const spec of benchmarkCaseSpecs(includeLarge)) {
    try {
      const source = await readFile(join(caseArtifactDirectory, `${spec.id}.json`), "utf8");
      reports.push(JSON.parse(source) as WebGpuBenchmarkReport);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  const first = reports[0];
  if (first === undefined) return;
  const aggregate: WebGpuBenchmarkReport = {
    ...first,
    cases: reports.flatMap((report) => report.cases),
  };
  const artifact = testInfo.outputPath("webgpu-benchmark-aggregate.json");
  await writeFile(artifact, `${JSON.stringify(aggregate, undefined, 2)}\n`, "utf8");
  await testInfo.attach("webgpu-benchmark-aggregate", {
    path: artifact,
    contentType: "application/json",
  });
  console.log(`WEBGPU_BENCHMARK_AGGREGATE_JSON ${JSON.stringify(aggregate)}`);
});

for (const spec of benchmarkCaseSpecs(includeLarge)) {
  test(`reports real WebGPU costs for ${spec.id}`, async ({ browser }, testInfo) => {
    testInfo.setTimeout(CASE_TIMEOUT_MS);
    caseArtifactDirectory = join(
      testInfo.project.outputDir,
      "webgpu-benchmark",
      `${testInfo.project.name}-${process.pid}`,
    );
    await mkdir(caseArtifactDirectory, { recursive: true });
    const context = await browser.newContext({
      baseURL,
      viewport: PHONE_FREE_VIEWPORT,
      deviceScaleFactor: spec.id === DPR2_READBACK_CASE_ID ? 2 : 1,
    });
    const page = await context.newPage();
    try {
      await page.goto("/");
      const canvas = page.getByTestId("view-canvas");
      await expect(canvas).toBeVisible();
      await expect.poll(() => canvas.getAttribute("data-renderer")).not.toBeNull();
      const renderer = await canvas.getAttribute("data-renderer");
      if (renderer !== "webgpu") {
        test.skip(true, "the opt-in benchmark requires a real WebGPU adapter");
        return;
      }

      const report = await runBenchmarkWithTimeout(page, includeLarge, spec.id);
      const artifact = testInfo.outputPath("webgpu-benchmark.json");
      await writeFile(artifact, `${JSON.stringify(report, undefined, 2)}\n`, "utf8");
      await writeFile(
        join(caseArtifactDirectory, `${spec.id}.json`),
        `${JSON.stringify(report, undefined, 2)}\n`,
        "utf8",
      );
      await testInfo.attach("webgpu-benchmark", {
        path: artifact,
        contentType: "application/json",
      });
      console.log(`WEBGPU_BENCHMARK_JSON ${JSON.stringify(report)}`);

      expect(report.schemaVersion).toBe(4);
      expect(report.cases).toHaveLength(1);
      const [entry] = report.cases;
      expect(entry?.id).toBe(spec.id);
      expect(report.memoryEstimateScope).toContain("renderer-owned");
      expect(report.resolution).toEqual({
        width: 800,
        height: 600,
        dpr: spec.id === DPR2_READBACK_CASE_ID ? 2 : 1,
      });
      expect(entry?.estimatedMemory.resultColorBytes).toBeGreaterThan(0);
      expect(entry?.estimatedMemory.visibleColorBytes).toBeGreaterThan(0);
      if (entry === undefined) throw new Error("Benchmark report case is missing");
      expect(entry.elementFamily).toBeDefined();
      expect(entry.uniqueElementCount).toBeGreaterThan(1);
      expect(entry.submittedElementOccurrences).toBeGreaterThanOrEqual(entry.uniqueElementCount);
      expect(entry.uniqueTriangles).toBeGreaterThan(0);
      expect(entry.submittedTriangles).toBeGreaterThanOrEqual(entry.uniqueTriangles);
      expect(entry.visibleTriangles).toBe(entry.submittedTriangles);
      expect(entry.modelBuildMs).toBeGreaterThanOrEqual(0);
      expect(entry.runtimeCompileMs).toBeGreaterThanOrEqual(0);
      for (const timing of Object.values(entry.timings) as Array<{
        readonly p50: number;
        readonly p95: number;
      }>) {
        expect(timing.p50).toBeGreaterThanOrEqual(0);
        expect(timing.p95).toBeGreaterThanOrEqual(timing.p50);
      }
      if (["instanced-2.10m", "unique-250k", "unique-1m", "unique-2m-local"].includes(entry.id)) {
        const phases = entry.selection?.phases;
        expect(phases).toHaveLength(3);
        if (phases === undefined) throw new Error("selection benchmark phases are missing");
        expect(entry.estimatedMemory.highlightBytes).toBeGreaterThan(0);
        expect(entry.estimatedMemory.pickReadbackBytes).toBeGreaterThan(0);
        for (const phase of phases) {
          expect(phase.returnedTargetCount).toBeGreaterThan(0);
          expect(phase.selectedOccurrenceCount).toBeGreaterThan(0);
          expect(phase.invalidSnapshotMs).toBeGreaterThan(0);
          expect(phase.cachedReadbackMs).toBeGreaterThan(0);
          expect(phase.interactionStateMs).toBeGreaterThan(0);
          expect(phase.interactionSyncMs).toBeGreaterThan(0);
          expect(phase.firstSelectedFrameMs).toBeGreaterThan(0);
          expect(phase.steadySelectedFrameMs.p95).toBeGreaterThanOrEqual(
            phase.steadySelectedFrameMs.p50,
          );
          expect(phase.clearSelectionMs).toBeGreaterThan(0);
          expect(phase.interactionGpuCost.writes["highlight"]?.bytes ?? 0).toBeGreaterThanOrEqual(
            0,
          );
          expect(phase.denseSelectionBytes).toBeGreaterThanOrEqual(0);
          expect(phase.selectedElementRecordBytes).toBeGreaterThan(0);
          if (phase.denseSelectionBytes > 0) {
            expect(phase.denseSelectionBytes).toBeLessThan(phase.selectedElementRecordBytes);
          }
          if (entry.id === "instanced-2.10m" && phase.id === "one-shell") {
            expect(phase.selectedOccurrenceCount).toBe(1);
          }
        }
      }
      if (entry.kind === "structured-fe") {
        expect(entry.structuredFamily).toBeDefined();
        expect(entry.nodeCount).toBeGreaterThan(entry.uniqueElementCount);
        expect(entry.faceCount).toBeGreaterThan(0);
      }
      if (entry.elementFamily === "triangle") {
        expect(entry.uniqueElementCount).toBe(entry.uniqueTriangles);
      }
      if (entry.elementFamily === "quad") {
        expect(entry.uniqueTriangles).toBe(entry.uniqueElementCount * 2);
      }
      if (spec.orientation === true) {
        const vectorDraw = entry.gpuCost.draws["vector-glyph"];
        const vectorWrite = entry.gpuCost.writes["vector-glyph"];
        if (vectorDraw === undefined || vectorWrite === undefined) {
          throw new Error("orientation benchmark report omitted vector-glyph counters");
        }
        expect(vectorDraw.calls).toBeGreaterThan(0);
        expect(vectorDraw.instances).toBeGreaterThan(0);
        expect(
          vectorWrite.calls,
          "orientation records must not be rewritten during steady-state frames",
        ).toBe(0);
        expect(vectorWrite.bytes).toBe(0);
      }
      if (entry.interactive !== undefined) {
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
    } finally {
      await context.close();
    }
  });
}

async function runBenchmarkWithTimeout(
  page: Page,
  includeLargeCase: boolean,
  caseId: string,
): Promise<WebGpuBenchmarkReport> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const benchmark = page.evaluate(
    ({ large, id }) =>
      (
        window as typeof window & {
          femgxDemo: BenchmarkSeam;
        }
      ).femgxDemo.runBenchmark(large, id),
    { large: includeLargeCase, id: caseId },
  );
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${caseId} failed during benchmark execution: timeout`));
    }, CASE_TIMEOUT_MS - 10_000);
  });
  try {
    return await Promise.race([benchmark, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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
