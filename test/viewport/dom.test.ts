import { describe, expect, it, vi } from "vitest";
import { installViewportKeyboard } from "../../src/viewport/dom";

interface KeyInput {
  readonly key: string;
  readonly repeat?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly target?: EventTarget | null;
  readonly preventDefault: () => void;
}

class KeyboardTarget {
  private listener: ((event: Event) => void) | undefined;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "keydown") this.listener = listener as (event: Event) => void;
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "keydown" && this.listener === listener) this.listener = undefined;
  }

  dispatchEvent(_event: Event): boolean {
    return false;
  }

  dispatch(input: KeyInput): void {
    this.listener?.(input as unknown as Event);
  }
}

function key(overrides: Partial<KeyInput> = {}): KeyInput {
  return {
    key: "z",
    preventDefault: vi.fn(),
    ...overrides,
  };
}

describe("viewport keyboard ownership", () => {
  it("handles Z only for an explicit host target and removes the listener", () => {
    const target = new KeyboardTarget();
    const fitSelection = vi.fn();
    const remove = installViewportKeyboard(target, fitSelection);
    const lower = key();
    const upper = key({ key: "Z" });
    target.dispatch(lower);
    target.dispatch(upper);

    expect(fitSelection).toHaveBeenCalledTimes(2);
    expect(lower.preventDefault).toHaveBeenCalledOnce();
    expect(upper.preventDefault).toHaveBeenCalledOnce();

    remove();
    target.dispatch(key());
    expect(fitSelection).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: "repeat", repeat: true },
    { name: "control", ctrlKey: true },
    { name: "meta", metaKey: true },
    { name: "alt", altKey: true },
    { name: "input", target: { tagName: "INPUT" } as unknown as EventTarget },
    { name: "textarea", target: { tagName: "TEXTAREA" } as unknown as EventTarget },
    { name: "select", target: { tagName: "SELECT" } as unknown as EventTarget },
    { name: "contenteditable", target: { isContentEditable: true } as unknown as EventTarget },
  ])("ignores $name", (overrides) => {
    const target = new KeyboardTarget();
    const fitSelection = vi.fn();
    installViewportKeyboard(target, fitSelection);
    const event = key(overrides);
    target.dispatch(event);

    expect(fitSelection).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("does not install an implicit global listener", () => {
    const fitSelection = vi.fn();
    expect(installViewportKeyboard(undefined, fitSelection)).toBeTypeOf("function");
    expect(fitSelection).not.toHaveBeenCalled();
  });
});
