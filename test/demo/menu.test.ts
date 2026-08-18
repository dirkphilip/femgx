import { describe, expect, it, vi } from "vitest";
import { createInteractionState } from "../../src/entries/root";
import { contextMenuSelectionOptions, WorkbenchMenu } from "../../demo/workbench/interaction/menu";

describe("workbench context-menu state", () => {
  it("publishes target actions and hides after activation", () => {
    const changed = vi.fn();
    const action = vi.fn();
    const menu = new WorkbenchMenu(
      () => true,
      () => false,
      () => true,
      action,
      changed,
    );

    menu.show({ kind: "element", partOccurrenceId: "1/0", elementId: 4 }, 120, 80);

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
        {
          kind: "button",
          label: "Fit selection (Z)",
          action: "fit-selection",
          help: "Frame the visible selected geometry with the same interruptible camera action as Z.",
        },
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
      () => false,
      vi.fn(),
      vi.fn(),
    );

    menu.showView(10, 20);

    expect(menu.snapshot).toMatchObject({ visible: true, title: "View", x: 10, y: 20 });
    expect(menu.snapshot.entries).toEqual(
      expect.arrayContaining([
        { kind: "button", label: "Hide diagnostics", action: "diagnostics" },
        { kind: "button", label: "Clear selection", action: "clear-selection" },
        {
          kind: "button",
          label: "Fit model (Z)",
          action: "fit-selection",
          help: "Frame the complete model because no visible selection can be framed.",
        },
      ]),
    );
  });

  it("offers exact element selection and visibility actions", () => {
    const target = { kind: "element" as const, partOccurrenceId: "1/0", elementId: 2 };
    const interaction = createInteractionState();
    const options = contextMenuSelectionOptions(target, interaction);
    expect(options).toMatchObject({
      elementSelectionLabel: "Select element",
      elementVisibilityLabel: "Hide element",
    });

    const menu = new WorkbenchMenu(
      () => false,
      () => false,
      () => false,
      vi.fn(),
      vi.fn(),
    );
    menu.show(target, 0, 0, options);
    expect(menu.snapshot.entries).toEqual(
      expect.arrayContaining([
        { kind: "button", label: "Select element", action: "select-element" },
        { kind: "button", label: "Hide element", action: "hide-element" },
      ]),
    );
  });
});
