import { expect, test, type Locator, type Page } from "@playwright/test";
import { distinctColors, drawnPixels, requireHit } from "./helpers";

/** The stable status summary the workbench reports for a model + renderer. */
async function status(page: Page): Promise<string> {
  return (await page.getByTestId("status").textContent()) ?? "";
}

/** The stable selection/pick key encoded in the canvas dataset. */
async function dataset(page: Page, key: string): Promise<string> {
  return (await page.getByTestId("view-canvas").getAttribute(`data-${key}`)) ?? "";
}

/** Waits for asynchronous WebGPU setup before inspecting workbench state. */
async function waitForRenderer(page: Page): Promise<void> {
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-renderer", "webgpu", {
    timeout: 10_000,
  });
}

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

/** Drags the primary button past the box threshold inside the canvas bounds. */
async function primaryBoxDrag(
  page: Page,
  canvas: Locator,
  start: { readonly fx: number; readonly fy: number },
  end: { readonly fx: number; readonly fy: number },
): Promise<void> {
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  await page.mouse.move(
    Math.round(box.x + start.fx * box.width),
    Math.round(box.y + start.fy * box.height),
  );
  await page.mouse.down({ button: "left" });
  await page.mouse.move(
    Math.round(box.x + end.fx * box.width),
    Math.round(box.y + end.fy * box.height),
  );
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
    /Bolted plate assembly · webgpu · \d+ visible · 4 parts · \d+ batches · solid · (perspective|orthographic) camera/,
  );
  await expect(page.getByTestId("renderer-status")).toHaveText(/Renderer webgpu/);
  await expect(page.getByTestId("stats-panel")).toContainText("Visible instances");
  await expect(page.getByTestId("stats-panel")).toContainText("Reusable parts 4");
  await expect(page.getByTestId("stats-panel")).toContainText("Draw batches");
});

test("defaults to the bolted plate assembly showcase", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("model-select")).toHaveValue("bolted");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-model", "bolted");
  await expect(page.getByTestId("status")).toContainText("Bolted plate assembly");
  await expect(page.getByTestId("status")).toContainText("34 visible");
  await expect(page.getByTestId("stats-panel")).toContainText("Reusable parts 4");
});

test("shows a camera-aligned world coordinate gizmo", async ({ page }) => {
  await page.goto("/");
  const gizmo = page.locator('[data-femgx-orientation-gizmo="true"]');
  await expect(gizmo).toBeVisible();
  await expect(gizmo.locator("circle")).toHaveCount(1);
  await expect(gizmo.locator("line")).toHaveCount(6);
  await expect(gizmo.locator("text")).toHaveCount(6);
  await expect(gizmo).toContainText("+X");
  await expect(gizmo).toContainText("−X");
  await expect(gizmo).toContainText("+Y");
  await expect(gizmo).toContainText("−Y");
  await expect(gizmo).toContainText("+Z");
  await expect(gizmo).toContainText("−Z");
});

test("updates the existing orientation gizmo nodes after camera movement", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const positiveX = page.locator('[data-femgx-orientation-gizmo="true"] line[data-axis="+x"]');
  await expect(canvas).toHaveAttribute("data-renderer", "webgpu", { timeout: 10_000 });
  const before = await positiveX.evaluate((line) => ({
    x2: line.getAttribute("x2"),
    y2: line.getAttribute("y2"),
  }));
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("canvas has no bounding box");
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.42);
  await page.mouse.up({ button: "middle" });
  await expect
    .poll(() =>
      positiveX.evaluate((line) => ({ x2: line.getAttribute("x2"), y2: line.getAttribute("y2") })),
    )
    .not.toEqual(before);
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

