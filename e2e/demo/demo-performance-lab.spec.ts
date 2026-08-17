import { expect, test } from "@playwright/test";
import { loadWebGpuPage, openNavigation } from "./demo-support";

test("enters the Performance Lab without eager geometry or rebuilding a prior case", async ({
  page,
}) => {
  await loadWebGpuPage(page);
  const modelSelect = page.getByTestId("model-select");
  const labSwitch = page.getByTestId("performance-lab");
  const canvas = page.getByTestId("view-canvas");

  await expect(modelSelect.locator("option")).toHaveCount(6);
  await expect(labSwitch).toHaveAttribute("aria-pressed", "false");
  await labSwitch.click();
  await expect(labSwitch).toHaveAttribute("aria-pressed", "true");
  await expect(modelSelect.locator("option")).toHaveCount(18);
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
  await expect(modelSelect.locator("option")).toHaveCount(6);
  await expect(modelSelect).toHaveValue("bolted");
  await expect(canvas).toHaveAttribute("data-model", "bolted");
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");

  await labSwitch.click();
  await expect(modelSelect).toHaveValue("unique-250k");
  await expect(canvas).toHaveAttribute("data-model", "unique-250k");
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

test("cancels a stale heavy FE build and completes the selected case", async ({ page }) => {
  test.setTimeout(40_000);
  await loadWebGpuPage(page);
  const modelSelect = page.getByTestId("model-select");
  const labSwitch = page.getByTestId("performance-lab");
  const canvas = page.getByTestId("view-canvas");

  await labSwitch.click();
  await modelSelect.selectOption("fe-tet4-solid-132k");
  await labSwitch.click();
  await expect(canvas).toHaveAttribute("data-model", "bolted");
  await page.waitForTimeout(2_000);
  await expect(canvas).toHaveAttribute("data-model", "bolted");

  await labSwitch.click();
  await modelSelect.selectOption("fe-tet4-solid-132k");
  await expect(canvas).toHaveAttribute("data-model", "fe-tet4-solid-132k", {
    timeout: 30_000,
  });
});

test("builds a configurable Tet4 solid through the dense worker", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("performance-lab").click();
  await page.getByTestId("tet4-cells").fill("16");
  await page.getByTestId("mesh-tet4").click();
  await expect(canvas).toHaveAttribute("data-model", "fe-tet4-dense-16", {
    timeout: 15_000,
  });
  await expect(page.getByText("24576 elements")).toBeVisible();
});
