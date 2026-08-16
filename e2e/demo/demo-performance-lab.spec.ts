import { expect, test } from "@playwright/test";
import { loadWebGpuPage, openNavigation } from "./demo-support";

test("enters the Performance Lab without eager geometry or rebuilding a prior case", async ({
  page,
}) => {
  await loadWebGpuPage(page);
  const modelSelect = page.getByTestId("model-select");
  const labSwitch = page.getByTestId("performance-lab");
  const canvas = page.getByTestId("view-canvas");

  await expect(modelSelect.locator("option")).toHaveCount(7);
  await expect(labSwitch).toHaveAttribute("aria-pressed", "false");
  await labSwitch.click();
  await expect(labSwitch).toHaveAttribute("aria-pressed", "true");
  await expect(modelSelect.locator("option")).toHaveCount(16);
  await expect(modelSelect).toHaveValue("");
  await expect(canvas).toHaveAttribute("data-model", "bolted");

  await modelSelect.selectOption("bodies-256");
  await expect(canvas).toHaveAttribute("data-model", "bodies-256");
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "false");
  await modelSelect.selectOption("unique-250k");
  await expect(canvas).toHaveAttribute("data-model", "unique-250k", { timeout: 15_000 });

  await labSwitch.click();
  await expect(labSwitch).toHaveAttribute("aria-pressed", "false");
  await expect(modelSelect.locator("option")).toHaveCount(7);
  await expect(modelSelect).toHaveValue("bolted");
  await expect(canvas).toHaveAttribute("data-model", "bolted");
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");

  await labSwitch.click();
  await expect(modelSelect).toHaveValue("");
  await expect(canvas).toHaveAttribute("data-model", "bolted");
});

test("keeps the Performance Lab switch reachable in the phone drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWebGpuPage(page);
  await openNavigation(page);
  const labSwitch = page.getByTestId("performance-lab");
  await expect(labSwitch).toBeVisible();
  await expect(labSwitch).toHaveAttribute("aria-pressed", "false");
  await labSwitch.click();
  await expect(labSwitch).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#navigation-drawer")).toHaveAttribute("aria-hidden", "false");
});
