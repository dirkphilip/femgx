import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { WebGpuBenchmarkReport } from "../../demo/benchmark/runner";
import { rendererMode } from "./demo-support";
import { expectDenseNodeSelectionReport } from "./perf-node-selection-assertions";
import { expectDenseTet4HoverReport } from "./perf-tet4-assertions";
import { expectTwoMillionInteractions } from "./perf-two-million-assertions";
import { expectManyPieceReport } from "./perf-many-piece-assertions";
import * as selectionAssertions from "./perf-selection-assertions";

const enabled = process.env["RUN_PERF"] === "1";
const includeLarge = process.env["RUN_PERF_LARGE"] === "1";
const baseURL = process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:5173";
const PHONE_FREE_VIEWPORT = { width: 1_000, height: 760 };
const CASE_TIMEOUT_MS = includeLarge ? 5 * 60_000 : 2 * 60_000;
let caseArtifactDirectory: string | undefined;

const benchmarkCaseSpecs = enabled
  ? (await import("../../demo/benchmark/model")).benchmarkCaseSpecs
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
      deviceScaleFactor: spec.id === "unique-250k" ? 2 : 1,
    });
    const page = await context.newPage();
    try {
      await page.goto("/");
      const canvas = page.getByTestId("view-canvas");
      await expect(canvas).toBeVisible();
      await expect.poll(() => rendererMode(page, canvas)).not.toBe("");
      const renderer = await rendererMode(page, canvas);
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

      expect(report.schemaVersion).toBe(12);
      expect(report.cases).toHaveLength(1);
      const [entry] = report.cases;
      expect(entry?.id).toBe(spec.id);
      expect(report.memoryEstimateScope).toContain("renderer-owned");
      expect(report.timestampQueries).toMatchObject({
        available: expect.any(Boolean),
        enabled: expect.any(Boolean),
      });
      expect(report.resolution).toEqual({
        width: 800,
        height: 600,
        dpr: spec.id === "unique-250k" ? 2 : 1,
      });
      expect(entry?.estimatedMemory.visibleColorBytes).toBeGreaterThan(0);
      if (entry === undefined) throw new Error("Benchmark report case is missing");
      expect(entry.elementFamily).toBeDefined();
      expect(entry.uniqueElementCount).toBeGreaterThan(1);
      expect(entry.submittedElementOccurrences).toBeGreaterThan(0);
      expect(entry.uniqueTriangles).toBeGreaterThan(0);
      expect(entry.submittedTriangles).toBeGreaterThan(0);
      if (entry.submittedTriangles < entry.uniqueTriangles) {
        expect(entry.estimatedMemory.subsetBytes).toBeGreaterThan(0);
      }
      expect(entry.visibleTriangles).toBe(entry.submittedTriangles);
      expect(entry.modelBuildMs).toBeGreaterThanOrEqual(0);
      expect(entry.runtimeCompileMs).toBeGreaterThanOrEqual(0);
      expect(entry.presentation).toMatchObject({
        nodeSizeCssPixels: 6,
        devicePixelRatio: report.resolution.dpr,
        projectionProxy: "camera-space point-size",
        cpuProxy: "node draw calls and instances",
      });
      expect(entry.gpuTimestamps.available).toBe(report.timestampQueries.enabled);
      if (entry.gpuTimestamps.available) {
        expect(entry.gpuTimestamps.sampleCount).toBeGreaterThan(0);
        const opaqueTimestamps = entry.gpuTimestamps.passes["opaque"];
        if (opaqueTimestamps === undefined) throw new Error("opaque timestamp stats are missing");
        expect(opaqueTimestamps.sampleCount).toBeGreaterThan(0);
        expect(opaqueTimestamps.p50).not.toBeNull();
      } else {
        expect(entry.gpuTimestamps.sampleCount).toBe(0);
        expect(entry.gpuTimestamps.unit).toBe("none");
      }
      expect(entry.timings.uploadAndFirstFrameCpuMs.p50).toBeGreaterThanOrEqual(0);
      expect(entry.timings.uploadAndFirstFrameCpuMs.p95).toBeGreaterThanOrEqual(
        entry.timings.uploadAndFirstFrameCpuMs.p50,
      );
      expect(entry.timings.visibleFrameCpuMs.p50).toBeGreaterThanOrEqual(0);
      expect(entry.timings.visibleFrameCpuMs.p95).toBeGreaterThanOrEqual(
        entry.timings.visibleFrameCpuMs.p50,
      );
      expect(entry.rendererCreateMs).toBeGreaterThanOrEqual(0);
      for (const timing of Object.values(entry.timings) as Array<{
        readonly p50: number;
        readonly p95: number;
      }>) {
        expect(timing.p50).toBeGreaterThanOrEqual(0);
        expect(timing.p95).toBeGreaterThanOrEqual(timing.p50);
      }
      if (
        [
          "instanced-2.10m",
          "unique-250k",
          "unique-1m",
          "unique-2m-local",
          "fe-tet4-solid-132k",
        ].includes(entry.id)
      ) {
        const phases = entry.selection?.phases;
        const authoredTwoMillionCase =
          entry.id === "instanced-2.10m" || entry.id === "unique-2m-local";
        expect(phases).toHaveLength(selectionAssertions.expectedSelectionPhaseCount(entry.id));
        if (phases === undefined) throw new Error("selection benchmark phases are missing");
        expect(entry.estimatedMemory.highlightBytes).toBeGreaterThan(0);
        expect(entry.estimatedMemory.pickReadbackBytes).toBeGreaterThan(0);
        for (const phase of phases) {
          const authoredPhase = phase.id.endsWith("-authored") || phase.id === "all-but-one";
          expect(phase.returnedTargetCount).toBeGreaterThan(0);
          expect(phase.selectedOccurrenceCount).toBeGreaterThan(0);
          expect(phase.targetConstructionMs).toBeGreaterThanOrEqual(0);
          if (authoredPhase) {
            expect(phase.invalidSnapshotMs).toBe(0);
            expect(phase.cachedReadbackMs).toBe(0);
          } else {
            expect(phase.invalidSnapshotMs).toBeGreaterThan(0);
            expect(phase.cachedReadbackMs).toBeGreaterThan(0);
          }
          if (authoredPhase || phase.id === "one-shell") {
            expect(phase.interactionStateMs).toBeGreaterThanOrEqual(0);
          } else {
            expect(phase.interactionStateMs).toBeGreaterThan(0);
          }
          if (authoredPhase) {
            expect(phase.interactionSyncMs).toBeGreaterThanOrEqual(0);
            expect(phase.firstSelectedFrameMs).toBeGreaterThanOrEqual(0);
          } else {
            expect(phase.interactionSyncMs).toBeGreaterThan(0);
            expect(phase.firstSelectedFrameMs).toBeGreaterThan(0);
          }
          expect(phase.interactionHighlightWriteBytes).toBeGreaterThan(0);
          expect(phase.steadySelectedFrameMs.p95).toBeGreaterThanOrEqual(
            phase.steadySelectedFrameMs.p50,
          );
          if (authoredPhase) {
            expect(phase.clearSelectionMs).toBeGreaterThanOrEqual(0);
          } else {
            expect(phase.clearSelectionMs).toBeGreaterThan(0);
          }
          expect(phase.denseSelectionBytes).toBeGreaterThanOrEqual(0);
          expect(phase.selectedElementRecordBytes).toBeGreaterThan(0);
          if (phase.denseSelectionBytes > 0) {
            expect(phase.denseSelectionBytes).toBeLessThan(phase.selectedElementRecordBytes);
          }
          if (entry.id === "instanced-2.10m" && phase.id === "one-shell") {
            expect(phase.selectedOccurrenceCount).toBe(1);
          }
        }
        if (authoredTwoMillionCase) {
          const one = phases.find((phase) => phase.id === "one-authored");
          const half = phases.find((phase) => phase.id === "half-authored");
          const all = phases.find((phase) => phase.id === "all-authored");
          expect(one?.returnedTargetCount).toBe(1);
          expect(half?.returnedTargetCount).toBe(Math.ceil(entry.uniqueElementCount / 2));
          expect(all?.returnedTargetCount).toBe(entry.uniqueElementCount);
          expect(one?.selectedOccurrenceCount).toBe(1);
          expect(half?.selectedOccurrenceCount).toBe(1);
          expect(all?.selectedOccurrenceCount).toBe(1);
          expect(half?.denseSelectionBytes).toBeGreaterThan(0);
          expect(all?.denseSelectionBytes).toBeGreaterThan(0);
        }
        selectionAssertions.expectCompleteUniqueSelection(entry);
      }
      expectTwoMillionInteractions(entry);
      expectManyPieceReport(entry);
      selectionAssertions.expectSelectionHideWorkflow(entry);
      if (entry.kind === "structured-fe") {
        expect(entry.structuredFamily).toBeDefined();
        expect(entry.nodeCount).toBeGreaterThan(0);
        expect(entry.faceCount).toBeGreaterThan(0);
      }
      if (entry.elementFamily === "tet4") expectDenseTet4HoverReport(entry);
      if (entry.id === "fe-tet4-solid-132k") {
        expectDenseNodeSelectionReport(entry);
        expect(entry.denseBuild).toMatchObject({
          generationMs: expect.any(Number),
          topologyMs: expect.any(Number),
          tessellationMs: expect.any(Number),
          transferPreparationMs: expect.any(Number),
          workerRoundTripMs: expect.any(Number),
          mainReconstructionMs: expect.any(Number),
          transferredBytes: expect.any(Number),
          finalRetainedTypedBytes: expect.any(Number),
          semanticAllocationCounts: expect.objectContaining({
            elementDescriptors: 0,
            faceDescriptors: 0,
            edgeDescriptors: 0,
            semanticIndex: expect.objectContaining({
              nodeTriangleFaceIdsBytes: expect.any(Number),
              neighborTriangleFaceOffsetsBytes: expect.any(Number),
              neighborTriangleFaceIdsBytes: expect.any(Number),
            }),
          }),
        });
        expect(entry.uniqueElementCount).toBe(131_712);
        expect(entry.submittedElementOccurrences).toBe(9_240);
        expect(entry.nodeCount).toBe(24_389);
        expect(entry.faceCount).toBe(526_848);
        expect(entry.uniqueTriangles).toBe(526_848);
        expect(entry.submittedTriangles).toBe(9_408);
        expect(
          (entry.denseBuild?.semanticAllocationCounts.semanticIndex
            .neighborTriangleFaceOffsetsBytes ?? 0) +
            (entry.denseBuild?.semanticAllocationCounts.semanticIndex
              .neighborTriangleFaceIdsBytes ?? 0),
        ).toBe(2_596_612);
        expect(entry.interactive).toBeDefined();
        const broad = entry.selection?.phases.find((phase) => phase.id === "broad");
        if (broad === undefined) throw new Error("Tet4 broad selection phase is missing");
        expect(broad.returnedTargetCount).toBe(4_704);
        const allAuthored = entry.selection?.phases.find((phase) => phase.id === "all-authored");
        const allButOne = entry.selection?.phases.find((phase) => phase.id === "all-but-one");
        if (allAuthored === undefined) throw new Error("Tet4 all-authored phase is missing");
        if (allButOne === undefined) throw new Error("Tet4 all-but-one phase is missing");
        expect(allButOne.returnedTargetCount).toBe(131_711);
        expect(allButOne.selectedOccurrenceCount).toBe(1);
        expect(allButOne.interactionGpuCost.draws["selection-visible"]).toEqual({
          calls: 4,
          indices: 28_233,
          instances: 4,
        });
        expect(allButOne.interactionGpuCost.draws["selection-hidden"]).toEqual({
          calls: 4,
          indices: 28_233,
          instances: 4,
        });
        expect(allButOne.steadySelectedFrameMs.p95).toBeLessThan(8.3);
        expect(broad.firstSelectedFrameMs).toBeLessThan(33.3);
        expect(allAuthored.returnedTargetCount).toBe(131_712);
        expect(allAuthored.selectedOccurrenceCount).toBe(1);
        expect(allAuthored.denseSelectionBytes).toBe(16_468);
        expect(allAuthored.selectedElementRecordBytes).toBe(6_322_176);
        expect(allAuthored.interactionGpuCost.passes["transparency"]).toBeGreaterThan(0);
        expect(allAuthored.interactionGpuCost.draws["selection-visible"]).toEqual({
          calls: 1,
          indices: 28_224,
          instances: 1,
        });
        expect(allAuthored.interactionGpuCost.draws["selection-hidden"]).toEqual({
          calls: 1,
          indices: 28_224,
          instances: 1,
        });
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
          selectionAssertions.cameraPositionDistance(
            entry.interactive.fixedCamera.finalCamera,
            entry.interactive.movingCamera.finalCamera,
          ),
        ).toBeGreaterThan(0);
      }
      if (entry.id === "instanced-2.10m") {
        expect(entry.overlayInteractive).toBeDefined();
        if (entry.overlayInteractive === undefined) {
          throw new Error("instanced overlay samples are missing");
        }
        const overlaySamples = [
          entry.overlayInteractive.surface,
          entry.overlayInteractive.nodes,
          entry.overlayInteractive.edges,
          entry.overlayInteractive.edgesAndNodes,
        ];
        for (const sample of overlaySamples) {
          expect(sample.durationMs).toBeGreaterThan(0);
          expect(sample.frameCount).toBeGreaterThan(0);
          expect(sample.fps).toBeGreaterThan(0);
          expect(sample.p95FrameIntervalMs).toBeGreaterThanOrEqual(sample.p50FrameIntervalMs);
        }
        expect(entry.estimatedMemory.edgeIndexBytes).toBeGreaterThan(0);
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
