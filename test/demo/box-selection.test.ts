import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInteractionState, type FemViewport } from "../../src/index";
import type { DemoView } from "../../demo/workbench/view";
import { WorkbenchBoxPreview } from "../../demo/workbench/box-preview";
import { installWorkbenchBindings } from "../../demo/workbench/listeners";
import { WorkbenchInteraction } from "../../demo/workbench/interaction";
import type { WorkbenchMenu } from "../../demo/workbench/menu";
import type { BoxSelectionRect } from "../../src/index";

class FakeStyle {
  left = "";
  top = "";
  width = "";
  height = "";

  removeProperty(name: string): void {
    this.left = "";
    this.top = "";
    this.width = "";
    this.height = "";
    void name;
  }
}

class FakeOverlay {
  hidden = true;
  readonly style = new FakeStyle();
  /** Mirrors the index.html default; the preview must never flip it. */
  readonly attributes = new Map<string, string>([["aria-hidden", "true"]]);

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class FakeElement {
  private readonly listeners = new Map<string, (event: unknown) => void>();

  getBoundingClientRect(): DOMRect {
    return { left: 0, top: 0, width: 300, height: 200 } as DOMRect;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.set(type, listener as (event: unknown) => void);
  }

  dispatch(type: string, event?: unknown): void {
    this.listeners.get(type)?.(event);
  }
}

const rect = (overrides: Partial<BoxSelectionRect> = {}): BoxSelectionRect => ({
  left: 20,
  top: 30,
  right: 120,
  bottom: 90,
  width: 100,
  height: 60,
  ...overrides,
});

describe("WorkbenchBoxPreview", () => {
  it("stays hidden until a box drag starts", () => {
    const overlay = new FakeOverlay();
    const preview = new WorkbenchBoxPreview(overlay as unknown as HTMLElement);

    expect(overlay.hidden).toBe(true);
    expect(preview.isActive()).toBe(false);
  });

  it("shows the overlay and geometry on start and updates it on change", () => {
    const overlay = new FakeOverlay();
    const preview = new WorkbenchBoxPreview(overlay as unknown as HTMLElement);

    preview.handleEvent({
      type: "start",
      anchor: { x: 20, y: 30 },
      current: { x: 120, y: 90 },
      rect: rect(),
      modifiers: { shift: false, control: false, alt: false, meta: false },
    });
    expect(overlay.hidden).toBe(false);
    expect(overlay.attributes.get("aria-hidden")).toBe("true");
    expect(overlay.style.left).toBe("20px");
    expect(overlay.style.top).toBe("30px");
    expect(overlay.style.width).toBe("100px");
    expect(overlay.style.height).toBe("60px");
    expect(preview.isActive()).toBe(true);

    preview.handleEvent({
      type: "change",
      anchor: { x: 20, y: 30 },
      current: { x: 160, y: 130 },
      rect: rect({ right: 160, bottom: 130, width: 140, height: 100 }),
      modifiers: { shift: false, control: false, alt: false, meta: false },
    });
    expect(overlay.style.width).toBe("140px");
    expect(overlay.style.height).toBe("100px");
    expect(preview.isActive()).toBe(true);
  });

  it("hides and clears the overlay on complete", () => {
    const overlay = new FakeOverlay();
    const preview = new WorkbenchBoxPreview(overlay as unknown as HTMLElement);
    preview.handleEvent({
      type: "start",
      anchor: { x: 20, y: 30 },
      current: { x: 120, y: 90 },
      rect: rect(),
      modifiers: { shift: false, control: false, alt: false, meta: false },
    });

    preview.handleEvent({
      type: "complete",
      anchor: { x: 20, y: 30 },
      current: { x: 120, y: 90 },
      rect: rect(),
      modifiers: { shift: false, control: false, alt: false, meta: false },
    });

    expect(overlay.hidden).toBe(true);
    expect(overlay.attributes.get("aria-hidden")).toBe("true");
    expect(overlay.style.left).toBe("");
    expect(overlay.style.top).toBe("");
    expect(overlay.style.width).toBe("");
    expect(overlay.style.height).toBe("");
    expect(preview.isActive()).toBe(false);
  });

  it("hides and clears the overlay on cancel", () => {
    const overlay = new FakeOverlay();
    const preview = new WorkbenchBoxPreview(overlay as unknown as HTMLElement);
    preview.handleEvent({
      type: "start",
      anchor: { x: 20, y: 30 },
      current: { x: 120, y: 90 },
      rect: rect(),
      modifiers: { shift: false, control: false, alt: false, meta: false },
    });

    preview.handleEvent({ type: "cancel", rect: rect(), reason: "escape" });

    expect(overlay.hidden).toBe(true);
    expect(overlay.style.width).toBe("");
    expect(preview.isActive()).toBe(false);
  });

  it("hides the overlay on dispose", () => {
    const overlay = new FakeOverlay();
    const preview = new WorkbenchBoxPreview(overlay as unknown as HTMLElement);
    preview.handleEvent({
      type: "start",
      anchor: { x: 20, y: 30 },
      current: { x: 120, y: 90 },
      rect: rect(),
      modifiers: { shift: false, control: false, alt: false, meta: false },
    });

    preview.dispose();

    expect(overlay.hidden).toBe(true);
    expect(overlay.style.left).toBe("");
    expect(preview.isActive()).toBe(false);
  });
});

describe("workbench hover suppression", () => {
  const originalWindow = (globalThis as { readonly window?: unknown }).window;
  let windowElement: FakeElement;

  beforeEach(() => {
    windowElement = new FakeElement();
    (globalThis as { window?: unknown }).window = windowElement;
  });

  afterEach(() => {
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = originalWindow;
    vi.clearAllMocks();
  });

  it("skips asynchronous hover while a pointer gesture is active", () => {
    const canvas = new FakeElement();
    const hover = vi.fn(() => Promise.resolve());
    const interaction = {
      hover,
      pointerDown: vi.fn(),
      pointerCancel: vi.fn(),
      click: vi.fn(),
      contextMenu: vi.fn(),
    } as unknown as WorkbenchInteraction;
    const view = {
      projectionToggle: new FakeElement(),
      edgeOverlayToggle: new FakeElement(),
      resultsToggle: new FakeElement(),
      depthTestToggle: new FakeElement(),
      nodeOverlayToggle: new FakeElement(),
      resetButton: new FakeElement(),
      fitView: new FakeElement(),
      modelSelect: new FakeElement(),
      openGlbButton: new FakeElement(),
      glbFileInput: new FakeElement(),
      modelSource: new FakeElement(),
    } as unknown as DemoView;
    let dragging = false;
    installWorkbenchBindings({
      view,
      canvas: canvas as unknown as HTMLCanvasElement,
      signal: new AbortController().signal,
      viewport: () => ({}) as FemViewport,
      interaction,
      menu: { hide: vi.fn() } as unknown as WorkbenchMenu,
      dragging: () => dragging,
      setEdges: () => undefined,
      setNodes: () => undefined,
      setResults: () => undefined,
      reset: () => undefined,
      fitView: () => undefined,
      fitSelection: () => undefined,
      setModel: () => undefined,
      openGlb: () => undefined,
    });

    const move = { clientX: 50, clientY: 50 } as PointerEvent;
    canvas.dispatch("pointermove", move);
    expect(hover).toHaveBeenCalledTimes(1);

    dragging = true;
    canvas.dispatch("pointermove", move);
    expect(hover).toHaveBeenCalledTimes(1);

    dragging = false;
    canvas.dispatch("pointermove", move);
    expect(hover).toHaveBeenCalledTimes(2);
  });
});

describe("workbench click selection", () => {
  function harness(pick = vi.fn(() => Promise.resolve(undefined))) {
    const canvas = new FakeElement();
    let interaction = createInteractionState();
    const render = vi.fn();
    const inspectionPanel = { textContent: "" };
    const workbench = new WorkbenchInteraction({
      canvas: canvas as unknown as HTMLCanvasElement,
      view: { inspectionPanel: inspectionPanel as unknown as HTMLElement },
      viewport: () => ({ pick }) as unknown as FemViewport,
      getInteraction: () => interaction,
      setInteraction: (next) => {
        interaction = next;
      },
      partName: () => undefined,
      menu: { hide: vi.fn() } as unknown as WorkbenchMenu,
      render,
    });
    return { workbench, pick, render, getInteraction: () => interaction };
  }

  it("does not select or mutate inspection for a drag beyond the threshold", async () => {
    const { workbench, pick, render } = harness();
    workbench.pointerDown({ clientX: 100, clientY: 100 } as PointerEvent);
    await workbench.click({ clientX: 120, clientY: 110 } as MouseEvent);

    expect(pick).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it("keeps an ordinary click reaching the selection path", async () => {
    const { workbench, pick, render } = harness();
    workbench.pointerDown({ clientX: 100, clientY: 100 } as PointerEvent);
    await workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);

    expect(pick).toHaveBeenCalledOnce();
    // An empty pick clears selection and refreshes the inspection panel.
    expect(render).toHaveBeenCalledOnce();
  });

  it("keeps overlapping picks independent and skips stale results", async () => {
    let resolveFirst: ((value: undefined) => void) | undefined;
    let resolveSecond: ((value: undefined) => void) | undefined;
    const first = new Promise<undefined>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<undefined>((resolve) => {
      resolveSecond = resolve;
    });
    const pick = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const { workbench } = harness(pick);

    const firstClick = workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);
    const secondClick = workbench.click({ clientX: 110, clientY: 110 } as MouseEvent);
    await vi.waitFor(() => {
      expect(pick).toHaveBeenCalledTimes(2);
    });

    resolveFirst?.(undefined);
    resolveSecond?.(undefined);
    await firstClick;
    await secondClick;
  });

  it("ignores an in-flight pick rejected after destruction", async () => {
    let rejectPick: ((reason?: unknown) => void) | undefined;
    const pick = vi.fn(
      () =>
        new Promise<undefined>((_resolve, reject) => {
          rejectPick = reject;
        }),
    );
    const { workbench } = harness(pick);

    const click = workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);
    await vi.waitFor(() => {
      expect(pick).toHaveBeenCalledOnce();
    });
    workbench.destroy();
    rejectPick?.(new Error("viewport destroyed"));

    await expect(click).resolves.toBeUndefined();
  });
});
