import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { benchmarkCaptureEvent, type BenchmarkCapture } from "../../../demo/benchmark/capture";
import type { WebGpuBenchmarkReport } from "../../../demo/benchmark/runner";
import { pixelMetrics } from "../../browser-support/screenshot";
import { rendererMode } from "../demo-support";

const enabled = process.env["RUN_PERF_HIDDEN_INTERIOR_VISUAL"] === "1";
const CASES = ["fe-tet4-solid-132k", "fe-hex8-solid-visual"] as const;
const CASE_TIMEOUT_MS = 4 * 60_000;

interface CaptureWindow extends Window {
  readonly femgxDemo: {
    readonly runBenchmark: (
      includeLarge: boolean,
      caseId: string,
      capture: BenchmarkCapture,
    ) => Promise<WebGpuBenchmarkReport>;
  };
  hiddenInteriorBenchmark?: Promise<WebGpuBenchmarkReport>;
}

test.skip(!enabled, "half-hidden FE interior visual evidence is opt-in");
test.setTimeout(CASE_TIMEOUT_MS);

for (const caseId of CASES) {
  test(`captures ${caseId} interior faces, edges, and nodes`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1_000, height: 760 });
    await page.goto("/");
    const canvas = page.getByTestId("view-canvas");
    await expect(canvas).toBeVisible();
    await expect.poll(() => rendererMode(page, canvas)).not.toBe("");
    if ((await rendererMode(page, canvas)) !== "webgpu") {
      test.skip(true, "the opt-in capture requires a real WebGPU adapter");
      return;
    }
    await startCapture(page, caseId);
    await waitForCaptureReady(canvas);
    try {
      await captureEvidence(page, canvas, testInfo, `${caseId}-desktop`);
      await page.setViewportSize({ width: 390, height: 844 });
      await captureEvidence(page, canvas, testInfo, `${caseId}-mobile-390x844`);
    } finally {
      await page.evaluate(
        (eventName) => window.dispatchEvent(new Event(eventName)),
        benchmarkCaptureEvent("hidden-interior"),
      );
    }
    await finishCapture(page, caseId);
  });
}

async function startCapture(page: Page, caseId: string): Promise<void> {
  await page.evaluate(
    ({ id }) => {
      const host = window as unknown as CaptureWindow;
      const pending = host.femgxDemo.runBenchmark(false, id, "hidden-interior");
      host.hiddenInteriorBenchmark = pending;
      void pending.catch(() => undefined);
    },
    { id: caseId },
  );
}

async function finishCapture(page: Page, caseId: string): Promise<void> {
  const report = await page.evaluate(async () => {
    const host = window as unknown as CaptureWindow;
    const pending = host.hiddenInteriorBenchmark;
    if (pending === undefined) throw new Error("Hidden-interior benchmark did not start");
    try {
      return await pending;
    } finally {
      delete host.hiddenInteriorBenchmark;
    }
  });
  expect(report.cases[0]?.id).toBe(caseId);
}

async function captureEvidence(
  page: Page,
  canvas: Locator,
  testInfo: TestInfo,
  label: string,
): Promise<void> {
  const metrics = await pixelMetrics(canvas);
  expect(metrics.distinctColors).toBeGreaterThan(2);
  const path = testInfo.outputPath(`${label}.png`);
  await page.screenshot({ path });
  await testInfo.attach(label, { path, contentType: "image/png" });
}

async function waitForCaptureReady(canvas: Locator): Promise<void> {
  await expect
    .poll(
      async () => {
        const error = await canvas.getAttribute("data-benchmark-capture-error");
        if (error !== null) return "error";
        return (await canvas.getAttribute("data-benchmark-capture")) === "hidden-interior"
          ? "ready"
          : "pending";
      },
      { timeout: CASE_TIMEOUT_MS - 20_000 },
    )
    .not.toBe("pending");
  const error = await canvas.getAttribute("data-benchmark-capture-error");
  if (error !== null) throw new Error(`Hidden-interior benchmark failed: ${error}`);
}
