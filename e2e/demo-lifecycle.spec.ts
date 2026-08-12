import { expect, test } from "@playwright/test";
import {
  dataset,
  distinctColors,
  drawnPixels,
  primaryBoxDrag,
  requireHit,
  waitForRenderer,
} from "./demo-support";
test("renders the demo canvas with instanced geometry", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();
  await expect
    .poll(() => canvas.getAttribute("data-renderer"), { timeout: 10_000 })
    .toMatch(/^(webgpu|unsupported)$/);
  if ((await canvas.getAttribute("data-renderer")) !== "webgpu") {
    test.skip(true, "WebGPU renderer unavailable in this browser environment");
  }

  await expect.poll(async () => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);
});
test("draws a normalized box rectangle during a primary drag and clears it on release", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect.poll(() => canvas.getAttribute("data-renderer"), { timeout: 10_000 }).toBe("webgpu");
  const overlay = page.getByTestId("box-selection-overlay");
  await expect(overlay).toBeHidden();
  expect(await dataset(page, "selected")).toBe("");

  await primaryBoxDrag(page, canvas, { fx: 0.2, fy: 0.35 }, { fx: 0.65, fy: 0.6 });
  await page.waitForTimeout(50);
  const overlayBox = await overlay.boundingBox();
  expect(overlayBox, "the box rectangle must be visible while the button is held").not.toBeNull();
  expect(overlayBox?.width ?? 0).toBeGreaterThan(0);
  expect(overlayBox?.height ?? 0).toBeGreaterThan(0);

  await page.mouse.up({ button: "left" });
  await expect(overlay).toBeHidden();
  expect(await dataset(page, "selected")).toBe("");
});
test("selects visible elements with a primary drag and toggles them with Control", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect.poll(() => canvas.getAttribute("data-renderer"), { timeout: 10_000 }).toBe("webgpu");
  await expect(page.getByTestId("interaction-help")).toContainText("visible elements");

  await primaryBoxDrag(page, canvas, { fx: 0.08, fy: 0.32 }, { fx: 0.92, fy: 0.92 });
  await page.mouse.up({ button: "left" });
  await expect.poll(() => dataset(page, "selected"), { timeout: 10_000 }).toMatch(/^e:/);
  const selected = await dataset(page, "selected");
  expect(selected.split(",").every((key) => key.startsWith("e:"))).toBe(true);

  await page.keyboard.down("Control");
  await primaryBoxDrag(page, canvas, { fx: 0.08, fy: 0.32 }, { fx: 0.92, fy: 0.92 });
  await page.mouse.up({ button: "left" });
  await page.keyboard.up("Control");
  await expect.poll(() => dataset(page, "selected"), { timeout: 10_000 }).toBe("");
});
test("cancels a box selection with Escape and never changes selection", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect.poll(() => canvas.getAttribute("data-renderer"), { timeout: 10_000 }).toBe("webgpu");
  const overlay = page.getByTestId("box-selection-overlay");

  await primaryBoxDrag(page, canvas, { fx: 0.25, fy: 0.4 }, { fx: 0.7, fy: 0.65 });
  await page.waitForTimeout(50);
  await expect(overlay).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  expect(await dataset(page, "selected")).toBe("");

  await page.mouse.up({ button: "left" });
  expect(await dataset(page, "selected")).toBe("");
  await expect(overlay).toBeHidden();
});
test("reports the active model, renderer, instances, parts, and batches", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("status")).toHaveText(
    /Bolted plate assembly · webgpu · \d+ visible · 4 parts · \d+ batches · orthographic camera/,
  );
  await expect(page.getByTestId("renderer-status")).toHaveText(/Renderer webgpu/);
  await expect(page.getByTestId("stats-panel")).toBeHidden();
});
test("defaults to the bolted plate assembly showcase", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("model-select")).toHaveValue("bolted");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-model", "bolted");
  await expect(page.getByTestId("status")).toContainText("Bolted plate assembly");
  await expect(page.getByTestId("status")).toContainText("34 visible");
});
test("shows diagnostics from target and empty-scene context menus", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const diagnostics = page.getByTestId("stats-panel");
  await expect(diagnostics).toBeHidden();

  const hit = await requireHit(
    page,
    canvas,
    {},
    "GPU picking must resolve before opening the target diagnostics menu",
  );
  await page.mouse.click(hit.x, hit.y, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByText("Show diagnostics")).toBeVisible();
  await menu.getByText("Show diagnostics").click();

  await expect(diagnostics).toBeVisible();
  await expect(diagnostics.locator("h2")).toHaveText("Diagnostics");
  await expect(diagnostics).toContainText("Visible instances");
  const panelBox = await diagnostics.boundingBox();
  const sceneBox = await page.locator(".scene").boundingBox();
  const toolbarBox = await page.locator(".toolbar").boundingBox();
  expect(panelBox).not.toBeNull();
  expect(sceneBox).not.toBeNull();
  expect(toolbarBox).not.toBeNull();
  if (panelBox === null || sceneBox === null || toolbarBox === null) {
    throw new Error("diagnostics layout has no measurable bounds");
  }
  expect(panelBox.x).toBeGreaterThanOrEqual(sceneBox.x);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(sceneBox.x + sceneBox.width);
  expect(panelBox.y).toBeGreaterThanOrEqual(toolbarBox.y + toolbarBox.height);

  const beforeVisibility = await diagnostics.textContent();
  const partCheckbox = page
    .getByTestId("visibility-panel")
    .locator("input[data-instance-id]")
    .first();
  await partCheckbox.uncheck();
  await expect.poll(() => diagnostics.textContent()).not.toBe(beforeVisibility);

  const canvasBox = await canvas.boundingBox();
  if (canvasBox === null) throw new Error("canvas has no bounding box");
  await page.mouse.click(
    Math.round(canvasBox.x + canvasBox.width - 12),
    Math.round(canvasBox.y + canvasBox.height - 12),
    { button: "right" },
  );
  await expect(menu).toBeVisible();
  await expect(menu.getByText("Hide diagnostics")).toBeVisible();
  await menu.getByText("Hide diagnostics").click();
  await expect(diagnostics).toBeHidden();

  await page.getByTestId("reset").click();
  await page.mouse.click(
    Math.round(canvasBox.x + canvasBox.width - 12),
    Math.round(canvasBox.y + canvasBox.height - 12),
    { button: "right" },
  );
  await expect(menu.getByText("Show diagnostics")).toBeVisible();
});
test("shows an accessible interactive view cube", async ({ page }) => {
  await page.goto("/");
  const gizmo = page.locator('[data-femgx-orientation-gizmo="true"]');
  await expect(gizmo).toBeVisible();
  await expect(gizmo).toHaveAttribute("role", "group");
  await expect(gizmo.locator("[data-view-face]")).toHaveCount(6);
  await expect(gizmo.locator("[data-view-corner]")).toHaveCount(8);
  await expect(gizmo.locator("[data-rotate]")).toHaveCount(6);
  await expect(gizmo.locator("circle")).toHaveCount(8);
  await expect(gizmo.locator("text")).toHaveCount(6);
  await expect(gizmo).toContainText("+X");
  await expect(gizmo).toContainText("−X");
  await expect(gizmo).toContainText("+Y");
  await expect(gizmo).toContainText("−Y");
  await expect(gizmo).toContainText("+Z");
  await expect(gizmo).toContainText("−Z");
});
test("updates existing view-cube nodes after camera movement", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const front = page.locator('[data-femgx-orientation-gizmo="true"] [data-view-face="front"]');
  await expect(canvas).toHaveAttribute("data-renderer", "webgpu", { timeout: 10_000 });
  const before = await front.locator("polygon").getAttribute("points");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.42);
  await page.mouse.up({ button: "middle" });
  await expect.poll(() => front.locator("polygon").getAttribute("points")).not.toBe(before);
});
test("zooms toward the point under the mouse and fits selection with Z", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  const x = Math.round(box.x + box.width * 0.65);
  const y = Math.round(box.y + box.height * 0.5);
  const beforeZoom = await canvas.getAttribute("data-camera");
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -160);
  await expect.poll(() => canvas.getAttribute("data-camera")).not.toBe(beforeZoom);

  const hit = await requireHit(
    page,
    canvas,
    {},
    "GPU picking must resolve before fitting the selected target",
  );
  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => canvas.getAttribute("data-selected")).not.toBe("");
  const beforeFit = await canvas.getAttribute("data-camera");
  await page.keyboard.press("z");
  await expect.poll(() => canvas.getAttribute("data-camera")).not.toBe(beforeFit);
});
test("lists the bolted assembly hierarchy in the visibility panel", async ({ page }) => {
  await page.goto("/");
  const visibility = page.getByTestId("visibility-panel");
  for (const name of [
    "Bolted joint",
    "Plate stack",
    "Fasteners",
    "Fastener 1",
    "Fastener 8",
    "Steel plates",
    "Bolts",
    "Washers",
    "Nuts",
    "Plate row A",
    "Plate row B",
    "Shaft",
    "Head",
  ]) {
    await expect(visibility).toContainText(name);
  }
  await expect(page.getByTestId("assembly-node-vis-3")).toHaveAttribute(
    "data-assembly-node-id",
    "1/1/0",
  );
});
test("renders the bolted showcase with distinct part colors and a screenshot", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toBeVisible();
  // The renderer is only known once WebGPU initializes; poll like the visual spec.
  await expect.poll(() => canvas.getAttribute("data-renderer")).toMatch(/^(webgpu|unsupported)$/);
  if ((await canvas.getAttribute("data-renderer")) !== "webgpu") {
    test.skip(true, "WebGPU renderer unavailable in this browser environment");
  }

  await expect
    .poll(async () => distinctColors(canvas), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(4);

  const screenshot = await canvas.screenshot();
  expect(screenshot, "the bolted showcase must produce a non-empty screenshot").not.toHaveLength(0);
});
test("renders all ten supported element examples in the gallery grid", async ({ page }) => {
  await page.goto("/");
  await waitForRenderer(page);
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("model-select").selectOption("gallery");
  await expect(canvas).toHaveAttribute("data-model", "gallery");
  await expect(page.getByTestId("status")).toContainText("10 visible");
  await expect.poll(() => distinctColors(canvas), { timeout: 10_000 }).toBeGreaterThanOrEqual(6);

  const screenshot = await canvas.screenshot();
  expect(screenshot, "the element gallery must produce a non-empty screenshot").not.toHaveLength(0);
});
test("switches between deterministic model presets", async ({ page }) => {
  await page.goto("/");
  const select = page.getByTestId("model-select");
  const canvas = page.getByTestId("view-canvas");
  await expect(select.locator("option")).toHaveCount(7);
  await expect(select).toHaveValue("bolted");
  await expect(canvas).toHaveAttribute("data-model", "bolted");
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");

  for (const id of [
    "vtk",
    "gallery",
    "hex20-cylinder",
    "results",
    "transparency",
    "performance",
    "bolted",
  ]) {
    await page.getByTestId("edge-overlay").click();
    await page.getByTestId("node-overlay").click();
    await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "false");
    await select.selectOption(id);
    await expect(canvas).toHaveAttribute("data-model", id);
    await expect(canvas).toHaveAttribute("data-edges", "true");
    await expect(canvas).toHaveAttribute("data-nodes", "true");
    await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toHaveAttribute(
      "data-results",
      id === "results" || id === "hex20-cylinder" ? "deformed" : "base",
    );
  }
});
test("opens the performance model through the normal demo path", async ({ page }) => {
  await page.goto("/");
  const select = page.getByTestId("model-select");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toHaveAttribute("data-renderer", "webgpu", { timeout: 10_000 });

  await select.selectOption("performance");
  await expect(canvas).toHaveAttribute("data-model", "performance");
  await expect(page.getByTestId("status")).toContainText("64 visible");
  await expect.poll(() => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);

  const box = await canvas.boundingBox();
  if (box === null) throw new Error("performance canvas has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  const menu = page.getByTestId("context-menu");
  await expect(menu).toBeVisible();
  await menu.getByText("Show diagnostics").click();
  const diagnostics = page.getByTestId("stats-panel");
  await expect(diagnostics).toContainText("Unique triangles 32,768");
  await expect(diagnostics).toContainText("Submitted triangles 2,097,152");

  await select.selectOption("bolted");
  await expect(canvas).toHaveAttribute("data-model", "bolted");
});
test("runs one opt-in continuous render chain and returns to idle", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const continuous = page.getByTestId("continuous-rendering");
  await expect(canvas).toHaveAttribute("data-renderer", "webgpu", { timeout: 10_000 });
  await expect.poll(() => canvas.getAttribute("data-frames")).not.toBeNull();
  const before = Number(await canvas.getAttribute("data-frames"));

  await continuous.click();
  await expect(continuous).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-frames")))
    .toBeGreaterThan(before + 3);

  await continuous.click();
  await expect(continuous).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(100);
  const after = Number(await canvas.getAttribute("data-frames"));
  await page.waitForTimeout(100);
  expect(Number(await canvas.getAttribute("data-frames"))).toBe(after);

  const box = await canvas.boundingBox();
  if (box === null) throw new Error("continuous rendering canvas has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  await page.getByTestId("context-menu").getByText("Show diagnostics").click();
  await expect(page.getByTestId("stats-panel")).toContainText("Render loop Idle");
});
test("keeps the deformed Hex20 cylinder connected and pickable", async ({ page }) => {
  await page.goto("/");
  const select = page.getByTestId("model-select");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toHaveAttribute("data-renderer", "webgpu", { timeout: 10_000 });
  await select.selectOption("hex20-cylinder");
  await expect(canvas).toHaveAttribute("data-results", "deformed");
  await expect.poll(() => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);

  const nodeHit = await requireHit(
    page,
    canvas,
    { prefix: "n:", fresh: true },
    "the deformed Hex20 cylinder must resolve authored node picks",
  );
  expect(nodeHit.key).toMatch(/^n:.+:\d+$/);
  await page.mouse.click(nodeHit.x, nodeHit.y);
  await expect(page.getByTestId("inspection-panel")).toContainText("Node");
  await expect(page.getByTestId("inspection-panel")).toContainText("Position");

  const faceHit = await requireHit(
    page,
    canvas,
    { prefix: "f:", fresh: true },
    "the deformed Hex20 cylinder must resolve face picks",
  );
  await page.mouse.click(faceHit.x, faceHit.y);
  await expect(page.getByTestId("inspection-panel")).toContainText("Face");
  await expect(page.getByTestId("inspection-panel")).toContainText("Hit");

  const canvasBox = await canvas.boundingBox();
  if (canvasBox === null) throw new Error("canvas has no bounding box");
  const point = await page.evaluate(
    async ({ x, y }) => {
      const demo = (
        window as typeof window & {
          femgxDemo?: {
            pickPoint?: (x: number, y: number) => Promise<readonly number[] | undefined>;
          };
        }
      ).femgxDemo;
      return (await demo?.pickPoint?.(x, y)) ?? undefined;
    },
    { x: faceHit.x - canvasBox.x, y: faceHit.y - canvasBox.y },
  );
  expect(point).toHaveLength(3);
  expect(point?.every(Number.isFinite)).toBe(true);
  expect(await canvas.screenshot()).not.toHaveLength(0);
});
