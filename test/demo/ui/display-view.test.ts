import { afterEach, describe, expect, it } from "vitest";
import {
  BuildInfo,
  PrimaryToolbar,
  ResultLegend,
  StatusOverlays,
  ViewportPane,
  ViewportWorkspace,
  WorkbenchApp,
  createSnapshot,
  connectableController,
  button,
  element,
  fakeController,
  mount,
  tick,
  unmount,
  withOverlayState,
} from "./support";
import type { WorkbenchController } from "./support";

afterEach(() => {
  document.body.replaceChildren();
});

describe("workbench display-view", () => {
  it("keeps the command bar compact and closes disclosures predictably", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(PrimaryToolbar, {
      target,
      props: { controller: undefined, snapshot: createSnapshot(false) },
    });

    expect(target.querySelectorAll(".command-target")).toHaveLength(4);
    expect(element(target, "#selection-controls").hidden).toBe(true);
    button(target, "#command-selection").click();
    await tick();
    expect(element(target, "#selection-controls").hidden).toBe(false);
    expect(button(target, "#command-selection").getAttribute("aria-expanded")).toBe("true");
    expect(button(target, "#clear-selection").disabled).toBe(true);
    expect(button(target, "#show-all").disabled).toBe(false);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await tick();
    expect(element(target, "#selection-controls").hidden).toBe(true);
    expect(document.activeElement).toBe(button(target, "#command-selection"));

    button(target, "#command-view").click();
    window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await tick();
    expect(element(target, "#view-controls").hidden).toBe(true);

    await unmount(component);
  });

  it("renders conditional overlays, panes, and the root subscription lifecycle", async () => {
    const snapshot = withOverlayState(createSnapshot(true));
    const calls: string[] = [];
    const controller = fakeController(calls);
    const target = document.createElement("div");
    document.body.append(target);

    const pane = mount(ViewportPane, {
      target,
      props: { secondary: true, hidden: true },
    });
    expect(element(target, "#secondary-scene").hidden).toBe(true);
    await unmount(pane);

    const workspace = mount(ViewportWorkspace, {
      target,
      props: { controller, snapshot, startup: undefined },
    });
    expect(element(target, "#viewport-workspace").dataset["secondaryOpen"]).toBe("true");
    expect(element(target, ".toolbar").closest("#viewport-shell")).not.toBeNull();
    expect(element(target, ".toolbar").closest(".scene, .scene-pane")).toBeNull();
    expect(element(target, "#viewport-workspace").parentElement?.id).toBe("viewport-shell");
    await unmount(workspace);

    const legend = mount(ResultLegend, { target, props: { snapshot } });
    expect(element(target, "#result-legend").hidden).toBe(false);
    expect(element(target, "#result-legend-scalar").textContent).toContain("Demo stress");
    expect(element(target, '[aria-label="Scalar color palette"]')).toBeDefined();
    await unmount(legend);

    const overlays = mount(StatusOverlays, { target, props: { snapshot, startup: undefined } });
    expect(element(target, "#stats-panel").hidden).toBe(false);
    await unmount(overlays);

    const buildInfo = mount(BuildInfo, { target });
    expect(element(target, "#build-info").textContent).toContain("local build");
    await unmount(buildInfo);

    const app = mount(WorkbenchApp, { target });
    const api = app as unknown as {
      connectWorkbench(next: WorkbenchController): void;
      reportStartupFailure(status: { rendererStatus: string; status: string }): void;
    };
    api.connectWorkbench(connectableController(snapshot, calls));
    api.reportStartupFailure({ rendererStatus: "Renderer unsupported", status: "Try again" });
    await tick();
    expect(element(target, "#status").textContent).toContain("Try again");
    await unmount(app);
    expect(calls).toContain("unsubscribe");
  });
});
