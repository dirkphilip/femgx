import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import {
  dataset,
  drawnPixels,
  loadWebGpuPage,
  openCommandPanel,
  pixelHash,
  requireHit,
  setSelectionGranularity,
} from "../demo-support";

const enabled = process.env["FEMGX_TET4_BOUNDARY_EVIDENCE"] === "1";

test.skip(!enabled, "dense Tet4 boundary evidence is an opt-in hardware-WebGPU lane");

for (const cells of [47, 48, 50] as const) {
  test(`keeps ${cells}-cell Tet4 element and face selection subset-resident`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const runtime = watchRuntime(page);
    await instrumentGpuDevice(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loadWebGpuPage(page);
    const canvas = page.getByTestId("view-canvas");
    await page.getByTestId("performance-lab").click();
    await page.getByTestId("tet4-cells").fill(String(cells));
    await page.getByTestId("mesh-tet4").click();
    await expect(canvas).toHaveAttribute("data-model", `fe-tet4-dense-${cells}`, {
      timeout: 120_000,
    });
    await expect.poll(() => drawnPixels(canvas)).toBe(true);
    const element = await exerciseSelection(page, canvas, "element");
    await expect(page.getByTestId("inspection-panel")).toContainText(
      `${(cells * cells * 12).toLocaleString("en-US")} submitted exterior triangles`,
    );
    const beforeOrbit = await pixelHash(canvas);
    await orbitSelectionBehind(page, canvas);
    await expect.poll(() => dataset(page, "selected")).toBe(element.key);
    await expect.poll(() => pixelHash(canvas)).not.toBe(beforeOrbit);
    await page.mouse.move(element.x, element.y);
    await expect.poll(() => dataset(page, "hovered")).not.toBe(element.key);
    await capture(page, testInfo, `tet4-${cells}-desktop-element-hidden.png`);

    await openCommandPanel(page, "selection");
    await page.getByTestId("clear-selection").click();
    await exerciseSelection(page, canvas, "face");
    await capture(page, testInfo, `tet4-${cells}-desktop-face-selected.png`);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => drawnPixels(canvas)).toBe(true);
    await openCommandPanel(page, "selection");
    await page.getByTestId("clear-selection").click();
    const mobileElement = await exerciseSelection(page, canvas, "element");
    const mobileBeforeOrbit = await pixelHash(canvas);
    await orbitSelectionBehind(page, canvas);
    await expect.poll(() => dataset(page, "selected")).toBe(mobileElement.key);
    await expect.poll(() => pixelHash(canvas)).not.toBe(mobileBeforeOrbit);
    await capture(page, testInfo, `tet4-${cells}-mobile-element-hidden.png`);

    await openCommandPanel(page, "selection");
    await page.getByTestId("clear-selection").click();
    await exerciseSelection(page, canvas, "face");
    await capture(page, testInfo, `tet4-${cells}-mobile-face-selected.png`);
    await expectHealthyGpuDevice(page);
    expect(runtime).toEqual([]);
  });
}

interface SelectionHit {
  readonly key: string;
  readonly x: number;
  readonly y: number;
}

async function exerciseSelection(
  page: Page,
  canvas: Locator,
  granularity: "element" | "face",
): Promise<SelectionHit> {
  await setSelectionGranularity(page, granularity);
  const prefix = granularity === "element" ? "e:" : "f:";
  const hit = await requireHit(
    page,
    canvas,
    { prefix, attribute: "hovered", fresh: true },
    `${granularity} hover must resolve on dense Tet4 geometry`,
  );
  await expect.poll(() => dataset(page, "hovered")).toBe(hit.key);
  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toBe(hit.key);
  await page.mouse.move(1, 1);
  await expect.poll(() => dataset(page, "hovered")).toBe("");
  await page.mouse.move(hit.x, hit.y);
  await expect.poll(() => dataset(page, "hovered")).toBe(hit.key);
  await openCommandPanel(page, "selection");
  await page.getByTestId("clear-selection").click();
  await expect.poll(() => dataset(page, "selected")).toBe("");
  await page.mouse.move(hit.x, hit.y);
  await expect.poll(() => dataset(page, "hovered")).toBe(hit.key);
  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toBe(hit.key);
  await page.mouse.move(1, 1);
  await expect.poll(() => dataset(page, "hovered")).toBe("");
  await page.mouse.move(hit.x, hit.y);
  await expect.poll(() => dataset(page, "hovered")).toBe(hit.key);
  return hit;
}

async function orbitSelectionBehind(page: Page, canvas: Locator): Promise<void> {
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("dense Tet4 canvas has no bounds");
  const camera = await canvas.getAttribute("data-camera");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.5, { steps: 12 });
  await page.mouse.up({ button: "middle" });
  await expect.poll(() => canvas.getAttribute("data-camera")).not.toBe(camera);
  await page.mouse.move(1, 1);
}

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({ path: testInfo.outputPath(name), fullPage: true });
}

interface GpuEvidence {
  limits?: {
    readonly maxBufferSize: number;
    readonly maxStorageBufferBindingSize: number;
  };
  readonly uncapturedErrors: string[];
  readonly losses: string[];
}

interface RuntimeFailure {
  readonly kind: "pageerror" | "console-error";
  readonly detail: string;
}

function watchRuntime(page: Page): RuntimeFailure[] {
  const failures: RuntimeFailure[] = [];
  page.on("pageerror", (error) => failures.push({ kind: "pageerror", detail: error.message }));
  page.on("console", (message) => {
    if (message.type() === "error") {
      failures.push({ kind: "console-error", detail: message.text() });
    }
  });
  return failures;
}

async function instrumentGpuDevice(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const evidence: GpuEvidence = { uncapturedErrors: [], losses: [] };
    Object.assign(globalThis, { __femgxGpuEvidence: evidence });
    const gpu = navigator.gpu;
    const requestAdapter = gpu.requestAdapter.bind(gpu);
    Object.defineProperty(gpu, "requestAdapter", {
      configurable: true,
      value: async (...args: Parameters<GPU["requestAdapter"]>) => {
        const adapter = await requestAdapter(...args);
        if (adapter === null) return null;
        const requestDevice = adapter.requestDevice.bind(adapter);
        Object.defineProperty(adapter, "requestDevice", {
          configurable: true,
          value: async (...deviceArgs: Parameters<GPUAdapter["requestDevice"]>) => {
            const device = await requestDevice(...deviceArgs);
            evidence.limits = {
              maxBufferSize: device.limits.maxBufferSize,
              maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
            };
            device.addEventListener("uncapturederror", (event) => {
              evidence.uncapturedErrors.push(event.error.message);
            });
            void device.lost.then((info) => evidence.losses.push(`${info.reason}:${info.message}`));
            return device;
          },
        });
        return adapter;
      },
    });
  });
}

async function expectHealthyGpuDevice(page: Page): Promise<void> {
  const evidence = await page.evaluate(
    () =>
      (globalThis as typeof globalThis & { __femgxGpuEvidence: GpuEvidence }).__femgxGpuEvidence,
  );
  expect(evidence.limits?.maxBufferSize).toBeGreaterThan(0);
  expect(evidence.limits?.maxStorageBufferBindingSize).toBeGreaterThanOrEqual(80);
  expect(evidence.uncapturedErrors).toEqual([]);
  expect(evidence.losses).toEqual([]);
}
