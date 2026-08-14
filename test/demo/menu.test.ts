import { describe, expect, it, vi } from "vitest";
import { WorkbenchMenu } from "../../demo/workbench/menu";

describe("workbench context-menu state", () => {
  it("publishes target actions and hides after activation", () => {
    const changed = vi.fn();
    const action = vi.fn();
    const menu = new WorkbenchMenu(
      () => true,
      () => false,
      action,
      changed,
    );

    menu.show({ kind: "element", instanceId: "1/0", elementId: 4 }, 120, 80);

    expect(menu.snapshot).toMatchObject({
      visible: true,
      x: 120,
      y: 80,
      title: "Element 4",
    });
    expect(menu.snapshot.entries).toEqual(
      expect.arrayContaining([
        { kind: "button", label: "Highlight / Clear", action: "highlight" },
        { kind: "button", label: "Hide / Show instance", action: "hide-instance" },
        { kind: "button", label: "Hide / Show part", action: "hide-part" },
      ]),
    );

    menu.activate("highlight");

    expect(action).toHaveBeenCalledWith("highlight");
    expect(menu.snapshot.visible).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("creates a bounded empty-space view menu", () => {
    const menu = new WorkbenchMenu(
      () => false,
      () => true,
      vi.fn(),
      vi.fn(),
    );

    menu.showView(10, 20);

    expect(menu.snapshot).toMatchObject({ visible: true, title: "View", x: 10, y: 20 });
    expect(menu.snapshot.entries).toEqual(
      expect.arrayContaining([
        { kind: "button", label: "Hide diagnostics", action: "diagnostics" },
        { kind: "button", label: "Clear selection", action: "clear-selection" },
      ]),
    );
  });
});
