import { expect, test } from "@playwright/test";
import { dataset, requireHit, setElementSelection } from "./demo-support";
import { loadWebGpuPage } from "./webgpu-support";
test("toggles the element edge overlay independently of solid geometry", async ({ page }) => {
  await loadWebGpuPage(page);
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("edge-overlay").click();
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "false");
});
test("toggles the edge overlay", async ({ page }) => {
  await loadWebGpuPage(page);
  const overlay = page.getByTestId("edge-overlay");
  await expect(overlay).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("edge-overlay").click();
  await expect(overlay).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("edge-overlay").click();
  await expect(overlay).toHaveAttribute("aria-pressed", "true");
});

test("keeps depth-tested edges behind the single edges control", async ({ page }) => {
  await loadWebGpuPage(page);

  await expect(page.getByTestId("depth-test")).toHaveCount(0);
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
});

test("defaults to owning-element selection and can restore exact picks", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const toggle = page.getByTestId("element-select");
  await expect(toggle).toHaveAttribute("aria-label", "Element select");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("interaction-help")).toContainText("Element select");

  const hit = await requireHit(
    page,
    canvas,
    { prefix: "n:" },
    "node GPU picking must resolve on the deterministic WebGPU lane",
  );
  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toMatch(/^e:/);
  await expect(page.getByTestId("inspection-panel")).toContainText("Node");

  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(modifier);
  await page.mouse.click(box.x + box.width - 12, box.y + box.height - 12);
  await page.keyboard.up(modifier);
  await expect.poll(() => dataset(page, "selected")).toMatch(/^e:/);

  await setElementSelection(page, false);
  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toMatch(/^n:/);
});

test("selects an element by promoting a node pick with shift-click", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "n:" },
    "node GPU picking must resolve on the deterministic WebGPU lane",
  );

  await page.keyboard.down("Shift");
  await page.mouse.click(hit.x, hit.y);
  await page.keyboard.up("Shift");
  await expect.poll(() => dataset(page, "selected")).toMatch(/^e:/);
});

test("selects and deselects the owning element from a node context menu", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "n:" },
    "node GPU picking must resolve on the deterministic WebGPU lane",
  );
  const menu = page.getByTestId("context-menu");

  expect(await dataset(page, "selected")).toBe("");
  await page.mouse.click(hit.x, hit.y, { button: "right" });
  await expect(menu).toBeVisible();
  expect(await dataset(page, "selected")).toBe("");
  await expect(menu.locator('button[data-action="select-element"]')).toHaveText("Select element");
  await expect(menu.locator('button[data-action="select"]')).toHaveText("Select node");
  await menu.locator('button[data-action="select-element"]').click();
  await expect.poll(() => dataset(page, "selected")).toMatch(/^e:/);

  await page.mouse.click(hit.x, hit.y, { button: "right" });
  await expect(menu.locator('button[data-action="select-element"]')).toHaveText("Deselect element");
  await menu.locator('button[data-action="select-element"]').click();
  await expect.poll(() => dataset(page, "selected")).toBe("");
});

