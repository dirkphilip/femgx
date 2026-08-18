import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import {
  benchmarkCaptureEvent,
  type BenchmarkCapture,
  type ElementSelectionCapture,
} from "../../demo/benchmark/capture";
import type { WebGpuBenchmarkReport } from "../../demo/benchmark/runner";
import { rendererMode } from "./demo-support";

const enabled = process.env["RUN_PERF_SELECTION_COLOR"] === "1";
const CASE_ID = "fe-tet4-solid-132k";
const CASE_TIMEOUT_MS = 3 * 60_000;

interface BenchmarkSeam {
  readonly runBenchmark: (
    includeLarge: boolean,
    caseId: string,
    capture: BenchmarkCapture,
  ) => Promise<WebGpuBenchmarkReport>;
}

interface CaptureWindow {
  readonly femgxDemo: BenchmarkSeam;
  elementSelectionBenchmark?: Promise<WebGpuBenchmarkReport>;
}

interface OrangeMetrics {
  readonly pixels: number;
  readonly dominantRgb: number;
}

test.skip(!enabled, "selection color evidence is opt-in");
test.setTimeout(CASE_TIMEOUT_MS);

test("keeps all-minus-one and all-selected triangle colors pixel-identical", async ({
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
      const pending = host.femgxDemo.runBenchmark(false, caseId, "element-selection");
      host.elementSelectionBenchmark = pending;
      void pending.catch(() => undefined);
    },
    { caseId: CASE_ID },
  );

  const captures = new Map<ElementSelectionCapture, OrangeMetrics>();
  try {
    for (const phase of ["all-but-one", "all-authored"] as const) {
      await waitForCaptureReady(canvas, phase);
      captures.set(phase, await captureOrange(canvas, page, testInfo, phase));
      await releaseCapture(page, phase);
    }
  } finally {
    await releaseCapture(page, "all-but-one");
    await releaseCapture(page, "all-authored");
  }

  const report = await page.evaluate(async () => {
    const pending = (window as unknown as CaptureWindow).elementSelectionBenchmark;
    if (pending === undefined) throw new Error("Element-selection benchmark did not start");
    return pending;
  });
  const entry = report.cases[0];
  if (entry === undefined) throw new Error("Element-selection benchmark case is missing");
  const allButOne = captures.get("all-but-one");
  const allSelected = captures.get("all-authored");
  if (allButOne === undefined || allSelected === undefined) {
    throw new Error("Element-selection screenshots are missing");
  }
  expect(allButOne.dominantRgb).toBe(allSelected.dominantRgb);
  expect(allSelected.pixels).toBeGreaterThan(allButOne.pixels);
  for (const phase of entry.selection?.phases.filter((candidate) =>
    ["all-but-one", "all-authored"].includes(candidate.id),
  ) ?? []) {
    expect(phase.cameraTransition.firstFrameCpu).toEqual({
      "instance-scan": 0,
      "order-rebuild": 0,
      "call-rebuild": 0,
    });
  }
});

async function releaseCapture(page: Page, phase: ElementSelectionCapture): Promise<void> {
  const eventName = benchmarkCaptureEvent("element-selection", phase);
  await page.evaluate((name) => window.dispatchEvent(new Event(name)), eventName);
}

async function waitForCaptureReady(canvas: Locator, phase: ElementSelectionCapture): Promise<void> {
  await expect
    .poll(
      async () => {
        const error = await canvas.getAttribute("data-benchmark-capture-error");
        if (error !== null) return "error";
        return (await canvas.getAttribute("data-benchmark-capture")) ===
          `element-selection-${phase}`
          ? "ready"
          : "pending";
      },
      { timeout: CASE_TIMEOUT_MS - 20_000 },
    )
    .not.toBe("pending");
  const error = await canvas.getAttribute("data-benchmark-capture-error");
  if (error !== null) throw new Error(`Element-selection benchmark failed: ${error}`);
}

async function captureOrange(
  canvas: Locator,
  page: Page,
  testInfo: TestInfo,
  phase: ElementSelectionCapture,
): Promise<OrangeMetrics> {
  const path = testInfo.outputPath(`tet4-selection-${phase}.png`);
  const encoded = (await canvas.screenshot({ path })).toString("base64");
  await testInfo.attach(`tet4-selection-${phase}`, { path, contentType: "image/png" });
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const image = document.createElement("canvas");
    image.width = bitmap.width;
    image.height = bitmap.height;
    const context = image.getContext("2d");
    if (context === null) throw new Error("no 2d context for selection pixel evidence");
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    const colors = new Map<number, number>();
    let pixels = 0;
    for (let index = 0; index < data.length; index += 4) {
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      if (red >= 200 && green >= 60 && green <= 190 && blue <= 80) {
        const rgb = (red << 16) | (green << 8) | blue;
        colors.set(rgb, (colors.get(rgb) ?? 0) + 1);
        pixels += 1;
      }
    }
    let dominantRgb = 0;
    let dominantCount = 0;
    for (const [rgb, count] of colors) {
      if (count > dominantCount) {
        dominantRgb = rgb;
        dominantCount = count;
      }
    }
    bitmap.close();
    return { pixels, dominantRgb };
  }, encoded);
}
