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
  it("creates one accessible root with six faces, eight corners, and six arrows", () => {
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
    expect(root?.style.background).toBe("transparent");
    expect(root?.style.width).toBe("clamp(104px, 11vw, 132px)");
    const svg = root?.children[0];
    const targets = svg?.children.filter((child) => child.attributes.has("data-view-cube-target"));
    expect(targets).toHaveLength(20);
    expect(svg?.children.filter((child) => child.attributes.has("data-view-face"))).toHaveLength(6);
    expect(svg?.children.filter((child) => child.attributes.has("data-view-corner"))).toHaveLength(
      8,
    );
    expect(svg?.children.filter((child) => child.attributes.has("data-rotate"))).toHaveLength(6);
    expect(
      svg?.children.filter(
        (child) =>
          child.attributes.get("data-rotate") === "clockwise" ||
          child.attributes.get("data-rotate") === "counterclockwise",
      ),
    ).toHaveLength(2);
    const leftArrow = svg?.children.find((child) => child.attributes.get("data-rotate") === "left");
    expect(leftArrow?.children[1]?.attributes.get("points")).toBe("16,40 5,50 16,60");
    expect(leftArrow?.children[1]?.attributes.get("data-view-cube-arrow")).toBe("true");
    expect(svg?.children[0]?.textContent).toContain("[data-rotate]:hover");
    expect(svg?.children[0]?.textContent).toContain("[data-rotate]:focus-visible");
    expect(svg?.children[0]?.textContent).toContain("light-dark(#1f2937, #f8fafc)");
    const clockwise = svg?.children.find(
      (child) => child.attributes.get("data-rotate") === "clockwise",
    );
    expect(clockwise?.children[1]?.attributes.get("d")).toBe("M 8 32 A 24 24 0 0 1 32 8");
    expect(clockwise?.children[2]?.attributes.get("points")).toBe("26 3 32 8 26 13");
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

    const clockwise = container.children[1]?.children[0]?.children.find(
      (child) => child.attributes.get("data-rotate") === "clockwise",
    );
    if (clockwise === undefined) throw new Error("clockwise arrow is missing");
    clockwise.dispatchEvent("click", { shiftKey: false, ctrlKey: false, metaKey: false });
    clockwise.dispatchEvent("keydown", {
      key: " ",
      shiftKey: false,
      ctrlKey: false,
      metaKey: true,
      preventDefault: () => undefined,
    });
    expect(actions.slice(-2)).toEqual([
      { kind: "rotate", rotation: "clockwise", stepDegrees: 15 },
      { kind: "rotate", rotation: "clockwise", stepDegrees: 5 },
    ]);

    const counterclockwise = container.children[1]?.children[0]?.children.find(
      (child) => child.attributes.get("data-rotate") === "counterclockwise",
    );
    expect(counterclockwise?.attributes.get("aria-label")).toBe(
      "Rotate view counterclockwise 15 degrees; Shift 90 degrees; Control or Command 5 degrees",
    );

    const actionCount = actions.length;
    gizmo.destroy();
    arrow.dispatchEvent("click", { shiftKey: false, ctrlKey: false, metaKey: false });
    expect(actions).toHaveLength(actionCount);
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
