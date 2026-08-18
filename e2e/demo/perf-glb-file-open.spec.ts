import { mkdir, stat, writeFile } from "node:fs/promises";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { makeMechanicalAssemblyGlb } from "../../demo/benchmark/glb-fixture";
import { activateContextAction, drawnPixels, openCommandPanel, rendererMode } from "./demo-support";

const enabled = process.env["RUN_GLB_VIEWPORT_PERF"] === "1";
const baseURL = process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:5173";
const requestedCounts = (process.env["GLB_FILE_PART_COUNTS"] ?? "1000,10000,74433")
  .split(",")
  .map(Number);
const mobile = process.env["GLB_FILE_MOBILE"] === "1";

interface FileOpenResult {
  readonly partCount: number;
  readonly byteLength: number;
  readonly loadToVisibleMs: number;
  readonly reusablePartCount: number;
  readonly drawBatchCount: number;
  readonly surfaceFps: number;
  readonly edgeToggleMs: number;
  readonly edgeFps: number;
  readonly nodeToggleMs: number;
  readonly nodeFps: number;
}

test.skip(!enabled, "full GLB file-open performance is opt-in");
test.setTimeout(5 * 60_000);

test("opens representative GLB files through the real demo file input", async ({
  browser,
}, testInfo) => {
  const results: FileOpenResult[] = [];
  for (const partCount of requestedCounts)
    results.push(await runFileCase(browser, testInfo, partCount));
  console.log(`GLB_FILE_OPEN_BENCHMARK_JSON ${JSON.stringify(results)}`);
  expect(results.at(-1)?.partCount).toBe(requestedCounts.at(-1));
  for (const result of results) {
    expect(result.loadToVisibleMs).toBeLessThan(10_000);
    expect(result.reusablePartCount).toBeLessThanOrEqual(5);
    expect(result.drawBatchCount).toBeLessThanOrEqual(5);
    expect(result.surfaceFps).toBeGreaterThanOrEqual(30);
    expect(result.edgeFps).toBeGreaterThanOrEqual(30);
    expect(result.nodeFps).toBeGreaterThanOrEqual(30);
  }
});

async function runFileCase(
  browser: Browser,
  testInfo: TestInfo,
  partCount: number,
): Promise<FileOpenResult> {
  await mkdir(testInfo.outputDir, { recursive: true });
  const path = testInfo.outputPath(`mechanical-assembly-${partCount}.glb`);
  await writeFile(path, makeMechanicalAssemblyGlb(partCount));
  const byteLength = (await stat(path)).size;
  const context = await browser.newContext({ baseURL, viewport: { width: 1_000, height: 760 } });
  const page = await context.newPage();
  try {
    await page.goto("/");
    const canvas = page.getByTestId("view-canvas");
    await expect.poll(() => rendererMode(page, canvas)).toBe("webgpu");
    const loadStart = performance.now();
    await page.getByTestId("model-file").setInputFiles(path);
    await expect(canvas).toHaveAttribute("data-model", /^opened-model-\d+$/, { timeout: 120_000 });
    await expect.poll(() => drawnPixels(canvas), { timeout: 120_000 }).toBe(true);
    const loadToVisibleMs = performance.now() - loadStart;
    await expect(page.getByTestId("model-select")).toContainText(
      `mechanical-assembly-${partCount}.glb`,
    );
    await expect(page.getByTestId("status")).toContainText("parts");
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await openCommandPanel(page, "display");
    await page.getByTestId("continuous-rendering").click();
    await activateContextAction(page, "diagnostics");
    const surfaceFps = await sampleFps(page);
    const diagnostics = (await page.getByTestId("stats-panel").textContent()) ?? "";
    const reusablePartCount = metric(diagnostics, "Reusable parts");
    const drawBatchCount = metric(diagnostics, "Draw batches");
    await page.screenshot({
      path: testInfo.outputPath(
        `mechanical-assembly-${partCount}-surface${mobile ? "-mobile" : ""}.png`,
      ),
    });
    await openCommandPanel(page, "display");
    const edgeStart = performance.now();
    await page.getByTestId("edge-overlay").click();
    const edgeToggleMs = performance.now() - edgeStart;
    const edgeFps = await sampleFps(page);
    await canvas.hover({ force: true, position: { x: 20, y: 20 } });
    await page.mouse.wheel(0, -2_000);
    await page.waitForTimeout(250);
    await page.screenshot({
      path: testInfo.outputPath(
        `mechanical-assembly-${partCount}-edges${mobile ? "-mobile" : ""}.png`,
      ),
    });
    await openCommandPanel(page, "display");
    const nodeStart = performance.now();
    await page.getByTestId("edge-overlay").click();
    await page.getByTestId("node-overlay").click();
    const nodeToggleMs = performance.now() - nodeStart;
    const nodeFps = await sampleFps(page);
    await openCommandPanel(page, "display");
    await page.getByTestId("continuous-rendering").click();
    return {
      partCount,
      byteLength,
      loadToVisibleMs,
      reusablePartCount,
      drawBatchCount,
      surfaceFps,
      edgeToggleMs,
      edgeFps,
      nodeToggleMs,
      nodeFps,
    };
  } finally {
    await context.close();
  }
}

function metric(text: string, label: string): number {
  const match = new RegExp(`${label}\\s+([0-9,]+)`).exec(text);
  if (match?.[1] === undefined) throw new Error(`Demo reported no ${label}: ${text}`);
  return Number(match[1].replaceAll(",", ""));
}

async function sampleFps(page: Page): Promise<number> {
  await page.waitForTimeout(2_500);
  const text = (await page.getByTestId("stats-panel").textContent()) ?? "";
  const match = /Average FPS\s+([0-9.]+)/.exec(text);
  if (match?.[1] === undefined) throw new Error(`Demo reported no FPS sample: ${text}`);
  return Number(match[1]);
}
