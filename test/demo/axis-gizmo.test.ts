import { describe, expect, it } from "vitest";
import { createCamera } from "../../src";
import { updateAxisGizmo } from "../../demo/axis-gizmo";

class FakeSvgElement {
  readonly attributes = new Map<string, string>();
  readonly style = { opacity: "" };

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class FakeGizmo {
  private readonly elements = new Map<string, FakeSvgElement>();

  constructor() {
    for (const axis of ["x", "y", "z"]) {
      for (const direction of ["positive", "negative"]) {
        const id = `${axis}-${direction}`;
        this.elements.set(`[data-axis-line="${id}"]`, new FakeSvgElement());
        this.elements.set(`[data-axis-label="${id}"]`, new FakeSvgElement());
      }
    }
  }

  querySelector(selector: string): FakeSvgElement | null {
    return this.elements.get(selector) ?? null;
  }

  attribute(selector: string, name: string): string | undefined {
    return this.elements.get(selector)?.attributes.get(name);
  }
}

describe("axis gizmo", () => {
  it("shortens an axis that faces the camera while retaining both signed directions", () => {
    const gizmo = new FakeGizmo();
    updateAxisGizmo(
      gizmo as unknown as HTMLElement,
      createCamera({ position: [5, 0, 0], target: [0, 0, 0] }),
    );

    expect(gizmo.attribute('[data-axis-line="x-positive"]', "x2")).toBe("50.00");
    expect(gizmo.attribute('[data-axis-line="x-negative"]', "x2")).toBe("50.00");
    expect(gizmo.attribute('[data-axis-line="y-positive"]', "y2")).not.toBe("50.00");
    expect(gizmo.attribute('[data-axis-line="y-negative"]', "y2")).not.toBe("50.00");
  });
});
