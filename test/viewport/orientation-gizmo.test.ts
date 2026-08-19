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
  ownerDocument: FakeDocument | undefined;
  className = "";
  textContent = "";

  appendChild(child: FakeNode): FakeNode {
    const existingIndex = child.parent?.children.indexOf(child) ?? -1;
    if (existingIndex >= 0) child.parent?.children.splice(existingIndex, 1);
    child.parent = this;
    child.ownerDocument = this.ownerDocument;
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

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(name: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  dispatchEvent(name: string, event: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }

  focus(): void {
    this.ownerDocument?.setActiveElement(this);
  }
}

class FakeDocument {
  activeElement: FakeNode | null = null;

  createElement(): FakeNode {
    return this.createNode();
  }

  createElementNS(): FakeNode {
    return this.createNode();
  }

  setActiveElement(node: FakeNode): void {
    this.activeElement = node;
  }

  private createNode(): FakeNode {
    const node = new FakeNode();
    node.ownerDocument = this;
    return node;
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
  it("creates one accessible root with six faces, eight corners, six arrows, and one axis triad", () => {
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
    expect(root?.style.pointerEvents).toBe("auto");
    expect(root?.style.width).toBe("clamp(104px, 11vw, 132px)");
    const svg = root?.children[0];
    expect(svg?.style.pointerEvents).toBe("auto");
    const targets = svg?.children.filter((child) => child.attributes.has("data-view-cube-target"));
    expect(targets).toHaveLength(20);
    expect(targets?.every((target) => target.attributes.get("tabindex") === "0")).toBe(true);
    expect(targets?.every((target) => target.attributes.get("aria-hidden") === "false")).toBe(true);
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
    const axes = svg?.children.find((child) => child.attributes.has("data-view-axis-triad"));
    expect(axes?.attributes.get("aria-hidden")).toBe("true");
    expect(axes?.style.pointerEvents).toBe("none");
    expect(
      axes?.children.filter((child) => child.attributes.has("data-view-axis-line")),
    ).toHaveLength(3);
    expect(
      axes?.children.filter((child) => child.attributes.has("data-view-axis-label")),
    ).toHaveLength(3);
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
    const counterclockwise = svg?.children.find(
      (child) => child.attributes.get("data-rotate") === "counterclockwise",
    );
    expect(counterclockwise?.children[1]?.attributes.get("d")).toBe("M 68 92 A 24 24 0 0 0 92 68");
    expect(counterclockwise?.children[2]?.attributes.get("points")).toBe("87 74 92 68 97 74");
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
    expect(face?.attributes.get("aria-label")).toBe("View Right · YZ plane (+X)");
    expect(face?.attributes.get("data-view-plane")).toBe("YZ");
    expect(face?.attributes.get("data-view-side")).toBe("+X");
    expect(face?.attributes.get("tabindex")).toBe("0");
    expect(face?.attributes.get("aria-hidden")).toBe("false");
    const hiddenFaces = root?.children[0]?.children.filter(
      (child) =>
        child.attributes.has("data-view-face") && child.attributes.get("aria-hidden") === "true",
    );
    expect(hiddenFaces).toHaveLength(5);
    const axisGroup = root?.children[0]?.children.find((child) =>
      child.attributes.has("data-view-axis-triad"),
    );
    const axisLine = axisGroup?.children.find(
      (child) => child.attributes.get("data-view-axis-line") === "x",
    );
    expect(axisLine?.attributes.get("x2")).toBeDefined();
    expect(axisLine?.attributes.get("y2")).toBeDefined();
    expect(container.style.position).toBe("relative");
    gizmo.destroy();
    gizmo.destroy();
    expect(container.children).toHaveLength(1);
    expect(container.style.position).toBe("");
  });

  it("removes hidden face and corner targets from accessibility and hands off focus", () => {
    installDocument();
    const container = new FakeNode();
    const canvas = new FakeNode();
    container.appendChild(canvas);
    const gizmo = createOrientationGizmo(options(container as unknown as HTMLElement));
    const svg = container.children[1]?.children[0];
    const face = svg?.children.find((child) => child.attributes.get("data-view-face") === "front");
    if (face === undefined) throw new Error("front face is missing");
    face.focus();

    gizmo.update(createCamera({ position: [5, 0, 0], target: [0, 0, 0] }));

    expect(face.attributes.get("tabindex")).toBe("-1");
    expect(face.attributes.get("aria-hidden")).toBe("true");
    const activeElement = (globalThis.document as unknown as FakeDocument).activeElement;
    expect(activeElement?.attributes.get("data-rotate")).toBe("left");

    const right = svg?.children.find((child) => child.attributes.get("data-view-face") === "right");
    expect(right?.attributes.get("tabindex")).toBe("0");
    expect(right?.attributes.get("aria-hidden")).toBe("false");
    gizmo.destroy();
  });

  it("maps primary-pointer and keyboard actions, then ignores destroyed controls", () => {
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
    arrow.dispatchEvent("pointerup", {
      button: 0,
      isPrimary: true,
      shiftKey: false,
      ctrlKey: true,
      metaKey: false,
    });
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
    clockwise.dispatchEvent("pointerup", {
      button: 0,
      isPrimary: true,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    });
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
    arrow.dispatchEvent("pointerup", {
      button: 0,
      isPrimary: true,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
    });
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
