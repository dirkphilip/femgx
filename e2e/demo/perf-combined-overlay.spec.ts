import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { benchmarkCaptureEvent, type BenchmarkCapture } from "../../demo/benchmark/capture";
import type { WebGpuBenchmarkReport } from "../../demo/benchmark/runner";
import { pixelMetrics } from "../browser-support/screenshot";
import { rendererMode } from "./demo-support";
import { expectTwoMillionInteractions } from "./perf-two-million-assertions";

const enabled = process.env["RUN_PERF_OVERLAY_VISUAL"] === "1";
const CASE_ID = "instanced-2.10m";
const CASE_TIMEOUT_MS = 3 * 60_000;

interface BenchmarkSeam {
  readonly runBenchmark: (
    includeLarge: boolean,
    caseId: string,
    capture: BenchmarkCapture,
  ) => Promise<WebGpuBenchmarkReport>;
}

interface CaptureWindow extends Window {
  readonly femgxDemo: BenchmarkSeam;
  combinedOverlayBenchmark?: Promise<WebGpuBenchmarkReport>;
}

test.skip(!enabled, "combined node and edge-presentation visual evidence is opt-in");
test.setTimeout(CASE_TIMEOUT_MS);

test("captures nodes, presentation edges, and dense selection on desktop and mobile", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1_000, height: 760 });
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(() => rendererMode(page, canvas)).not.toBe("");
  if ((await rendererMode(page, canvas)) !== "webgpu") {
    test.skip(true, "the opt-in capture requires a real WebGPU adapter");
    return;
  }
  await page.evaluate(
    ({ caseId }) => {
      const host = window as unknown as CaptureWindow;
      const pending = host.femgxDemo.runBenchmark(false, caseId, "combined-overlay");
      host.combinedOverlayBenchmark = pending;
      void pending.catch(() => undefined);
    },
    { caseId: CASE_ID },
  );
  await waitForCaptureReady(canvas);

  try {
    await captureEvidence(page, canvas, testInfo, "desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await captureEvidence(page, canvas, testInfo, "mobile-390x844");
  } finally {
    await page.evaluate(
      (eventName) => window.dispatchEvent(new Event(eventName)),
      benchmarkCaptureEvent("combined-overlay"),
    );
  }

  const report = await page.evaluate(async () => {
    const host = window as unknown as CaptureWindow;
    const pending = host.combinedOverlayBenchmark;
    if (pending === undefined) throw new Error("Combined-overlay benchmark did not start");
    try {
      return await pending;
    } finally {
      delete host.combinedOverlayBenchmark;
    }
  });
  const entry = report.cases[0];
  if (entry === undefined) throw new Error("Combined-overlay benchmark case is missing");
  console.log(
    `WEBGPU_COMBINED_OVERLAY_JSON ${JSON.stringify({
      fixedCamera: entry.combinedOverlay?.fixedCamera,
      movingCamera: entry.combinedOverlay?.movingCamera,
      retainedEdgeBufferUpperBoundBytes:
        entry.combinedOverlay?.estimatedRetainedEdgeBufferUpperBoundBytes,
      coldNodeInteractionSyncMs: entry.combinedOverlay?.coldNodeInteractionSyncMs,
      coldEdgeInteractionSyncMs: entry.combinedOverlay?.coldEdgeInteractionSyncMs,
      largeSelection: entry.combinedOverlay?.largeSelection,
    })}`,
  );
  expectTwoMillionInteractions(entry);
});

async function captureEvidence(
  page: Page,
  canvas: Locator,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  const metrics = await pixelMetrics(canvas);
  expect(metrics.distinctColors).toBeGreaterThan(1);
  const path = testInfo.outputPath(`combined-overlay-${label}.png`);
  await page.screenshot({ path });
  await testInfo.attach(`combined-overlay-${label}`, { path, contentType: "image/png" });
}

async function waitForCaptureReady(canvas: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        const error = await canvas.getAttribute("data-benchmark-capture-error");
        if (error !== null) return "error";
        return (await canvas.getAttribute("data-benchmark-capture")) === "combined-overlay"
          ? "ready"
          : "pending";
      },
      { timeout: CASE_TIMEOUT_MS - 20_000 },
    )
    .not.toBe("pending");
  const error = await canvas.getAttribute("data-benchmark-capture-error");
  if (error !== null) throw new Error(`Combined-overlay benchmark failed: ${error}`);
}
