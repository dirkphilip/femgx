import { afterEach, describe, expect, it } from "vitest";
import {
  ModelSource,
  button,
  createSnapshot,
  element,
  fakeController,
  input,
  mount,
  unmount,
} from "./support";

afterEach(() => {
  document.body.replaceChildren();
});

describe("workbench model source", () => {
  it("meshes a parameterized Tet4 solid from Performance Lab", async () => {
    const calls: string[] = [];
    const base = createSnapshot(false);
    const snapshot = {
      ...base,
      model: { ...base.model, mode: "performance" as const },
    };
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(ModelSource, {
      target,
      props: { workbench: fakeController(calls), snapshot },
    });

    expect(element(target, "#tet4-cells")).toBeDefined();
    await input(target, "#tet4-cells", "10");
    button(target, "#mesh-tet4").click();
    expect(calls).toEqual(["meshTet4"]);

    await unmount(component);
  });

  it("hides Tet4 meshing outside Performance Lab", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const component = mount(ModelSource, {
      target,
      props: { workbench: fakeController([]), snapshot: createSnapshot(false) },
    });

    expect(target.querySelector("#mesh-tet4")).toBeNull();
    await unmount(component);
  });
});
