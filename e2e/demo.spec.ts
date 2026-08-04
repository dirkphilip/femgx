import { expect, test } from "@playwright/test";

test("renders the demo canvas with instanced geometry", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();

  const drawn = await canvas.evaluate((el: HTMLCanvasElement) => {
    const context = el.getContext("2d");
    if (context === null) {
      return false;
    }
    const { data } = context.getImageData(0, 0, el.width, el.height);
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha !== 0) {
        return true;
      }
    }
    return false;
  });

  expect(drawn).toBe(true);
});

test("renders the deterministic element gallery summary", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("status")).toHaveText(
    "8 instances · 8 reusable parts · solid · perspective camera",
  );
});

test("switches element render modes", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("mode-surface").click();
  await expect(page.getByTestId("status")).toHaveText(
    "8 instances · 8 reusable parts · surface · perspective camera",
  );
  await page.getByTestId("mode-edges").click();
  await expect(page.getByTestId("status")).toHaveText(
    "8 instances · 8 reusable parts · edges · perspective camera",
  );
  await page.getByTestId("mode-solid").click();
  await expect(page.getByTestId("status")).toHaveText(
    "8 instances · 8 reusable parts · solid · perspective camera",
  );
});

test("switches projection and resets camera controls", async ({ page }) => {
  await page.goto("/");
  const label = page.getByTestId("projection-label");
  await expect(label).toHaveText("Perspective");
  await page.getByTestId("projection-toggle").click();
  await expect(label).toHaveText("Orthographic");
  await page.getByTestId("reset").click();
  await expect(label).toHaveText("Perspective");
});

test("toggles the edge overlay and edge depth test", async ({ page }) => {
  await page.goto("/");
  const overlayLabel = page.getByTestId("edge-overlay-label");
  await expect(overlayLabel).toHaveText("Off");
  await page.getByTestId("edge-overlay").click();
  await expect(overlayLabel).toHaveText("On");
  await page.getByTestId("edge-overlay").click();
  await expect(overlayLabel).toHaveText("Off");

  const depthLabel = page.getByTestId("depth-test-label");
  await expect(depthLabel).toHaveText("On");
  await page.getByTestId("depth-test").click();
  await expect(depthLabel).toHaveText("Off");
  await page.getByTestId("depth-test").click();
  await expect(depthLabel).toHaveText("On");
});
