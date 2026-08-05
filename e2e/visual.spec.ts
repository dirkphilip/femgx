import { expect, test, type Locator, type Page } from "@playwright/test";
import { requireHit } from "./helpers";

/**
 * Visual regression for the deterministic CPU renderer: solid, edge, and
 * selection modes must each produce stable, mode-distinct pixel output. The
 * default `chromium` project disables the GPU so the demo always commits to the
 * CPU renderer, whose 2D canvas output is deterministic frame to frame.
 */

async function pixelHash(canvas: Locator): Promise<string> {
  return canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("2d");
    if (context === null) {
      return "no-context";
    }
    const { data } = context.getImageData(0, 0, element.width, element.height);
    let hash = 0;
    for (let index = 0; index < data.length; index += 4) {
      hash =
        ((hash * 31 + (data[index] ?? 0)) * 31 +
          (data[index + 1] ?? 0) * 7 +
          (data[index + 2] ?? 0) * 3 +
          (data[index + 3] ?? 0)) >>>
        0;
    }
    return hash.toString(16);
  });
}

async function rendererMode(page: Page): Promise<string> {
  return (await page.getByTestId("view-canvas").getAttribute("data-renderer")) ?? "";
}

async function solidModeHash(page: Page): Promise<string> {
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  await expect.poll(() => rendererMode(page)).toBe("cpu");
  return pixelHash(page.getByTestId("view-canvas"));
}

test("solid mode renders deterministically across page loads", async ({ page }) => {
  const first = await solidModeHash(page);
  const second = await solidModeHash(page);
  expect(first, "solid mode pixel output must be deterministic").toBe(second);
});

test("edge mode differs from solid mode", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  await expect.poll(() => rendererMode(page)).toBe("cpu");

  const canvas = page.getByTestId("view-canvas");
  const solid = await pixelHash(canvas);

  await page.getByTestId("mode-edges").click();
  await expect(canvas).toHaveAttribute("data-mode", "edges");
  const edge = await pixelHash(canvas);

  expect(edge, "edge mode must render different pixels than solid").not.toBe(solid);
});

test("selection changes the rendered pixels and stays stable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-canvas")).toBeVisible();
  await expect.poll(() => rendererMode(page)).toBe("cpu");

  const canvas = page.getByTestId("view-canvas");
  const before = await pixelHash(canvas);

  // The default lane's pick is deterministic CPU raycasting; a hover that
  // never resolves means the interaction path is broken, not that this
  // environment lacks a capability, so this is a required assertion.
  const hoverPoint = await requireHit(
    page,
    canvas,
    { attribute: "hovered" },
    "a hoverable instance must resolve on the deterministic CPU renderer",
  );

  await page.mouse.click(hoverPoint.x, hoverPoint.y);
  await expect.poll(() => canvas.getAttribute("data-selected")).not.toBe("");

  const selected = await pixelHash(canvas);
  expect(selected, "selecting an instance must change the rendered pixels").not.toBe(before);

  const again = await pixelHash(canvas);
  expect(again, "the selected state must render deterministically").toBe(selected);
});
