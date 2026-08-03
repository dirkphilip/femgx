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

test("switches projection and resets camera controls", async ({ page }) => {
  await page.goto("/");
  const label = page.getByTestId("projection-label");
  await expect(label).toHaveText("Perspective");
  await page.getByTestId("projection-toggle").click();
  await expect(label).toHaveText("Orthographic");
  await page.getByTestId("reset").click();
  await expect(label).toHaveText("Perspective");
});