test("switches between deterministic model presets", async ({ page }) => {
  await page.goto("/");
  const select = page.getByTestId("model-select");
  const canvas = page.getByTestId("view-canvas");
  await expect(select.locator("option")).toHaveCount(5);
  await expect(select).toHaveValue("bolted");
  await expect(canvas).toHaveAttribute("data-model", "bolted");
  await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "true");

  for (const id of ["vtk", "gallery", "hex20-cylinder", "results", "bolted"]) {
    await page.getByTestId("edge-overlay").click();
    await page.getByTestId("node-overlay").click();
    await expect(page.getByTestId("edge-overlay")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("node-overlay")).toHaveAttribute("aria-pressed", "false");
    await select.selectOption(id);
    await expect(canvas).toHaveAttribute("data-model", id);
    await expect(canvas).toHaveAttribute("data-mode", "solid");
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

test("refits cleanly after switching from a larger gallery to the bolted model", async ({
  page,
}) => {
  await page.goto("/");
  const select = page.getByTestId("model-select");
  const canvas = page.getByTestId("view-canvas");
  await select.selectOption("gallery");
  await page.getByTestId("fit-view").click();
  await expect.poll(() => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);

  await select.selectOption("bolted");
  await page.getByTestId("fit-view").click();
  await expect.poll(() => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);
  const hit = await requireHit(
    page,
    canvas,
    {},
    "GPU picking must remain functional after history-independent fitting",
  );
  expect(hit.key).toMatch(/^(n|f|e|i|p):/);
});

test("cycles the canonical static results preset through base, colored, and deformed states", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("model-select").selectOption("results");
  const canvas = page.getByTestId("view-canvas");
  await expect(canvas).toHaveAttribute("data-model", "results");
  await expect(canvas).toHaveAttribute("data-results", "deformed");

  const resultsToggle = page.getByTestId("results-toggle");
  await expect(resultsToggle).toBeEnabled();
  await resultsToggle.click();
  await expect(canvas).toHaveAttribute("data-results", "base");
  await resultsToggle.click();
  await expect(canvas).toHaveAttribute("data-results", "colored");
  await resultsToggle.click();
  await expect(canvas).toHaveAttribute("data-results", "deformed");
});

test("toggles the element edge overlay independently of solid geometry", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("status")).toContainText("solid");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-mode", "solid");
  await expect(page.getByTestId("edge-overlay-label")).toHaveText("On");

  await page.getByTestId("edge-overlay").click();
  await expect(page.getByTestId("edge-overlay-label")).toHaveText("Off");
  await expect(page.getByTestId("view-canvas")).toHaveAttribute("data-mode", "solid");
});

test("reset restores the complete workbench display state", async ({ page }) => {
  await page.goto("/");
  const canvas = page.getByTestId("view-canvas");
  const firstPart = page.locator("#visibility-panel input[data-instance-id]").first();
  await firstPart.uncheck();
  await page.getByTestId("edge-overlay").click();
  await page.getByTestId("node-overlay").click();
  await page.getByTestId("depth-test").click();
  await page.getByTestId("projection-toggle").click();

  await expect(firstPart).not.toBeChecked();
  await expect(page.getByTestId("edge-overlay-label")).toHaveText("Off");
  await expect(page.getByTestId("node-overlay-label")).toHaveText("Off");
  await expect(page.getByTestId("depth-test-label")).toHaveText("Off");
  await expect(page.getByTestId("projection-label")).toHaveText("Orthographic");

  await page.getByTestId("reset").click();
  await expect(firstPart).toBeChecked();
  await expect(page.getByTestId("edge-overlay-label")).toHaveText("On");
  await expect(page.getByTestId("node-overlay-label")).toHaveText("On");
  await expect(page.getByTestId("depth-test-label")).toHaveText("On");
  await expect(page.getByTestId("projection-label")).toHaveText("Perspective");
  await expect(canvas).toHaveAttribute("data-mode", "solid");
});

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
  const firstHighlight = await canvas.screenshot();
  const firstTreeHover = await canvas.getAttribute("data-tree-hover");
  expect(await dataset(page, "selected")).toBe(selected);

  await secondOccurrence.hover();
  await expect.poll(() => canvas.getAttribute("data-tree-hover")).not.toBe(firstTreeHover);
  await expect
    .poll(async () => Buffer.compare(firstHighlight, await canvas.screenshot()) !== 0)
    .toBe(true);
  expect(await dataset(page, "selected")).toBe(selected);

  await visibility.getByTestId("visibility-context").hover();
  await expect
    .poll(async () => Buffer.compare(baseline, await canvas.screenshot()) === 0)
    .toBe(true);
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
  await expect(page.getByTestId("edge-overlay-label")).toHaveText("On");
  await expect(page.getByTestId("node-overlay-label")).toHaveText("On");

  const body = page.locator('input[data-testid^="body-vis-"]').first();
  await expect(body).toBeChecked();
  await body.uncheck();
  await expect(body).not.toBeChecked();
  await expect.poll(async () => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);

  await body.check();
  await expect(body).toBeChecked();
  await expect.poll(async () => drawnPixels(canvas), { timeout: 10_000 }).toBe(true);
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

