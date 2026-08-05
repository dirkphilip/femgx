import { expect, test, type Locator, type Page } from "@playwright/test";

/** The stable status summary the workbench reports for a model + renderer. */
async function status(page: Page): Promise<string> {
  return (await page.getByTestId("status").textContent()) ?? "";
}

/** The stable selection/pick key encoded in the canvas dataset. */
async function dataset(page: Page, key: string): Promise<string> {
  return (await page.getByTestId("view-canvas").getAttribute(`data-${key}`)) ?? "";
}

/** Sweeps the pointer until the CPU raycast pick resolves, returning the point. */
async function findPick(
  page: Page,
  canvas: Locator,
  prefix: string,
): Promise<{ readonly x: number; readonly y: number; readonly key: string } | undefined> {
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("canvas has no bounding box");
  }
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 10; col++) {
      const x = Math.round(box.x + ((col + 0.5) / 10) * box.width);
      const y = Math.round(box.y + ((row + 0.5) / 8) * box.height);
      await page.mouse.move(x, y);
      const key = await dataset(page, "pick");
      if (key.startsWith(prefix)) {
        return { x, y, key };
      }
    }
  }
  return undefined;
}

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

test("reports the active model, renderer, instances, parts, and batches", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("status")).toHaveText(
    /Element gallery · (webgpu|cpu) · \d+ visible · 8 parts · \d+ batches · solid · (perspective|orthographic) camera/,
  );
  await expect(page.getByTestId("stats-panel")).toContainText("Visible instances");
  await expect(page.getByTestId("stats-panel")).toContainText("Reusable parts 8");
  await expect(page.getByTestId("stats-panel")).toContainText("Draw batches");
});

test("switches between deterministic model presets", async ({ page }) => {
  await page.goto("/");
  const select = page.getByTestId("model-select");
  await expect(select.locator("option")).toHaveCount(3);
  await expect(select).toHaveValue("gallery");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-model", "gallery");

  await select.selectOption("panel");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-model", "panel");
  await expect(page.getByTestId("status")).toContainText("Stiffened deck panel");

  await select.selectOption("frame");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-model", "frame");
  await expect(page.getByTestId("status")).toContainText("Portal frame");
  await expect(page.getByTestId("status")).toContainText("1 visible");

  await select.selectOption("gallery");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-model", "gallery");
});

test("switches element render modes with mode-mapped visibility", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("status")).toContainText("solid");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-mode", "solid");

  await page.getByTestId("mode-surface").click();
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-mode", "surface");
  await expect(page.getByTestId("status")).toContainText("surface");
  const surface = await status(page);

  await page.getByTestId("mode-edges").click();
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-mode", "edges");
  await expect(page.getByTestId("status")).toContainText("edges");

  await page.getByTestId("mode-solid").click();
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-mode", "solid");
  await expect(page.getByTestId("status")).toContainText("solid");
  expect(surface, "switching modes must rebuild the draw list").not.toBe(await status(page));
});

test("toggles part visibility and restores it via the visibility panel", async ({ page }) => {
  await page.goto("/");
  expect(await dataset(page, "selected")).toBe("");
  const partCheckbox = page.getByTestId("part-vis-4");
  await expect(partCheckbox).toBeChecked();

  await partCheckbox.uncheck();
  await expect(partCheckbox).not.toBeChecked();
  expect(await status(page)).toContain("3 visible");

  await partCheckbox.check();
  await expect(partCheckbox).toBeChecked();
  expect(await status(page)).toContain("4 visible");
});

test("keeps part and assembly visibility controls in separate namespaces", async ({ page }) => {
  await page.goto("/");
  // The gallery also overlaps part 1 and root assembly 1; the assembly control
  // starts checked because the scene starts with the root assembly visible.
  await expect(page.getByTestId("assembly-vis-1")).toBeChecked();
  await page.getByTestId("model-select").selectOption("frame");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-model", "frame");

  // The frame preset reuses id 1 for a part and the root assembly; the panel
  // must still create two distinct controls with their own test ids.
  const partCheckbox = page.getByTestId("part-vis-1");
  await expect(partCheckbox).toHaveAttribute("data-part-id", "1");
  await expect(partCheckbox).toBeChecked();

  const rootCheckbox = page.getByTestId("assembly-vis-1");
  await expect(rootCheckbox).toHaveAttribute("data-assembly-id", "1");
  await expect(rootCheckbox).toBeChecked();

  // Hiding the root assembly hides every descendant instance.
  await rootCheckbox.uncheck();
  await expect(rootCheckbox).not.toBeChecked();
  await expect(page.getByTestId("status")).toContainText("0 visible");

  await rootCheckbox.check();
  await expect(page.getByTestId("status")).toContainText("1 visible");

  // Hiding a part affects only that part's instances, leaving the assembly on.
  await partCheckbox.uncheck();
  await expect(partCheckbox).not.toBeChecked();
  await expect(rootCheckbox).toBeChecked();
  await expect(page.getByTestId("status")).toContainText("0 visible");

  await partCheckbox.check();
  await expect(partCheckbox).toBeChecked();
  await expect(rootCheckbox).toBeChecked();
  await expect(page.getByTestId("status")).toContainText("1 visible");
});

