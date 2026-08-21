import { afterEach, describe, expect, it } from "vitest";
import {
  LivePartDialog,
  createSnapshot,
  fakeController,
  input,
  mount,
  tick,
  unmount,
} from "./support";

afterEach(() => {
  document.body.replaceChildren();
});

describe("live part dialog", () => {
  it("renders no dialog without a pending live edit", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(LivePartDialog, {
      target,
      props: { controller: undefined, snapshot: createSnapshot(false) },
    });

    expect(target.querySelector("[data-testid=live-part-dialog]")).toBeNull();

    await unmount(component);
  });

  it("submits bounded add and instance requests and cancels through the controller", async () => {
    const calls: string[] = [];
    const controller = fakeController(calls);
    const target = document.createElement("div");
    document.body.append(target);
    const add = withDialog("add");
    const component = mount(LivePartDialog, { target, props: { controller, snapshot: add } });
    const form = target.querySelector("form");
    if (form === null) throw new Error("live part form is missing");

    await input(target, "[data-testid=live-part-copies]", "4");
    await input(target, "[data-testid=live-part-spacing]", "2.5");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    expect(calls).toContain("applyLivePartEdit");
    expect(target.textContent).toContain("Add one reusable Hex8 box");
    await unmount(component);

    const instance = withDialog("instance", 17, "Live Hex8 box");
    const named = mount(LivePartDialog, { target, props: { controller, snapshot: instance } });
    expect(target.textContent).toContain("Part 17 · Live Hex8 box");
    (target.querySelector("button[type=button]") as HTMLButtonElement).click();
    await tick();
    expect(calls).toContain("cancelLivePartEdit");
    await unmount(named);

    const unnamed = mount(LivePartDialog, {
      target,
      props: { controller, snapshot: withDialog("instance", 17) },
    });
    expect(target.textContent).toContain("Part 17");
    expect(target.textContent).not.toContain("Part 17 ·");

    await unmount(unnamed);
  });
});

function withDialog(kind: "add" | "instance", partId?: number, partName?: string) {
  const snapshot = createSnapshot(false);
  return {
    ...snapshot,
    overlays: {
      ...snapshot.overlays,
      livePartDialog: {
        kind,
        ...(partId === undefined ? {} : { partId }),
        ...(partName === undefined ? {} : { partName }),
      },
    },
  };
}
