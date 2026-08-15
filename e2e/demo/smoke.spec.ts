import { expect, test, type Page } from "@playwright/test";
import { rendererMode, waitForRenderer } from "./demo-support";
import { drawnPixels, pixelHash, requireHit } from "../browser-support/helpers";

/**
 * Required browser smoke contract (category 1 in `wiki/engineering/e2e-policy.md`).
 *
 * One deterministic journey that proves the demo loads, renders, and reacts to
 * a representative user action with both a state change and a meaningful
 * visible outcome — while never raising unexpected page exceptions or browser
 * console errors. A partially broken app (an exception mid-frame, a swallowed
 * console error, state updated without a visible redraw) fails this test and
 * therefore fails the required e2e job.
 *
 * Feature-specific behavior stays in the owning partitioned demo and WebGPU
 * suites; this contract only pins the vertical.
 */

interface RuntimeFailure {
  readonly kind: "pageerror" | "console-error";
  readonly detail: string;
}

/** Records unexpected page exceptions and browser console errors for the test. */
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

test("loads, renders, and reacts to a user action without runtime errors", async ({ page }) => {
  const runtime = watchRuntime(page);

  await page.goto("/");

  // Load: WebGPU is the product's only renderer, so the demo commits to the
  // hardware WebGPU renderer on the default lane.
  const canvas = page.getByTestId("view-canvas");
  await waitForRenderer(page, canvas);

  // Render: the workbench reports the loaded model and the canvas has drawn
  // geometry, not just the page chrome.
  await expect(page.getByTestId("status")).toContainText("Bolted plate assembly");
  await expect.poll(async () => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);
  const before = await pixelHash(canvas);

  // Pick/click without screenshots in between: screenshots can stall GPU pick
  // readback. `requireHit` warms a frame after the hash capture.
  const hit = await requireHit(
    page,
    canvas,
    {},
    "GPU picking must resolve on the hardware WebGPU lane",
  );
  await page.mouse.move(hit.x, hit.y);
  await page.waitForTimeout(100);
  await page.mouse.click(hit.x, hit.y, { delay: 20 });

  // Observable result: application state reflects the selection and the
  // rendered output changes to show it. Both are stable semantic assertions.
  await expect
    .poll(() => canvas.getAttribute("data-selected"), { timeout: 10_000 })
    .toMatch(/^[nfe]:/);
  expect(await pixelHash(canvas), "selecting a target must redraw the scene").not.toBe(before);

  // The whole journey must be free of unexpected runtime errors.
  expect(
    runtime,
    "the smoke journey must not raise unexpected page exceptions or console errors",
  ).toEqual([]);
});

test("surfaces a deterministic shader validation failure without a healthy renderer", async ({
  page,
}) => {
  const runtime = watchRuntime(page);

  await page.goto("/?testShaderFailure=triangle%20color%20vertex");

  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(() => rendererMode(page, canvas), { timeout: 10_000 }).toBe("error");
  await expect(page.getByTestId("status")).toContainText("Injected shader failure");
  await expect(page.getByTestId("status")).toContainText("triangle color vertex");
  expect(await canvas.getAttribute("data-frames")).toBeNull();
  expect(runtime, "shader validation should be surfaced through the page UI").toEqual([]);
});
