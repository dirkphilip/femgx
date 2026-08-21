import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { benchmarkCaptureEvent, type BenchmarkCapture } from "../../demo/benchmark/capture";
import type { WebGpuBenchmarkReport } from "../../demo/benchmark/runner";
import { pixelMetrics } from "../browser-support/screenshot";
import { rendererMode } from "./demo-support";
import {
  expectDenseNodeSelectionReport,
  expectNodeSelectionReport,
} from "./perf-node-selection-assertions";

const enabled = process.env["RUN_PERF_NODE_VISUAL"] === "1";
const CASE_ID = "fe-tet4-solid-132k";
const MILLION_CASE_ID = "unique-2m-local";
const MILLION_NODE_COUNT = 1_002_001;
const CASE_TIMEOUT_MS = 10 * 60_000;

interface BenchmarkSeam {
  readonly runBenchmark: (
    includeLarge: boolean,
    caseId: string,
    capture: BenchmarkCapture,
  ) => Promise<WebGpuBenchmarkReport>;
}

interface CaptureWindow extends Window {
  readonly femgxDemo: BenchmarkSeam;
  nodeSelectionBenchmark?: Promise<WebGpuBenchmarkReport>;
}

test.skip(!enabled, "dense node-selection visual evidence is opt-in");
test.setTimeout(CASE_TIMEOUT_MS);

test("captures dense node selection on desktop and mobile viewports", async ({
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
      const pending = host.femgxDemo.runBenchmark(false, caseId, "node-selection");
      host.nodeSelectionBenchmark = pending;
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
      benchmarkCaptureEvent("node-selection"),
    );
  }

  const report = await page.evaluate(async () => {
    const host = window as unknown as CaptureWindow;
    const pending = host.nodeSelectionBenchmark;
    if (pending === undefined) throw new Error("Dense node-selection benchmark did not start");
    try {
      return await pending;
    } finally {
      delete host.nodeSelectionBenchmark;
    }
  });
  expect(report.schemaVersion).toBe(12);
  const entry = report.cases[0];
  if (entry === undefined) throw new Error("Dense node-selection benchmark case is missing");
  expect(entry.id).toBe(CASE_ID);
  expectDenseNodeSelectionReport(entry);
  await attachNodeSelectionReport(testInfo, entry);
});

test("records the selected-node matrix for the 1,002,001-node reference", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(() => rendererMode(page, canvas)).not.toBe("");
  if ((await rendererMode(page, canvas)) !== "webgpu") {
    test.skip(true, "the opt-in benchmark requires a real WebGPU adapter");
    return;
  }
  const report = await page.evaluate(
    ({ caseId }) =>
      (window as unknown as CaptureWindow).femgxDemo.runBenchmark(true, caseId, "node-selection"),
    { caseId: MILLION_CASE_ID },
  );
  const entry = report.cases[0];
  if (entry === undefined) throw new Error("Million-node benchmark case is missing");
  expect(entry.id).toBe(MILLION_CASE_ID);
  expectNodeSelectionReport(entry, MILLION_NODE_COUNT);
  await attachNodeSelectionReport(testInfo, entry);
});

async function attachNodeSelectionReport(
  testInfo: TestInfo,
  entry: WebGpuBenchmarkReport["cases"][number],
): Promise<void> {
  await testInfo.attach(`${entry.id}-node-selection-report`, {
    body: JSON.stringify(entry.nodeSelection, undefined, 2),
    contentType: "application/json",
  });
}

async function captureEvidence(
  page: Page,
  canvas: Locator,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  const metrics = await pixelMetrics(canvas);
  expect(metrics.distinctColors).toBeGreaterThan(1);
  expect(metrics.saturatedPixels).toBeGreaterThan(100);
  expect(metrics.orangePixels).toBeGreaterThan(100);
  const path = testInfo.outputPath(`dense-node-selection-${label}.png`);
  await page.screenshot({ path });
  await testInfo.attach(`dense-node-selection-${label}`, { path, contentType: "image/png" });
}

async function waitForCaptureReady(canvas: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        const error = await canvas.getAttribute("data-benchmark-capture-error");
        if (error !== null) return "error";
        return (await canvas.getAttribute("data-benchmark-capture")) === "node-selection"
          ? "ready"
          : "pending";
      },
      { timeout: CASE_TIMEOUT_MS - 20_000 },
    )
    .not.toBe("pending");
  const error = await canvas.getAttribute("data-benchmark-capture-error");
  if (error !== null) throw new Error(`Dense node-selection benchmark failed: ${error}`);
}
