import { afterEach, describe, expect, it } from "vitest";
import { createCamera } from "../../src/camera/camera";
import {
  createOrientationGizmo,
  type OrientationGizmoOptions,
} from "../../src/viewport/orientation-gizmo";

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  readonly dataset: Record<string, string> = {};
  readonly style = {
    opacity: "",
    position: "",
    left: "",
    bottom: "",
    width: "",
    height: "",
    border: "",
    borderRadius: "",
    background: "",
    boxShadow: "",
    pointerEvents: "",
    userSelect: "",
  };
  parent: FakeNode | undefined;
  className = "";
  textContent = "";

  appendChild(child: FakeNode): FakeNode {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  contains(candidate: FakeNode): boolean {
    return this.children.some((child) => child === candidate || child.contains(candidate));
  }

  remove(): void {
    const index = this.parent?.children.indexOf(this) ?? -1;
    if (index >= 0) this.parent?.children.splice(index, 1);
    this.parent = undefined;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(name: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  dispatchEvent(name: string, event: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}

class FakeDocument {
  createElement(): FakeNode {
    return new FakeNode();
  }

  createElementNS(): FakeNode {
    return new FakeNode();
  }
}

const originalDocument = globalThis.document;

afterEach(() => {
  globalThis.document = originalDocument;
});

function installDocument(): void {
  globalThis.document = new FakeDocument() as unknown as Document;
}

function options(container: HTMLElement): OrientationGizmoOptions {
  return { container };
}

describe("orientation gizmo", () => {
  it("creates one accessible root with six faces, eight corners, and four arrows", () => {
    installDocument();
    const container = new FakeNode();
    const canvas = new FakeNode();
    container.appendChild(canvas);

    const gizmo = createOrientationGizmo(options(container as unknown as HTMLElement));
    const root = container.children[1];
    expect(root?.className).toBe("femgx-orientation-gizmo");
    expect(root?.attributes.get("data-femgx-orientation-gizmo")).toBe("true");
    expect(root?.attributes.get("role")).toBe("group");
    expect(root?.attributes.get("aria-label")).toContain("View cube");
    const svg = root?.children[0];
    const targets = svg?.children.filter((child) => child.attributes.has("data-view-cube-target"));
    expect(targets).toHaveLength(18);
    expect(svg?.children.filter((child) => child.attributes.has("data-view-face"))).toHaveLength(6);
    expect(svg?.children.filter((child) => child.attributes.has("data-view-corner"))).toHaveLength(
      8,
    );
    expect(svg?.children.filter((child) => child.attributes.has("data-rotate"))).toHaveLength(4);
    gizmo.destroy();
  });

  it("updates existing face nodes and restores owned container positioning", () => {
    installDocument();
    const container = new FakeNode();
    const canvas = new FakeNode();
    container.appendChild(canvas);
    const gizmo = createOrientationGizmo(options(container as unknown as HTMLElement));
    const root = container.children[1];
    const face = root?.children[0]?.children.find(
      (child) => child.attributes.get("data-view-face") === "right",
    );
    const before = face?.children[0]?.attributes.get("points");
    gizmo.update(createCamera({ position: [5, 0, 0], target: [0, 0, 0] }));
    expect(face?.children[0]?.attributes.get("points")).not.toBe(before);
    expect(face?.attributes.get("aria-label")).toBe("View Right (+X)");
    expect(container.style.position).toBe("relative");
    gizmo.destroy();
    gizmo.destroy();
    expect(container.children).toHaveLength(1);
    expect(container.style.position).toBe("");
  });

  it("maps keyboard and modifier actions, then ignores destroyed controls", () => {
    installDocument();
    const container = new FakeNode();
    const canvas = new FakeNode();
    container.appendChild(canvas);
    const actions: unknown[] = [];
    const gizmo = createOrientationGizmo(options(container as unknown as HTMLElement), (action) => {
      actions.push(action);
    });
    const arrow = container.children[1]?.children[0]?.children.find(
      (child) => child.attributes.get("data-rotate") === "left",
    );
    if (arrow === undefined) throw new Error("left arrow is missing");
    arrow.dispatchEvent("click", { shiftKey: false, ctrlKey: true, metaKey: false });
    arrow.dispatchEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => undefined,
    });
    expect(actions).toEqual([
      { kind: "rotate", rotation: "left", stepDegrees: 5 },
      { kind: "rotate", rotation: "left", stepDegrees: 90 },
    ]);

    gizmo.destroy();
    arrow.dispatchEvent("click", { shiftKey: false, ctrlKey: false, metaKey: false });
    expect(actions).toHaveLength(2);
  });

  it("preserves an existing positioning context", () => {
    installDocument();
    const container = new FakeNode();
    container.style.position = "absolute";
    const canvas = new FakeNode();
    container.appendChild(canvas);
    const gizmo = createOrientationGizmo(options(container as unknown as HTMLElement));
    gizmo.destroy();
    expect(container.style.position).toBe("absolute");
  });
});
