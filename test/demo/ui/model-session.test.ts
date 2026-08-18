import { afterEach, describe, expect, it } from "vitest";
import {
  ContextMenu,
  ElementDetail,
  TouchToolRail,
  WorkbenchApp,
  VisibilityTree,
  createCommands,
  createSnapshot,
  connectableController,
  button,
  element,
  fakeController,
  mount,
  tick,
  unmount,
  visibilitySnapshot,
  withOverlayState,
} from "./support";
import type {
  WorkbenchCommands,
  WorkbenchController,
  WorkbenchElementDetailSnapshot,
} from "./support";

afterEach(() => {
  document.body.replaceChildren();
});

describe("workbench model-session", () => {
  it("routes the compact touch rail through typed tool commands", async () => {
    const calls: string[] = [];
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(TouchToolRail, {
      target,
      props: { controller: fakeController(calls), snapshot: createSnapshot(false) },
    });

    button(target, '[data-testid="touch-tool-box-select"]').click();
    button(target, '[data-testid="touch-tool-hover"]').click();
    button(target, '[data-testid="touch-tool-navigate"]').click();
    button(target, '[data-testid="touch-tool-select-all"]').click();

    expect(calls).toEqual([
      "setTouchInteractionMode",
      "setTouchInteractionMode",
      "setTouchInteractionMode",
      "selectAll",
    ]);
    await unmount(component);
  });

  it("keeps the phone navigation drawer focusable and exclusive of Analysis", async () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    const target = document.createElement("div");
    document.body.append(target);
    const app = mount(WorkbenchApp, { target });
    const api = app as unknown as {
      connectWorkbench(next: WorkbenchController): void;
    };
    api.connectWorkbench(
      connectableController(createSnapshot(true), [], {
        clearContextMenu: () => undefined,
      } as unknown as WorkbenchCommands),
    );
    await tick();

    const navigation = button(target, '[data-testid="navigation-toggle"]');
    expect(navigation.getAttribute("aria-expanded")).toBe("false");
    expect(navigation.getAttribute("aria-label")).toBe("Open navigation");
    expect(navigation.textContent.trim()).toBe("");
    button(target, "#command-analysis").click();
    await tick();
    expect(element(target, "#analysis-controls").hidden).toBe(false);

    navigation.click();
    await tick();
    await Promise.resolve();
    expect(navigation.getAttribute("aria-expanded")).toBe("true");
    expect(navigation.getAttribute("aria-label")).toBe("Close navigation");
    expect(navigation.textContent.trim()).toBe("");
    expect(element(target, "#analysis-controls").hidden).toBe(true);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Tab", shiftKey: true }),
    );
    await tick();
    button(target, ".navigation-scrim").click();
    await tick();
    expect(navigation.getAttribute("aria-expanded")).toBe("false");
    expect(navigation.getAttribute("aria-label")).toBe("Open navigation");

    navigation.click();
    await tick();
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    await tick();
    expect(navigation.getAttribute("aria-expanded")).toBe("false");

    navigation.click();
    await tick();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    window.dispatchEvent(new Event("resize"));
    await tick();
    expect(navigation.getAttribute("aria-expanded")).toBe("false");

    await unmount(app);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: previousWidth });
  });

  it("dispatches context-menu actions and closes on outside or Escape events", async () => {
    const calls: string[] = [];
    const target = document.createElement("div");
    document.body.append(target);
    const menu = mount(ContextMenu, {
      target,
      props: {
        controller: fakeController(calls),
        snapshot: withOverlayState(createSnapshot(false)),
      },
    });
    await tick();

    (element(target, '[role="menuitem"]') as HTMLButtonElement).click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(calls).toEqual(expect.arrayContaining(["contextMenuAction", "clearContextMenu"]));
    await unmount(menu);
  });

  it("keeps body element detail bounded and routes its commands", async () => {
    const calls: string[] = [];
    const controller = {
      commands: createCommands(calls),
      elementDetailActions: {
        elementIdsForDetail: () => Array.from({ length: 10_000 }, (_, index) => index + 1),
        isElementSelected: (_instanceId: string, elementId: number) => elementId === 1,
      },
    } as unknown as WorkbenchController;
    const detail: WorkbenchElementDetailSnapshot = {
      partOccurrenceId: "1",
      bodyId: 1,
      label: "Body",
      partName: "Part",
      count: 10_000,
    };
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(ElementDetail, { target, props: { controller, detail } });
    await tick();

    expect(target.querySelectorAll('[role="option"]').length).toBeLessThan(100);
    expect(target.querySelector('[role="option"]')?.getAttribute("aria-selected")).toBe("true");
    target
      .querySelector('[role="option"]')
      ?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    target
      .querySelector('[role="option"]')
      ?.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    (target.querySelector('[role="option"]') as HTMLButtonElement).click();
    button(target, '[data-testid="element-detail-back"]').click();
    await tick();

    expect(calls).toEqual(
      expect.arrayContaining([
        "setElementDetailHover",
        "clearElementDetailHover",
        "selectElementDetail",
        "closeElementDetail",
      ]),
    );
    await unmount(component);
  });

  it("mounts only a bounded window for a large visibility hierarchy", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const base = visibilitySnapshot();
    const seed = base.rows[0];
    if (seed === undefined) throw new Error("Visibility fixture has no rows");
    const rows = Array.from({ length: 10_000 }, (_, index) => ({
      ...seed,
      key: `row:${index}`,
      testId: `row-${index}`,
      position: index + 1,
      setSize: 10_000,
    }));
    const component = mount(VisibilityTree, {
      target,
      props: { controller: undefined, visibility: { ...base, rows } },
    });
    await tick();

    expect(target.querySelectorAll('[role="treeitem"]').length).toBeLessThan(100);
    await unmount(component);
  });
});
