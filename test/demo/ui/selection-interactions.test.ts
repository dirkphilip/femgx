import { afterEach, describe, expect, it } from "vitest";
import {
  ContextMenu,
  PrimaryToolbar,
  VisibilityTree,
  createSnapshot,
  button,
  element,
  fakeController,
  mount,
  tick,
  unmount,
  visibilitySnapshot,
} from "./support";
import type { WorkbenchSnapshot } from "./support";

afterEach(() => {
  document.body.replaceChildren();
});

describe("workbench selection-interactions", () => {
  it("routes clear selection and keeps it disabled without selected targets", async () => {
    const calls: string[] = [];
    const target = document.createElement("div");
    document.body.append(target);
    const emptyComponent = mount(PrimaryToolbar, {
      target,
      props: { workbench: fakeController(calls), snapshot: createSnapshot(false) },
    });
    button(target, "#command-selection").click();
    await tick();
    expect(button(target, "#clear-selection").disabled).toBe(true);
    await unmount(emptyComponent);

    const base = createSnapshot(false);
    const selectedSnapshot: WorkbenchSnapshot = {
      ...base,
      hierarchy: { ...base.hierarchy, selectedCount: 1 },
    };
    const selectedComponent = mount(PrimaryToolbar, {
      target,
      props: { workbench: fakeController(calls), snapshot: selectedSnapshot },
    });
    button(target, "#command-selection").click();
    await tick();
    expect(button(target, "#clear-selection").disabled).toBe(false);
    button(target, "#clear-selection").click();
    expect(calls).toContain("clearSelection");
    await unmount(selectedComponent);
  });

  it("only enables Hide selected when visible elements are selected", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const base = createSnapshot(false);
    const nonElementComponent = mount(PrimaryToolbar, {
      target,
      props: {
        workbench: undefined,
        snapshot: {
          ...base,
          hierarchy: { ...base.hierarchy, selectedCount: 1, hideSelectedElementCount: 0 },
        },
      },
    });
    button(target, "#command-selection").click();
    await tick();
    const hideSelected = button(target, "#hide-selected");
    expect(hideSelected.disabled).toBe(true);
    expect(hideSelected.getAttribute("aria-label")).toBe("Hide selected elements unavailable");
    expect(hideSelected.title).toBe("Select one or more visible elements to hide.");
    await unmount(nonElementComponent);

    const elementComponent = mount(PrimaryToolbar, {
      target,
      props: {
        workbench: undefined,
        snapshot: {
          ...base,
          hierarchy: { ...base.hierarchy, selectedCount: 1, hideSelectedElementCount: 1 },
        },
      },
    });
    button(target, "#command-selection").click();
    await tick();
    const enabledHideSelected = button(target, "#hide-selected");
    expect(enabledHideSelected.disabled).toBe(false);
    expect(enabledHideSelected.getAttribute("aria-label")).toBe("Hide selected element");
    expect(enabledHideSelected.title).toBe("Hide 1 selected visible element.");
    await unmount(elementComponent);
  });

  it("dispatches stable visibility targets and cleans up on unmount", async () => {
    const calls: string[] = [];
    const workbench = fakeController(calls);
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(VisibilityTree, {
      target,
      props: { workbench, visibility: visibilitySnapshot() },
    });

    const assemblyRow = element(target, '[role="treeitem"]');
    assemblyRow.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    assemblyRow.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    button(target, ".visibility-expander").click();
    (element(target, 'input[type="checkbox"]') as HTMLInputElement).click();
    const bodyName = element(target, '[data-body-highlight="true"]') as HTMLButtonElement;
    bodyName.click();
    button(target, '[data-testid="body-elements-1-1"]').click();
    assemblyRow.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    assemblyRow.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await tick();

    expect(calls).toEqual(
      expect.arrayContaining([
        "setHierarchyHover",
        "clearHierarchyHover",
        "toggleVisibilityTree",
        "toggleVisibility",
        "toggleBodyHighlight",
        "openElementDetail",
      ]),
    );
    await unmount(component);

    const menuTarget = document.createElement("div");
    document.body.append(menuTarget);
    const menu = mount(ContextMenu, {
      target: menuTarget,
      props: { workbench, snapshot: createSnapshot(false) },
    });
    await unmount(menu);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(calls).not.toContain("clearContextMenu");
  });

  it("navigates an addressable visibility page beyond the first window", async () => {
    const calls: string[] = [];
    const target = document.createElement("div");
    document.body.append(target);
    const base = visibilitySnapshot();
    const component = mount(VisibilityTree, {
      target,
      props: {
        workbench: fakeController(calls),
        visibility: { ...base, pageCount: 2, rowCount: 1_001 },
      },
    });

    expect(element(target, '[data-testid="visibility-page-status"]').textContent).toContain(
      "Page 1 of 2",
    );
    button(target, '[data-testid="visibility-page-next"]').click();
    await tick();

    expect(calls).toContain("setVisibilityPage");
    await unmount(component);
  });
});
