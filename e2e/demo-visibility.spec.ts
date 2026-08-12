import { expect, test } from "@playwright/test";
import { dataset, drawnPixels, requireHit, status, waitForRenderer } from "./demo-support";
test("toggles one fastener occurrence and restores it via the visibility panel", async ({
  page,
}) => {
  await page.goto("/");
  await waitForRenderer(page);
  expect(await dataset(page, "selected")).toBe("");
  expect(await status(page)).toContain("34 visible");
  const fastenerCheckbox = page.getByTestId("assembly-node-vis-3");
  await expect(fastenerCheckbox).toBeChecked();

  await fastenerCheckbox.uncheck();
  await expect(fastenerCheckbox).not.toBeChecked();
  expect(await status(page)).toContain("30 visible");

  await fastenerCheckbox.check();
  await expect(fastenerCheckbox).toBeChecked();
  expect(await status(page)).toContain("34 visible");
});
test("uses stable runtime-node and instance controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("assembly-node-vis-0")).toBeChecked();
  await page.getByTestId("model-select").selectOption("vtk");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-model", "vtk");

  const rootCheckbox = page.getByTestId("assembly-node-vis-0");
  await expect(rootCheckbox).toHaveAttribute("data-assembly-node-id", "1");
  await expect(rootCheckbox).toBeChecked();
  const partCheckbox = page.getByTestId("instance-vis-0");
  await expect(partCheckbox).toHaveAttribute("data-instance-id", "1/0");
  await expect(partCheckbox).toBeChecked();

  // Hiding the root assembly hides every descendant instance.
  await rootCheckbox.uncheck();
  await expect(rootCheckbox).not.toBeChecked();
  await expect(page.getByTestId("status")).toContainText("0 visible");

  await rootCheckbox.check();
  await expect(page.getByTestId("status")).toContainText("1 visible");

  // Hiding the direct part occurrence leaves the assembly occurrence enabled.
  await partCheckbox.uncheck();
  await expect(partCheckbox).not.toBeChecked();
  await expect(rootCheckbox).toBeChecked();
  await expect(page.getByTestId("status")).toContainText("0 visible");

  await partCheckbox.check();
  await expect(partCheckbox).toBeChecked();
  await expect(rootCheckbox).toBeChecked();
  await expect(page.getByTestId("status")).toContainText("1 visible");
});
test("collapses and expands assembly rows in the visibility tree", async ({ page }) => {
  await page.goto("/");
  // The bolted tree starts fully expanded, so Fasteners shows each occurrence.
  const fasteners = page.getByTestId("assembly-expand-2");
  await expect(fasteners).toHaveAttribute("aria-expanded", "true");
  const firstFastener = page.getByTestId("assembly-node-vis-3");
  await expect(firstFastener).toBeVisible();

  // Collapsing Fasteners hides its subtree but keeps the parent row reachable.
  await fasteners.click();
  await expect(fasteners).toHaveAttribute("aria-expanded", "false");
  await expect(firstFastener).toBeHidden();
  await expect(page.getByTestId("assembly-node-vis-2")).toBeVisible();

  // Expanding restores the subtree.
  await fasteners.click();
  await expect(fasteners).toHaveAttribute("aria-expanded", "true");
  await expect(firstFastener).toBeVisible();
});
test("exposes assembly occurrence and direct-part identity in the tree", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("visibility-context")).toContainText("Bolted joint");
  await expect(page.getByTestId("assembly-node-vis-0")).toHaveAttribute(
    "data-assembly-node-id",
    "1",
  );
  await expect(page.getByTestId("instance-vis-0")).toHaveAttribute("data-instance-id", "1/0/0");
});
test("temporarily highlights exact tree occurrences without changing selection", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect.poll(() => canvas.getAttribute("data-renderer"), { timeout: 10_000 }).toBe("webgpu");
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "n:" },
    "node GPU picking must resolve before tree-hover assertions",
  );
  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => canvas.getAttribute("data-selected")).toMatch(/^n:/);
  const selected = await dataset(page, "selected");
  const baseline = await canvas.screenshot();
  const visibility = page.getByTestId("visibility-panel");
  await visibility.getByTestId("assembly-expand-3").click();
  const firstOccurrence = visibility
    .getByTestId("assembly-node-vis-3")
    .locator("xpath=ancestor::div[contains(@class, 'visibility-row')]");
  const secondOccurrence = visibility
    .getByTestId("assembly-node-vis-4")
    .locator("xpath=ancestor::div[contains(@class, 'visibility-row')]");
  await firstOccurrence.hover();
  await expect.poll(() => canvas.getAttribute("data-tree-hover")).not.toBe("");
  await expect
    .poll(async () => Buffer.compare(baseline, await canvas.screenshot()) !== 0)
    .toBe(true);
  const firstTreeHover = await canvas.getAttribute("data-tree-hover");
  expect(await dataset(page, "selected")).toBe(selected);

  await secondOccurrence.hover();
  await expect.poll(() => canvas.getAttribute("data-tree-hover")).not.toBe(firstTreeHover);
  expect(await dataset(page, "selected")).toBe(selected);

  await visibility.getByTestId("visibility-context").hover();
  await expect.poll(() => canvas.getAttribute("data-tree-hover")).toBe("");
  expect(await dataset(page, "selected")).toBe(selected);
});
test("hides the plate stack through the assembly tree", async ({ page }) => {
  await page.goto("/");
  await waitForRenderer(page);
  expect(await status(page)).toContain("34 visible");
  const plateStack = page.getByTestId("assembly-node-vis-1");
  await expect(plateStack).toBeChecked();

  await plateStack.uncheck();
  await expect(plateStack).not.toBeChecked();
  expect(await status(page)).toContain("32 visible");

  await plateStack.check();
  await expect(plateStack).toBeChecked();
  expect(await status(page)).toContain("34 visible");
});
test("hides and restores all fasteners through the assembly tree", async ({ page }) => {
  await page.goto("/");
  const fasteners = page.getByTestId("assembly-node-vis-2");
  await expect(fasteners).toBeChecked();

  await fasteners.uncheck();
  await expect(fasteners).not.toBeChecked();
  await expect(page.getByTestId("assembly-node-vis-3")).toBeDisabled();
  expect(await status(page)).toContain("2 visible");

  await fasteners.check();
  await expect(fasteners).toBeChecked();
  await expect(page.getByTestId("assembly-node-vis-3")).toBeEnabled();
  expect(await status(page)).toContain("34 visible");
});
test("keeps body overlays rendered while hiding a named body", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect.poll(() => canvas.getAttribute("data-renderer"), { timeout: 10_000 }).toBe("webgpu");
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");

  const body = page.locator('input[data-testid^="body-vis-"]').first();
  await expect(body).toBeChecked();
  await body.uncheck();
  await expect(body).not.toBeChecked();
  await expect.poll(async () => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);

  await body.check();
  await expect(body).toBeChecked();
  await expect.poll(async () => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);
});
test("Show all restores bodies and other visibility layers without clearing selection", async ({
  page,
}) => {
  await page.goto("/");
  await waitForRenderer(page);
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    {},
    "GPU picking must resolve on the deterministic WebGPU lane",
  );
  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).not.toBe("");
  const selected = await dataset(page, "selected");
  expect(selected).not.toBe("");

  const body = page.locator('input[data-testid^="body-vis-"]').first();
  const instance = page.locator("input[data-instance-id]").first();
  const assembly = page.getByTestId("assembly-node-vis-1");
  await body.uncheck();
  await instance.uncheck();
  await assembly.uncheck();
  await expect(body).not.toBeChecked();
  await expect(instance).not.toBeChecked();
  await expect(assembly).not.toBeChecked();

  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  await page.mouse.click(box.x + box.width - 12, box.y + box.height - 12, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await menu.getByText("Show all").click();

  await expect(body).toBeChecked();
  await expect(body).toBeEnabled();
  await expect(instance).toBeChecked();
  await expect(assembly).toBeChecked();
  expect(await status(page)).toContain("34 visible");
  expect(await dataset(page, "selected")).toBe(selected);
  await expect.poll(async () => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);
});
test("context menu selects a target and toggles display without losing selection", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    {},
    "GPU picking must resolve on the deterministic WebGPU lane",
  );

  await page.mouse.click(hit.x, hit.y, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();

  // The menu reports the target it actually captured (sub-pixel rounding may
  // resolve a face where hover saw a node); derive the selection prefix from it.
  const title =
    (await page.getByTestId("context-menu").locator(".menu-title").first().textContent()) ?? "";
  const prefix = title.split(" ")[0];
  expect(["Node", "Face", "Element", "Instance", "Part"]).toContain(prefix);
  const keyPrefix =
    prefix === "Node"
      ? "n:"
      : prefix === "Face"
        ? "f:"
        : prefix === "Element"
          ? "e:"
          : prefix === "Instance"
            ? "i:"
            : "p:";

  await page.getByTestId("context-menu").getByText("Select / Deselect").click();
  await expect.poll(() => dataset(page, "selected")).toMatch(new RegExp(`^${keyPrefix}`));
  const selected = await dataset(page, "selected");

  // Context-menu display toggles must not rebuild or drop the selection.
  await page.mouse.click(hit.x, hit.y, { button: "right" });
  await page.getByTestId("context-menu").getByText("Hide edges").click();
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "false");
  expect(await dataset(page, "selected")).toBe(selected);

  await page.mouse.click(hit.x, hit.y, { button: "right" });
  await page.getByTestId("context-menu").getByText("Overlay edges").click();
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  expect(await dataset(page, "selected")).toBe(selected);
});
test("opens a view context menu on empty scene space", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  const empty = { x: Math.round(box.x + box.width - 12), y: Math.round(box.y + box.height - 12) };

  const hit = await requireHit(
    page,
    canvas,
    {},
    "GPU picking must resolve on the deterministic WebGPU lane",
  );
  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).not.toBe("");

  const partCheckbox = page
    .getByTestId("visibility-panel")
    .locator("input[data-instance-id]")
    .first();
  await partCheckbox.uncheck();
  await expect(partCheckbox).not.toBeChecked();

  await page.mouse.click(empty.x, empty.y, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator(".menu-title").first()).toHaveText("View");
  for (const action of ["fit-view", "clear-selection", "show-all", "reset"]) {
    await expect(menu.locator(`button[data-action="${action}"]`)).toBeVisible();
  }
  await expect(menu.getByText("Fit model")).toHaveAttribute("title", /Frame the complete model/);
  await expect(menu.getByText("Reset all")).toHaveAttribute("title", /Restore this model/);
  await expect(menu.locator('button[data-action="select"]')).toHaveCount(0);

  await menu.getByText("Clear selection").click();
  await expect.poll(() => dataset(page, "selected")).toBe("");
  await expect(menu).toBeHidden();

  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await menu.getByText("Show all").click();
  await expect(partCheckbox).toBeChecked();

  await page.getByTestId("projection-toggle").click();
  await expect(page.getByTestId("projection-toggle")).toHaveText("Perspective");
  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await menu.getByText("Reset all").click();
  await expect(page.getByTestId("projection-toggle")).toHaveText("Orthographic");

  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await page.mouse.click(20, 20);
  await expect(menu).toBeHidden();
});
test("does not advertise the CPU-only display overlays in the context menu", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect.poll(() => canvas.getAttribute("data-renderer"), { timeout: 10_000 }).toBe("webgpu");
  const hit = await requireHit(
    page,
    canvas,
    {},
    "GPU picking must resolve on the deterministic WebGPU lane",
  );

  await page.mouse.click(hit.x, hit.y, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  // The node-marker/normal/face-boundary/ID overlays were CPU-renderer-only and
  // were removed with it; the menu must not advertise them.
  for (const action of ["node-markers", "normals", "face-boundaries", "ids"]) {
    await expect(menu.locator(`button[data-action="${action}"]`)).toHaveCount(0);
  }
  // The edges and diagnostics display toggles remain.
  await expect(menu.locator('button[data-action="edges"]')).toBeEnabled();
  await expect(menu.locator('button[data-action="diagnostics"]')).toBeEnabled();
});
test("context menu synchronizes instance visibility with the tree", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    {},
    "GPU picking must resolve on the deterministic WebGPU lane",
  );

  await page.mouse.click(hit.x, hit.y, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  const inspection = (await page.getByTestId("inspection-panel").textContent()) ?? "";
  const match = /Instance ([^\n]+)/.exec(inspection);
  expect(match, "the inspection panel must report the picked instance").not.toBeNull();
  if (match === null) {
    throw new Error("the inspection panel must report the picked instance");
  }
  const instanceId = match[1];

  const checkbox = page.locator(`input[data-instance-id="${instanceId}"]`);
  await expect(checkbox).toBeChecked();
  await page.getByTestId("context-menu").getByText("Hide / Show instance").click();
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByTestId("status")).toContainText("visible");

  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await expect.poll(async () => (await status(page)).includes("visible")).toBe(true);
});
