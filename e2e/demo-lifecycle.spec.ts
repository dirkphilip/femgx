import { expect, test, type Page } from "@playwright/test";
import {
  dataset,
  distinctColors,
  drawnPixels,
  expectBoundsClippedSafely,
  primaryBoxDrag,
  readNavigationState,
  requireHit,
  setSelectionGranularity,
  waitForRenderer,
} from "./demo-support";

interface BoxSelectionStats {
  readonly active: boolean;
  readonly queued: boolean;
  readonly started: number;
  readonly maxActive: number;
}

async function boxSelectionStats(page: Page): Promise<BoxSelectionStats | null> {
  return page.evaluate(() => {
    const harness = (
      window as typeof window & {
        femgxDemo?: { getBoxSelectionStats: () => BoxSelectionStats };
      }
    ).femgxDemo;
    return harness?.getBoxSelectionStats() ?? null;
  });
}

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
  await expect(page.getByTestId("interaction-help")).toContainText("Element:");

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
test("preserves useful framing across projection and phone resize", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toHaveAttribute("data-renderer", "webgpu", { timeout: 10_000 });
  await page.getByTestId("model-select").selectOption("transparency");
  await expect(canvas).toHaveAttribute("data-model", "transparency");

  await expect
    .poll(async () => (await readNavigationState(canvas)).camera.mode)
    .toBe("orthographic");
  await page.getByTestId("projection-toggle").click();
  await expect(page.getByTestId("projection-toggle")).toHaveText("Perspective");
  await expect
    .poll(async () => (await readNavigationState(canvas)).camera.mode)
    .toBe("perspective");
  let navigation = await readNavigationState(canvas);
  expect(navigation.camera.mode).toBe("perspective");
  expectBoundsClippedSafely(navigation.camera, navigation.bounds);
  expect(await drawnPixels(canvas)).toBe(true);

  await page.getByTestId("projection-toggle").click();
  await expect(page.getByTestId("projection-toggle")).toHaveText("Orthographic");
  await expect
    .poll(async () => (await readNavigationState(canvas)).camera.mode)
    .toBe("orthographic");
  navigation = await readNavigationState(canvas);
  expectBoundsClippedSafely(navigation.camera, navigation.bounds);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => (await readNavigationState(canvas)).camera.width)
    .toBeGreaterThan(300);
  navigation = await readNavigationState(canvas);
  expect(navigation.camera.height).toBeGreaterThan(400);
  expectBoundsClippedSafely(navigation.camera, navigation.bounds);
  expect(await drawnPixels(canvas)).toBe(true);
});
test("opens two shared-state viewports with independent cameras and exact teardown", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const primary = page.getByTestId("view-canvas");
  const secondary = page.getByTestId("secondary-view-canvas");
  await expect(primary).toHaveAttribute("data-renderer", "webgpu", { timeout: 10_000 });

  await page.getByTestId("viewport-toggle").click();
  await expect(secondary).toBeVisible();
  await expect(secondary).toHaveAttribute("data-renderer", "webgpu", { timeout: 10_000 });
  await expect(page.getByRole("region", { name: "Primary viewport" })).toHaveAttribute(
    "data-active",
    "false",
  );
  await expect(page.getByRole("region", { name: "Secondary viewport" })).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(primary).toHaveAttribute("data-selection-granularity", "element");
  await expect(secondary).toHaveAttribute("data-selection-granularity", "element");
  await setSelectionGranularity(page, "node");
  await expect(primary).toHaveAttribute("data-selection-granularity", "node");
  await expect(secondary).toHaveAttribute("data-selection-granularity", "node");
  expect(await drawnPixels(primary)).toBe(true);
  expect(await drawnPixels(secondary)).toBe(true);

  const firstInstance = page.locator("input[data-instance-id]").first();
  await expect(firstInstance).toBeChecked();
  await firstInstance.uncheck();
  await expect(page.getByTestId("status")).toContainText("33 visible");
  await page.getByRole("region", { name: "Primary viewport" }).focus();
  await expect(page.getByRole("region", { name: "Primary viewport" })).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByTestId("status")).toContainText("33 visible");

  const primaryBefore = await primary.getAttribute("data-camera");
  const secondaryBefore = await secondary.getAttribute("data-camera");
  const secondaryBox = await secondary.boundingBox();
  if (secondaryBox === null) throw new Error("secondary canvas has no bounds");
  await page.mouse.move(
    secondaryBox.x + secondaryBox.width * 0.5,
    secondaryBox.y + secondaryBox.height * 0.5,
  );
  await expect(page.getByRole("region", { name: "Secondary viewport" })).toHaveAttribute(
    "data-active",
    "true",
  );
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(
    secondaryBox.x + secondaryBox.width * 0.65,
    secondaryBox.y + secondaryBox.height * 0.4,
  );
  await page.mouse.up({ button: "middle" });
  await expect.poll(() => secondary.getAttribute("data-camera")).not.toBe(secondaryBefore);
  expect(await primary.getAttribute("data-camera")).toBe(primaryBefore);

  await page.getByTestId("model-select").selectOption("results");
  await expect(primary).toHaveAttribute("data-model", "results");
  await expect(secondary).toHaveAttribute("data-model", "results");
  await expect(primary).toHaveAttribute("data-results", "deformed");
  await expect(secondary).toHaveAttribute("data-results", "deformed");
  const selectedHit = await requireHit(
    page,
    primary,
    {},
    "shared two-pane results scene must remain pickable",
  );
  await page.mouse.click(selectedHit.x, selectedHit.y);
  await expect.poll(() => primary.getAttribute("data-selected")).not.toBe("");
  const selected = await primary.getAttribute("data-selected");
  if (selected === null) throw new Error("primary selection was not published");
  await expect(secondary).toHaveAttribute("data-selected", selected);
  await page.getByTestId("results-toggle").click();
  await expect(primary).toHaveAttribute("data-results", "base");
  await expect(secondary).toHaveAttribute("data-results", "base");

  await page.getByTestId("viewport-toggle").click();
  await expect(secondary).toBeHidden();
  await expect(page.getByTestId("viewport-toggle")).toHaveText("Add viewport");
  await page.getByTestId("viewport-toggle").click();
  await expect(secondary).toBeVisible();
  await expect(page.locator('[data-femgx-orientation-gizmo="true"]')).toHaveCount(2);
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
  await expect(gizmo.locator("circle")).toHaveCount(9);
  await expect(gizmo.locator("text")).toHaveCount(9);
  await expect(gizmo).toContainText("XY");
  await expect(gizmo).toContainText("YZ");
  await expect(gizmo).toContainText("XZ");
  await expect(gizmo.locator("[data-view-axis-triad]")).toHaveAttribute("aria-hidden", "true");
  await expect(gizmo.locator('[data-view-face="right"]')).toHaveAttribute(
    "aria-label",
    "View Right · YZ plane (+X)",
  );
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
  await expect(canvas).toHaveAttribute("data-dragging", "true");
  await page.waitForTimeout(100);
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
test("renders the helper and mapping examples in the gallery grid", async ({ page }) => {
  await page.goto("/");
  await waitForRenderer(page);
  const canvas = page.getByTestId("view-canvas");
  await page.getByTestId("model-select").selectOption("gallery");
  await expect(canvas).toHaveAttribute("data-model", "gallery");
  await expect(page.getByTestId("status")).toContainText("14 visible");
  await expect.poll(() => distinctColors(canvas), { timeout: 10_000 }).toBeGreaterThanOrEqual(6);

  const screenshot = await canvas.screenshot();
  expect(screenshot, "the element gallery must produce a non-empty screenshot").not.toHaveLength(0);
});
test("switches between deterministic model presets", async ({ page }) => {
  await page.goto("/");
  const select = page.getByTestId("model-select");
  const canvas = page.getByTestId("view-canvas");
  await expect(select.locator("option")).toHaveCount(12);
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
      id === "results" || id === "hex20-cylinder" || id === "vtk" ? "deformed" : "base",
    );
  }
});
test("builds a benchmark matrix model only after explicit selection", async ({ page }) => {
  await page.goto("/");
  const select = page.getByTestId("model-select");
  const canvas = page.getByTestId("view-canvas");
  await expect(select.locator('option[value="unique-1m"]')).toHaveCount(0);
  await expect(select.locator('option[value="fe-hex20-solid-visual"]')).toContainText(
    "FE Hex20 solid",
  );
  await expect(canvas).toHaveAttribute("data-model", "bolted");
  await select.selectOption("bodies-256");
  await expect(canvas).toHaveAttribute("data-model", "bodies-256");
  await expect(page.getByTestId("model-feedback")).toBeHidden();
  await expect(page.getByTestId("status")).toContainText("1 visible");
  await expect.poll(() => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);

  const box = await canvas.boundingBox();
  if (box === null) throw new Error("benchmark canvas has no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  await page.getByTestId("context-menu").getByText("Show diagnostics").click();
  const diagnostics = page.getByTestId("stats-panel");
  await expect(diagnostics).toContainText("Element family quad");
  await expect(diagnostics).toContainText("Unique elements 1,024");
  await expect(diagnostics).toContainText("Submitted element occurrences 1,024");
});
test("keeps a stale opt-in capacity load from replacing a newer model", async ({ page }) => {
  await page.goto("/?performanceLab=1");
  const select = page.getByTestId("model-select");
  const canvas = page.getByTestId("view-canvas");
  await expect(select.locator('option[value="unique-250k"]')).toContainText(
    "250,632 unique Triangle elements",
  );

  const loadingState = await page.evaluate(() => {
    const select = document.querySelector<HTMLSelectElement>("#model-select");
    if (select === null) throw new Error("model selector missing");
    select.value = "unique-250k";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const message = document.querySelector<HTMLElement>("#model-feedback")?.textContent ?? "";
    const busy = document.querySelector<HTMLElement>("#model-source")?.ariaBusy ?? "";
    const disabled = select.disabled;
    select.value = "bolted";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return { busy, disabled, message };
  });
  expect(loadingState.message).toMatch(/Building .*250,632 unique/);
  expect(loadingState.busy).toBe("true");
  expect(loadingState.disabled).toBe(false);
  await expect(canvas).toHaveAttribute("data-model", "bolted");
  await expect(page.getByTestId("model-feedback")).toBeHidden();
  await page.waitForTimeout(100);
  await expect(canvas).toHaveAttribute("data-model", "bolted");
  await expect(page.locator("#model-source")).toHaveAttribute("aria-busy", "false");
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
test("bounds rapid performance box drags to one active readback", async ({ page }) => {
  test.setTimeout(30_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const select = page.getByTestId("model-select");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toHaveAttribute("data-renderer", "webgpu", { timeout: 10_000 });

  await select.selectOption("performance");
  await expect(canvas).toHaveAttribute("data-model", "performance");
  await expect.poll(() => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("performance canvas has no bounding box");
  await page.evaluate(({ x, y, width, height }) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="view-canvas"]');
    if (canvas === null) throw new Error("performance canvas missing");
    const point = (fx: number, fy: number): { readonly x: number; readonly y: number } => ({
      x: x + width * fx,
      y: y + height * fy,
    });
    const dispatch = (type: string, coordinates: { readonly x: number; readonly y: number }) => {
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: coordinates.x,
          clientY: coordinates.y,
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
        }),
      );
    };
    for (let index = 0; index < 20; index += 1) {
      const offset = (index % 5) * 0.04;
      dispatch("pointerdown", point(0.3 + offset, 0.45));
      dispatch("pointermove", point(0.7 - offset, 0.65));
      dispatch("pointerup", point(0.7 - offset, 0.65));
    }
  }, box);

  const stats = await boxSelectionStats(page);
  expect(stats).toMatchObject({ maxActive: 1 });
  expect(stats?.started).toBeGreaterThan(0);
  expect(stats?.started).toBeLessThanOrEqual(2);
  await expect(canvas).toHaveAttribute("data-renderer", "webgpu");
});
test("survives repeated completed box selections on body-heavy and Quad shell models", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const select = page.getByTestId("model-select");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toHaveAttribute("data-renderer", "webgpu", { timeout: 10_000 });

  for (const model of ["bodies-256", "fe-quad-shell-visual", "fe-quad8-shell-visual"]) {
    await select.selectOption(model);
    await expect(canvas).toHaveAttribute("data-model", model);
    await expect.poll(() => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);
    for (let index = 0; index < 10; index += 1) {
      const inset = model === "bodies-256" ? 0.02 + (index % 5) * 0.01 : 0.12 + (index % 5) * 0.02;
      await primaryBoxDrag(
        page,
        canvas,
        { fx: inset, fy: model === "bodies-256" ? inset : 0.18 },
        { fx: 1 - inset, fy: model === "bodies-256" ? 1 - inset : 0.82 },
      );
      await page.mouse.up({ button: "left" });
      await expect
        .poll(
          async () => {
            const stats = await boxSelectionStats(page);
            return { active: stats?.active, queued: stats?.queued };
          },
          { timeout: 10_000 },
        )
        .toEqual({ active: false, queued: false });
      if (model === "bodies-256" && index === 0) {
        await expect(page.getByTestId("model-feedback")).toHaveText(
          "Box selection: 1024 FE elements",
        );
      }
    }
    await expect.poll(() => dataset(page, "selected")).toMatch(/^e:/);
    await expect(canvas).toHaveAttribute("data-renderer", "webgpu");
  }
});
test.describe("Retina box selection", () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 1440, height: 900 } });

  for (const model of ["fe-quad-shell-visual", "fe-quad8-shell-visual"] as const) {
    test(`keeps ${model} stable through repeated boxes and hover`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto("/");
      const select = page.getByTestId("model-select");
      const canvas = page.getByTestId("view-canvas");
      await expect(canvas).toHaveAttribute("data-renderer", "webgpu", { timeout: 10_000 });
      await select.selectOption(model);
      await expect(canvas).toHaveAttribute("data-model", model);
      await expect
        .poll(() => canvas.getAttribute("data-frames"), { timeout: 10_000 })
        .not.toBeNull();
      const box = await canvas.boundingBox();
      if (box === null) throw new Error(`${model} canvas has no bounding box`);
      for (let index = 0; index < 20; index += 1) {
        const inset = (index % 5) * 0.02;
        await primaryBoxDrag(
          page,
          canvas,
          { fx: 0.12 + inset, fy: 0.18 },
          { fx: 0.88 - inset, fy: 0.82 },
        );
        await page.mouse.up({ button: "left" });
        await expect
          .poll(
            async () => {
              const stats = await boxSelectionStats(page);
              return { active: stats?.active, queued: stats?.queued };
            },
            { timeout: 10_000 },
          )
          .toEqual({ active: false, queued: false });
        const selected = await dataset(page, "selected");
        expect(selected).toMatch(/^e:/);
        const frames = Number(await canvas.getAttribute("data-frames"));
        await page.mouse.move(
          box.x + box.width * (0.25 + (index % 6) * 0.1),
          box.y + box.height * (0.35 + (index % 4) * 0.1),
        );
        await expect
          .poll(async () => Number(await canvas.getAttribute("data-frames")), { timeout: 10_000 })
          .toBeGreaterThan(frames);
        expect(await dataset(page, "selected")).toBe(selected);
      }
      await expect(canvas).toHaveAttribute("data-renderer", "webgpu");
    });
  }
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