test("promotes face and element context targets to the exact element", async ({ page }) => {
  await loadWebGpuPage(page);
  const canvas = page.getByTestId("view-canvas");
  const menu = page.getByTestId("context-menu");
  const faceHit = await requireHit(
    page,
    canvas,
    { prefix: "f:", fresh: true },
    "face GPU picking must resolve on the deterministic WebGPU lane",
  );

  await page.mouse.click(faceHit.x, faceHit.y, { button: "right" });
  await expect(menu.locator(".menu-title").first()).toHaveText(/^Face /);
  await expect(menu.locator('button[data-action="select-element"]')).toHaveText("Select element");
  await menu.locator('button[data-action="select-element"]').click();
  await expect.poll(() => dataset(page, "selected")).toMatch(/^e:/);

  await page.mouse.click(faceHit.x, faceHit.y, { button: "right" });
  await expect(menu.locator('button[data-action="select-element"]')).toHaveText("Deselect element");
  await menu.locator('button[data-action="select-element"]').click();
  await expect.poll(() => dataset(page, "selected")).toBe("");

  const nodeHit = await requireHit(
    page,
    canvas,
    { prefix: "n:", fresh: true },
    "node GPU picking must resolve on the deterministic WebGPU lane",
  );
  await page.keyboard.down("Shift");
  await page.mouse.click(nodeHit.x, nodeHit.y, { button: "right" });
  await page.keyboard.up("Shift");
  await expect(menu.locator(".menu-title").first()).toHaveText(/^Element /);
  await menu.locator('button[data-action="select-element"]').click();
  await expect.poll(() => dataset(page, "selected")).toMatch(/^e:/);
});
test("clears selection on empty scene clicks but preserves it through orbit", async ({ page }) => {
  await loadWebGpuPage(page);
  await setElementSelection(page, false);
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "n:" },
    "node GPU picking must resolve on the deterministic WebGPU lane",
  );
  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toMatch(/^n:/);

  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  const empty = { x: Math.round(box.x + box.width - 12), y: Math.round(box.y + box.height - 12) };
  await page.mouse.click(empty.x, empty.y);
  await expect.poll(() => dataset(page, "selected")).toBe("");

  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toMatch(/^n:/);
  const selected = await dataset(page, "selected");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + box.width / 2 + 48, box.y + box.height / 2 + 24);
  await page.mouse.up({ button: "middle" });
  await expect.poll(() => dataset(page, "selected")).toBe(selected);
});
test("uses Control/Meta-click for additive and toggle selection", async ({ page }) => {
  await loadWebGpuPage(page);
  await setElementSelection(page, false);
  const canvas = page.getByTestId("view-canvas");
  const nodeHit = await requireHit(
    page,
    canvas,
    { prefix: "n:" },
    "node GPU picking must resolve on the deterministic WebGPU lane",
  );
  const faceHit = await requireHit(
    page,
    canvas,
    { prefix: "f:", reverse: true, fresh: true },
    "face GPU picking must resolve on the deterministic WebGPU lane",
  );
  await page.mouse.click(nodeHit.x, nodeHit.y);
  await expect.poll(() => dataset(page, "selected")).toMatch(/^n:/);
  const nodeKey = await dataset(page, "selected");
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(modifier);
  await page.mouse.click(faceHit.x, faceHit.y);
  await page.keyboard.up(modifier);
  await expect.poll(() => dataset(page, "selected")).toContain(nodeKey);
  await expect.poll(() => dataset(page, "selected")).toContain("f:");

  await page.keyboard.down(modifier);
  await page.mouse.click(faceHit.x, faceHit.y);
  await page.keyboard.up(modifier);
  await expect.poll(() => dataset(page, "selected")).toBe(nodeKey);
});
test("picks and selects a node, exposing adjacency and neighbors", async ({ page }) => {
  await loadWebGpuPage(page);
  await setElementSelection(page, false);
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "n:" },
    "node GPU picking must resolve on the deterministic WebGPU lane",
  );

  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toMatch(/^n:/);
  await expect(page.getByTestId("inspection-panel")).toContainText("Adjacent elements");
  await expect(page.getByTestId("inspection-panel")).toContainText("Neighbors");
});
test("picks and selects a face, exposing its normal and ownership", async ({ page }) => {
  await loadWebGpuPage(page);
  await setElementSelection(page, false);
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "f:" },
    "face GPU picking must resolve on the deterministic WebGPU lane",
  );

  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toMatch(/^f:/);
  await expect(page.getByTestId("inspection-panel")).toContainText("Normal");
  await expect(page.getByTestId("inspection-panel")).toContainText("Adjacent elements");
});

test("keeps the generic mapped element face identity through selection", async ({ page }) => {
  await loadWebGpuPage(page);
  await setElementSelection(page, false);
  await page.getByTestId("model-select").selectOption("gallery");
  const canvas = page.getByTestId("view-canvas");
  const genericRow = page
    .locator(".visibility-row.visibility-part")
    .filter({ hasText: "Generic solver-mapped element" });
  const genericInput = genericRow.locator("input[data-instance-id]");
  await expect(genericInput).toHaveCount(1);
  const genericInstanceId = await genericInput.getAttribute("data-instance-id");
  if (genericInstanceId === null) throw new Error("generic mapping row has no instance identity");
  const instances = page.locator("input[data-instance-id]");
  await expect(instances).toHaveCount(10);
  for (const input of await instances.all()) {
    if ((await input.getAttribute("data-instance-id")) !== genericInstanceId) {
      await input.uncheck();
    }
  }
  await page.getByTestId("fit-view").click();

  const face = await requireHit(
    page,
    canvas,
    { prefix: "f:", fresh: true },
    "generic solver-mapped faces must remain GPU-pickable",
  );
  expect(face.key).toMatch(/^f:[^:]+:42:[0-4]$/);
  await page.mouse.click(face.x, face.y);
  await expect.poll(() => dataset(page, "selected")).toBe(face.key);
  await expect(page.getByTestId("inspection-panel")).toContainText("Generic solver-mapped element");
  await expect(page.getByTestId("inspection-panel")).toContainText("Element 42");

  await page.keyboard.down("Shift");
  await page.mouse.click(face.x, face.y);
  await page.keyboard.up("Shift");
  await expect.poll(() => dataset(page, "selected")).toMatch(/^e:[^:]+:42$/);
});
test("keeps selection stable across repeated orbit interactions", async ({ page }) => {
  await loadWebGpuPage(page);
  await setElementSelection(page, false);
  const canvas = page.getByTestId("view-canvas");
  const hit = await requireHit(
    page,
    canvas,
    { prefix: "n:" },
    "node GPU picking must resolve on the deterministic WebGPU lane",
  );
  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toMatch(/^n:/);
  const selected = await dataset(page, "selected");

  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("canvas has no bounding box");
  }
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  for (let turn = 0; turn < 3; turn++) {
    await page.mouse.move(centerX, centerY);
    await page.mouse.down({ button: "middle" });
    for (let step = 0; step < 24; step++) {
      await page.mouse.move(centerX + step * 2, centerY + step);
    }
    await page.mouse.up({ button: "middle" });
  }
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-renderer", "webgpu");
  await expect.poll(() => dataset(page, "selected"), { timeout: 5000 }).toBe(selected);
});