test("toggles the edge overlay", async ({ page }) => {
  await page.goto("/");
  const overlayLabel = page.getByTestId("edge-overlay-label");
  await expect(overlayLabel).toHaveText("On");
  await page.getByTestId("edge-overlay").click();
  await expect(overlayLabel).toHaveText("Off");
  await page.getByTestId("edge-overlay").click();
  await expect(overlayLabel).toHaveText("On");
});

test("keeps the depth-test toggle enabled on the WebGPU renderer", async ({ page }) => {
  await page.goto("/");
  await expect
    .poll(() => page.getByTestId("view-canvas").getAttribute("data-renderer"), {
      timeout: 10_000,
    })
    .toBe("webgpu");

  // The WebGPU renderer draws a depth-tested edge pass, so the control stays
  // live instead of being annotated as unsupported.
  const depthButton = page.getByTestId("depth-test");
  await expect(depthButton).toBeEnabled();
  await expect(page.getByTestId("depth-test-label")).toHaveText("On");
  await depthButton.click();
  await expect(page.getByTestId("depth-test-label")).toHaveText("Off");
  await depthButton.click();
  await expect(page.getByTestId("depth-test-label")).toHaveText("On");
});

test("selects an element by promoting a node pick with shift-click", async ({ page }) => {
  await page.goto("/");
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

test("clears selection on empty scene clicks but preserves it through orbit", async ({ page }) => {
  await page.goto("/");
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
  await page.goto("/");
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
  const nodeKey = await dataset(page, "selected");
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.down(modifier);
  await page.mouse.click(faceHit.x, faceHit.y);
  await page.keyboard.up(modifier);
  await expect.poll(() => dataset(page, "selected")).toContain(nodeKey);
  const additive = await dataset(page, "selected");
  expect(additive).toContain("f:");

  await page.keyboard.down(modifier);
  await page.mouse.click(faceHit.x, faceHit.y);
  await page.keyboard.up(modifier);
  await expect.poll(() => dataset(page, "selected")).toBe(nodeKey);
});

test("picks and selects a node, exposing adjacency and neighbors", async ({ page }) => {
  await page.goto("/");
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
  await page.goto("/");
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
  await expect(page.getByTestId("edge-overlay-label")).toHaveText("Off");
  expect(await dataset(page, "selected")).toBe(selected);

  await page.mouse.click(hit.x, hit.y, { button: "right" });
  await page.getByTestId("context-menu").getByText("Overlay edges").click();
  await expect(page.getByTestId("edge-overlay-label")).toHaveText("On");
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
  await expect(menu.locator('button[data-action="select"]')).toHaveCount(0);

  await menu.getByText("Clear selection").click();
  await expect.poll(() => dataset(page, "selected")).toBe("");
  await expect(menu).toBeHidden();

  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await menu.getByText("Show all").click();
  await expect(partCheckbox).toBeChecked();

  await page.getByTestId("projection-toggle").click();
  await expect(page.getByTestId("projection-label")).toHaveText("Orthographic");
  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await menu.getByText("Reset view").click();
  await expect(page.getByTestId("projection-label")).toHaveText("Perspective");

  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await page.mouse.click(empty.x, empty.y, { button: "right" });
  await expect(menu).toBeVisible();
  await page.getByTestId("renderer-status").click();
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

test("keeps selection stable across repeated orbit interactions", async ({ page }) => {
  await page.goto("/");
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