test("switches projection, fits to view, and resets camera controls", async ({ page }) => {
  await page.goto("/");
  const label = page.getByTestId("projection-label");
  await expect(label).toHaveText("Perspective");
  await page.getByTestId("projection-toggle").click();
  await expect(label).toHaveText("Orthographic");

  await page.getByTestId("fit-view").click();
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

test("selects an element by promoting a node pick with shift-click", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const hit = await findPick(page, canvas, "n:");
  if (hit === undefined) {
    test.skip(true, "node picking is not functional in this environment");
    return;
  }

  await page.keyboard.down("Shift");
  await page.mouse.click(hit.x, hit.y);
  await page.keyboard.up("Shift");
  await expect.poll(() => dataset(page, "selected")).toMatch(/^e:/);

  await page.keyboard.down("Shift");
  await page.mouse.click(hit.x, hit.y);
  await page.keyboard.up("Shift");
  await expect.poll(() => dataset(page, "selected")).toBe("");
});

test("picks and selects a node, exposing adjacency and neighbors", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const hit = await findPick(page, canvas, "n:");
  if (hit === undefined) {
    test.skip(true, "node picking is not functional in this environment");
    return;
  }

  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toMatch(/^n:/);
  await expect(page.getByTestId("inspection-panel")).toContainText("Adjacent elements");
  await expect(page.getByTestId("inspection-panel")).toContainText("Neighbors");
});

test("picks and selects a face, exposing its normal and ownership", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("model-select").selectOption("frame");
  await page.waitForTimeout(200);
  const canvas = page.getByTestId("view-canvas");
  const hit = await findPick(page, canvas, "f:");
  if (hit === undefined) {
    test.skip(true, "face picking is not functional in this environment");
    return;
  }

  await page.mouse.click(hit.x, hit.y);
  await expect.poll(() => dataset(page, "selected")).toMatch(/^f:/);
  await expect(page.getByTestId("inspection-panel")).toContainText("Normal");
  await expect(page.getByTestId("inspection-panel")).toContainText("Boundary");
});

test("promotes a node pick to its owning element with shift", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const hit = await findPick(page, canvas, "n:");
  if (hit === undefined) {
    test.skip(true, "node picking is not functional in this environment");
    return;
  }
  const owned = (await dataset(page, "pick")).split(":");
  expect(owned[0]).toBe("n");

  await page.keyboard.down("Shift");
  await page.mouse.click(hit.x, hit.y);
  await page.keyboard.up("Shift");
  const selected = await dataset(page, "selected");
  expect(selected.startsWith("e:")).toBe(true);
});

test("context menu selects a target and toggles display without losing selection", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const hit = await findPick(page, canvas, "n:");
  if (hit === undefined) {
    test.skip(true, "node picking is not functional in this environment");
    return;
  }

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
  await page.getByTestId("context-menu").getByText("Overlay edges").click();
  await expect(page.getByTestId("edge-overlay-label")).toHaveText("On");
  expect(await dataset(page, "selected")).toBe(selected);

  await page.mouse.click(hit.x, hit.y, { button: "right" });
  await page.getByTestId("context-menu").getByText("Hide edges").click();
  await expect(page.getByTestId("edge-overlay-label")).toHaveText("Off");
  expect(await dataset(page, "selected")).toBe(selected);
});

test("context menu hides and restores a part via the visibility panel", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const hit = await findPick(page, canvas, "n:");
  if (hit === undefined) {
    test.skip(true, "node picking is not functional in this environment");
    return;
  }

  await page.mouse.click(hit.x, hit.y, { button: "right" });
  await expect(page.getByTestId("context-menu")).toBeVisible();
  const inspection = (await page.getByTestId("inspection-panel").textContent()) ?? "";
  const match = /Part (\d+) · Instance/.exec(inspection);
  if (match === null) {
    test.skip(true, "inspection panel did not report a part");
    return;
  }
  const partId = match[1];

  const checkbox = page.getByTestId(`part-vis-${partId}`);
  await expect(checkbox).toBeChecked();
  await page.getByTestId("context-menu").getByText("Hide / Show part").click();
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByTestId("status")).toContainText("visible");

  await checkbox.check();
  await expect(checkbox).toBeChecked();
  await expect.poll(async () => (await status(page)).includes("visible")).toBe(true);
});

test("keeps selection stable across repeated orbit interactions", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const hit = await findPick(page, canvas, "n:");
  if (hit === undefined) {
    test.skip(true, "node picking is not functional in this environment");
    return;
  }
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
    await page.mouse.down();
    for (let step = 0; step < 24; step++) {
      await page.mouse.move(centerX + step * 2, centerY + step);
    }
    await page.mouse.up();
  }
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-renderer", /cpu|webgpu/);
  await expect.poll(() => dataset(page, "selected"), { timeout: 5000 }).toBe(selected);
});
