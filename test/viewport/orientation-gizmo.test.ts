import { afterEach, describe, expect, it } from "vitest";
import { createCamera } from "../../src/camera/camera";
import {
  createOrientationGizmo,
  type OrientationGizmoOptions,
} from "../../src/viewport/orientation-gizmo";

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
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
  it("creates one accessible root with a center marker and signed axes", () => {
    installDocument();
    const container = new FakeNode();
    const canvas = new FakeNode();
    container.appendChild(canvas);

    const gizmo = createOrientationGizmo(options(container as unknown as HTMLElement));
    const root = container.children[1];
    expect(root?.className).toBe("femgx-orientation-gizmo");
    expect(root?.attributes.get("data-femgx-orientation-gizmo")).toBe("true");
    expect(root?.attributes.get("aria-label")).toBe("World coordinate orientation");
    expect(root?.children[0]?.children).toHaveLength(13);
    expect(root?.children[0]?.children[0]?.attributes.get("data-center-marker")).toBe("true");
    expect(
      root?.children[0]?.children.slice(1).map((child) => child.attributes.get("data-axis")),
    ).toEqual(["+x", "+x", "-x", "-x", "+y", "+y", "-y", "-y", "+z", "+z", "-z", "-z"]);
    gizmo.destroy();
  });

  it("updates existing axis nodes and restores owned container positioning", () => {
    installDocument();
    const container = new FakeNode();
    const canvas = new FakeNode();
    container.appendChild(canvas);
    const gizmo = createOrientationGizmo(options(container as unknown as HTMLElement));
    const root = container.children[1];
    const line = root?.children[0]?.children[1];
    gizmo.update(createCamera({ position: [5, 0, 0], target: [0, 0, 0] }));
    expect(line?.attributes.get("x2")).toBe("50.00");
    expect(container.style.position).toBe("relative");
    gizmo.destroy();
    gizmo.destroy();
    expect(container.children).toHaveLength(1);
    expect(container.style.position).toBe("");
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
