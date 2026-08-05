import { expect, test, type CDPSession } from "@playwright/test";
import { requireHit } from "./helpers";

const BASE_URL = "http://127.0.0.1:5173";

type TouchEventType = "touchStart" | "touchMove" | "touchEnd" | "touchCancel";

interface TouchPoint {
  readonly x: number;
  readonly y: number;
  readonly id?: number;
}

/** Injects a raw touch event through CDP; Playwright's touchscreen API is single-touch only. */
async function dispatchTouch(
  client: CDPSession,
  type: TouchEventType,
  touchPoints: readonly TouchPoint[],
): Promise<void> {
  await client.send("Input.dispatchTouchEvent", { type, touchPoints: [...touchPoints] });
}

test("touch gestures orbit, pinch-zoom, and pan without leaving dragging stuck", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("canvas has no bounding box");
  }
  const center = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };

  const dragging = async (): Promise<string | null> => canvas.getAttribute("data-dragging");
  const cameraKey = async (): Promise<string | null> => canvas.getAttribute("data-camera");
  await expect.poll(dragging).toBe("false");

  const client = await context.newCDPSession(page);

  // A one-finger drag orbits the camera and must always release the gesture.
  const beforeOrbit = await cameraKey();
  await dispatchTouch(client, "touchStart", [{ x: center.x, y: center.y, id: 0 }]);
  await expect.poll(dragging).toBe("true");
  await dispatchTouch(client, "touchMove", [{ x: center.x + 60, y: center.y + 30, id: 0 }]);
  await dispatchTouch(client, "touchEnd", []);
  await expect.poll(dragging).toBe("false");
  expect(await cameraKey()).not.toBe(beforeOrbit);

  // A two-finger pinch zooms around the midpoint and midpoint movement pans.
  const beforePinch = await cameraKey();
  await dispatchTouch(client, "touchStart", [
    { x: center.x - 40, y: center.y, id: 0 },
    { x: center.x + 40, y: center.y, id: 1 },
  ]);
  await expect.poll(dragging).toBe("true");
  await dispatchTouch(client, "touchMove", [
    { x: center.x - 70, y: center.y + 20, id: 0 },
    { x: center.x + 70, y: center.y + 20, id: 1 },
  ]);
  await dispatchTouch(client, "touchMove", [
    { x: center.x - 80, y: center.y + 30, id: 0 },
    { x: center.x + 80, y: center.y + 30, id: 1 },
  ]);
  await dispatchTouch(client, "touchEnd", []);
  await expect.poll(dragging).toBe("false");
  expect(await cameraKey()).not.toBe(beforePinch);

  // An interrupted gesture (pointercancel) must clear the drag immediately.
  await dispatchTouch(client, "touchStart", [{ x: center.x, y: center.y, id: 0 }]);
  await expect.poll(dragging).toBe("true");
  await dispatchTouch(client, "touchCancel", []);
  await expect.poll(dragging).toBe("false");

  await context.close();
});

test("a one-finger tap still performs picking and selection", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();

  // The pick radius is 10 canvas pixels, so a 10px-spaced step grid guarantees
  // a point lands within the radius of any node center. A miss means the
  // picking path is broken, not that the environment lacks a capability.
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "n:", step: 10 },
    "node raycast picking must resolve on the deterministic CPU lane",
  );

  await page.touchscreen.tap(hit.x, hit.y);
  await expect.poll(async () => canvas.getAttribute("data-selected")).toMatch(/^n:/);

  await page.touchscreen.tap(hit.x, hit.y);
  await expect.poll(async () => canvas.getAttribute("data-selected")).toBe("");

  // A tap is not a drag: selection must leave no gesture stuck.
  await expect.poll(async () => canvas.getAttribute("data-dragging")).toBe("false");

  await context.close();
});
