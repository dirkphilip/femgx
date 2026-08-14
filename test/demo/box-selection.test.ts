import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInteractionState,
  hoveredTarget,
  isTargetHighlighted,
  isTargetSelected,
  setTargetHighlighted,
  setTargetSelected,
  setTargetHovered,
  type BoxSelectionModifiers,
  type BoxSelectionEvent,
  type FemViewport,
  type InteractionTarget,
  type PickHit,
} from "../../src/index";
import type { DemoView } from "../../demo/workbench/view";
import { WorkbenchBoxPreview } from "../../demo/workbench/box-preview";
import { installWorkbenchBindings } from "../../demo/workbench/listeners";
import { WorkbenchInteraction } from "../../demo/workbench/interaction";
import type { BoxSelectionResolver } from "../../demo/workbench/box-selection-resolver";
import { selectedKeys } from "../../demo/workbench/selection";
import type { SelectionGranularity } from "../../demo/workbench/pick";
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
  value = "";
  readonly dataset: Record<string, string> = {};
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
      primaryPane: {
        id: "primary",
        scene: canvas as unknown as HTMLElement,
        canvas: canvas as unknown as HTMLCanvasElement,
        boxSelectionOverlay: new FakeElement() as unknown as HTMLElement,
      },
      projectionToggle: new FakeElement(),
      edgeOverlayToggle: new FakeElement(),
      continuousToggle: new FakeElement(),
      resultControls: new FakeElement(),
      resultField: new FakeElement(),
      deformationField: new FakeElement(),
      deformationScale: new FakeElement(),
      vectorField: new FakeElement(),
      vectorGlyph: new FakeElement(),
      vectorTransform: new FakeElement(),
      vectorLengthScale: new FakeElement(),
      vectorHelp: new FakeElement(),
      resultLegend: new FakeElement(),
      sectionControls: new FakeElement(),
      sectionAxis: new FakeElement(),
      sectionOffset: new FakeElement(),
      sectionOffsetValue: new FakeElement(),
      depthTestToggle: new FakeElement(),
      nodeOverlayToggle: new FakeElement(),
      resetButton: new FakeElement(),
      fitView: new FakeElement(),
      selectionGranularity: new FakeElement(),
      interactionHelp: new FakeElement(),
      hideSelectedButton: new FakeElement(),
      showAllButton: new FakeElement(),
      modelSelect: new FakeElement(),
      openModelButton: new FakeElement(),
      modelSource: new FakeElement(),
    } as unknown as DemoView;
    let dragging = false;
    installWorkbenchBindings({
      view,
      signal: new AbortController().signal,
      interaction,
      dragging: () => dragging,
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
  function harness(
    pick: ReturnType<typeof vi.fn> = vi.fn(() => Promise.resolve(undefined)),
    pickRegion = vi.fn(() => Promise.resolve([] as readonly InteractionTarget[])),
    initialInteraction = createInteractionState(),
    selectionGranularity: SelectionGranularity = "element",
    boxSelectionResolver?: BoxSelectionResolver,
  ) {
    const canvas = new FakeElement();
    let interaction = initialInteraction;
    const render = vi.fn();
    const selectionFeedback = vi.fn();
    const inspectionPanel = { textContent: "" };
    const workbench = new WorkbenchInteraction({
      canvas: canvas as unknown as HTMLCanvasElement,
      setInspection: (text) => {
        inspectionPanel.textContent = text;
      },
      viewport: () => ({ pick, pickRegion }) as unknown as FemViewport,
      getInteraction: () => interaction,
      setInteraction: (next) => {
        interaction = next;
      },
      partName: () => undefined,
      menu: { hide: vi.fn() } as unknown as WorkbenchMenu,
      render,
      selectionGranularity: () => selectionGranularity,
      ...(boxSelectionResolver === undefined ? {} : { boxSelectionResolver }),
      selectionFeedback,
    });
    return {
      workbench,
      pick,
      pickRegion,
      render,
      selectionFeedback,
      inspectionPanel,
      getInteraction: () => interaction,
    };
  }

  const element = (instanceId: string, elementId: number): InteractionTarget => ({
    kind: "element",
    instanceId,
    elementId,
  });

  const nodeHit: PickHit = {
    kind: "node",
    partId: 1,
    instanceId: "instance-a",
    elementId: 2,
    nodeId: 3,
    localPosition: [0, 0, 0],
    worldPosition: [0, 0, 0],
    neighborElementIds: [2],
    neighborNodeIds: [4],
  };

  const faceHit: PickHit = {
    kind: "face",
    partId: 1,
    instanceId: "instance-a",
    elementId: 2,
    faceIndex: 1,
    key: "1:0:1:2",
    nodeIds: [1, 2, 3],
    worldPosition: [0, 0, 0],
    normal: [0, 0, 1],
    neighborElementIds: [],
  };

  const complete = (
    modifiers: Partial<BoxSelectionModifiers> = {},
  ): BoxSelectionEvent & { readonly type: "complete" } => ({
    type: "complete",
    anchor: { x: 20, y: 30 },
    current: { x: 120, y: 90 },
    rect: rect(),
    modifiers: {
      shift: false,
      control: false,
      alt: false,
      meta: false,
      ...modifiers,
    },
  });

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

  it("selects an owning element while keeping the exact pick in inspection", async () => {
    const pick = vi.fn(() => Promise.resolve(nodeHit));
    const { workbench, getInteraction, inspectionPanel } = harness(pick);

    await workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);

    expect(selectedKeys(getInteraction())).toEqual(["e:instance-a:2"]);
    expect(inspectionPanel.textContent).toContain("Node 3");
  });

  it("keeps a modified empty click from clearing element selection", async () => {
    const selected = element("instance-a", 2);
    const initial = setTargetSelected(createInteractionState(), selected, true);
    const { workbench, getInteraction } = harness(undefined, undefined, initial);

    await workbench.click({ clientX: 100, clientY: 100, ctrlKey: true } as MouseEvent);

    expect(selectedKeys(getInteraction())).toEqual(["e:instance-a:2"]);
  });

  it("selects an exact node in Node granularity", async () => {
    const pick = vi.fn(() => Promise.resolve(nodeHit));
    const { workbench, getInteraction } = harness(
      pick,
      undefined,
      createInteractionState(),
      "node",
    );

    await workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);

    expect(selectedKeys(getInteraction())).toEqual(["n:instance-a:3"]);
  });

  it("selects the immediately hovered target without a second GPU readback", async () => {
    const pick = vi.fn(() => Promise.resolve(nodeHit));
    const { workbench, getInteraction } = harness(
      pick,
      undefined,
      createInteractionState(),
      "node",
    );
    const event = { clientX: 100, clientY: 100 } as PointerEvent;

    await workbench.hover(event);
    await workbench.click(event);

    expect(selectedKeys(getInteraction())).toEqual(["n:instance-a:3"]);
    expect(pick).toHaveBeenCalledOnce();
  });

  it("promotes a cached face hit to its element when shift-clicked", async () => {
    const pick = vi.fn(() => Promise.resolve(faceHit));
    const { workbench, getInteraction } = harness(
      pick,
      undefined,
      createInteractionState(),
      "face",
    );
    const event = { clientX: 100, clientY: 100 } as PointerEvent;

    await workbench.hover(event);
    await workbench.click(event);
    await workbench.click({ clientX: 100, clientY: 100, shiftKey: true } as MouseEvent);

    expect(selectedKeys(getInteraction())).toEqual(["e:instance-a:2"]);
    expect(pick).toHaveBeenCalledOnce();
  });

  it("selects a touch target on pointer-up and ignores its synthetic click", async () => {
    const pick = vi.fn(() => Promise.resolve(nodeHit));
    const { workbench, getInteraction } = harness(
      pick,
      undefined,
      createInteractionState(),
      "node",
    );
    const touch = { clientX: 100, clientY: 100, pointerType: "touch" } as PointerEvent;

    workbench.pointerDown(touch);
    workbench.pointerUp(touch);
    await vi.waitFor(() => {
      expect(selectedKeys(getInteraction())).toEqual(["n:instance-a:3"]);
    });
    await workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);

    expect(selectedKeys(getInteraction())).toEqual(["n:instance-a:3"]);
    expect(pick).toHaveBeenCalledOnce();
  });

  it("clears a stale node hover when a plain click selects another node", async () => {
    const staleHover = { kind: "node", instanceId: "instance-b", nodeId: 8 } as const;
    const pick = vi.fn(() => Promise.resolve(nodeHit));
    const { workbench, getInteraction } = harness(
      pick,
      undefined,
      setTargetHovered(createInteractionState(), staleHover),
      "node",
    );

    await workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);

    expect(selectedKeys(getInteraction())).toEqual(["n:instance-a:3"]);
    expect(hoveredTarget(getInteraction())).toBeUndefined();
  });

  it("keeps a face hit from becoming a node selection", async () => {
    const staleHover = { kind: "node", instanceId: "instance-b", nodeId: 8 } as const;
    const pick = vi.fn(() => Promise.resolve(faceHit));
    const { workbench, getInteraction, inspectionPanel } = harness(
      pick,
      undefined,
      setTargetHovered(createInteractionState(), staleHover),
      "node",
    );

    await workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);

    expect(selectedKeys(getInteraction())).toEqual([]);
    expect(hoveredTarget(getInteraction())).toBeUndefined();
    expect(inspectionPanel.textContent).toContain("Face");
  });

  it("clears transient hover without changing selection or highlights", () => {
    const selected = element("instance-a", 2);
    const initial = setTargetHovered(
      setTargetHighlighted(
        setTargetSelected(createInteractionState(), selected, true),
        selected,
        true,
      ),
      selected,
    );
    const { workbench, getInteraction, render } = harness(undefined, undefined, initial);

    workbench.clearHover();

    expect(hoveredTarget(getInteraction())).toBeUndefined();
    expect(isTargetSelected(getInteraction(), selected)).toBe(true);
    expect(isTargetHighlighted(getInteraction(), selected)).toBe(true);
    expect(render).not.toHaveBeenCalled();
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

  it("replaces selection with distinct visible elements in one render", async () => {
    const first = element("instance-a", 2);
    const second = element("instance-b", 1);
    const initial = setTargetSelected(createInteractionState(), element("old", 9), true);
    const pickRegion = vi.fn(() => Promise.resolve([first, second, first]));
    const { workbench, render, selectionFeedback, getInteraction } = harness(
      undefined,
      pickRegion,
      initial,
    );

    await workbench.selectBox(complete({ shift: true, alt: true }));

    expect(pickRegion).toHaveBeenCalledOnce();
    expect(pickRegion).toHaveBeenCalledWith(rect(), "element");
    expect(selectedKeys(getInteraction())).toEqual(["e:instance-a:2", "e:instance-b:1"]);
    expect(selectionFeedback).toHaveBeenLastCalledWith("Box selection: 2 FE elements");
    expect(render).toHaveBeenCalledOnce();
  });

  it("does not let the click synthesized after a box drag invalidate its readback", async () => {
    const target = element("instance-a", 2);
    let resolveRegion: ((targets: readonly InteractionTarget[]) => void) | undefined;
    const result = new Promise<readonly InteractionTarget[]>((resolve) => {
      resolveRegion = resolve;
    });
    const { workbench, getInteraction } = harness(
      undefined,
      vi.fn(() => result),
    );
    workbench.pointerDown({ clientX: 10, clientY: 10, pointerType: "mouse" } as PointerEvent);

    const box = workbench.selectBox(complete());
    workbench.pointerCancel();
    await workbench.click({ clientX: 80, clientY: 80 } as MouseEvent);
    resolveRegion?.([target]);
    await box;

    expect(selectedKeys(getInteraction())).toEqual(["e:instance-a:2"]);
  });

  it("allows a custom resolver to replace visible-region discovery", async () => {
    const target = { kind: "face", instanceId: "instance-a", elementId: 2, faceIndex: 1 } as const;
    const pickRegion = vi.fn(() => Promise.resolve([] as readonly InteractionTarget[]));
    const resolver = vi.fn<BoxSelectionResolver>((request) => {
      expect(request.event).toEqual(complete());
      expect(request.granularity).toBe("face");
      return Promise.resolve([target]);
    });
    const { workbench, getInteraction, render } = harness(
      undefined,
      pickRegion,
      createInteractionState(),
      "face",
      resolver,
    );

    await workbench.selectBox(complete());

    expect(resolver).toHaveBeenCalledOnce();
    expect(pickRegion).not.toHaveBeenCalled();
    expect(selectedKeys(getInteraction())).toEqual(["f:instance-a:2:1"]);
    expect(render).toHaveBeenCalledOnce();
  });

  it("rejects custom targets that do not match the captured granularity", async () => {
    const resolver = vi.fn<BoxSelectionResolver>(() =>
      Promise.resolve([{ kind: "element", instanceId: "instance-a", elementId: 2 }]),
    );
    const { workbench, getInteraction, render, selectionFeedback } = harness(
      undefined,
      undefined,
      createInteractionState(),
      "face",
      resolver,
    );

    await workbench.selectBox(complete());

    expect(selectedKeys(getInteraction())).toEqual([]);
    expect(render).not.toHaveBeenCalled();
    expect(selectionFeedback).toHaveBeenCalledWith(
      "Box selection failed: Box selection resolver returned element target; expected face target",
    );
  });

  it("invalidates an in-flight result when the resolver changes", async () => {
    let resolveOld: ((targets: readonly InteractionTarget[]) => void) | undefined;
    const oldResult = new Promise<readonly InteractionTarget[]>((resolve) => {
      resolveOld = resolve;
    });
    const oldResolver = vi.fn<BoxSelectionResolver>(() => oldResult);
    const current = { kind: "element", instanceId: "current", elementId: 3 } as const;
    const newResolver = vi.fn<BoxSelectionResolver>(() => Promise.resolve([current]));
    const { workbench, getInteraction } = harness(
      undefined,
      undefined,
      createInteractionState(),
      "element",
      oldResolver,
    );

    const oldBox = workbench.selectBox(complete());
    await vi.waitFor(() => {
      expect(oldResolver).toHaveBeenCalledOnce();
    });
    workbench.setBoxSelectionResolver(newResolver);
    const currentBox = workbench.selectBox(complete());
    resolveOld?.([{ kind: "element", instanceId: "stale", elementId: 1 }]);
    await Promise.all([oldBox, currentBox]);

    expect(newResolver).toHaveBeenCalledOnce();
    expect(selectedKeys(getInteraction())).toEqual(["e:current:3"]);
  });

  it.each([
    ["face", { kind: "face", instanceId: "instance-a", elementId: 2, faceIndex: 1 }],
    ["node", { kind: "node", instanceId: "instance-a", nodeId: 3 }],
  ] as const)("box selection uses %s targets", async (granularity, target) => {
    const pickRegion = vi.fn(() => Promise.resolve([target, target] as const));
    const { workbench, render, selectionFeedback, getInteraction } = harness(
      undefined,
      pickRegion,
      createInteractionState(),
      granularity,
    );

    await workbench.selectBox(complete());

    expect(pickRegion).toHaveBeenCalledWith(rect(), granularity);
    expect(selectedKeys(getInteraction())).toEqual([
      granularity === "face" ? "f:instance-a:2:1" : "n:instance-a:3",
    ]);
    expect(selectionFeedback).toHaveBeenLastCalledWith(`Box selection: 1 ${granularity}`);
    expect(render).toHaveBeenCalledOnce();
  });

  it("toggles distinct visible elements for Control or Meta without changing other selection", async () => {
    const first = element("instance-a", 2);
    const second = element("instance-b", 1);
    const initial = setTargetSelected(createInteractionState(), first, true);
    const pickRegion = vi.fn(() => Promise.resolve([first, second, second]));
    const { workbench, render, getInteraction } = harness(undefined, pickRegion, initial);

    await workbench.selectBox(complete({ control: true }));

    expect(selectedKeys(getInteraction())).toEqual(["e:instance-b:1"]);
    expect(isTargetSelected(getInteraction(), first)).toBe(false);
    expect(render).toHaveBeenCalledOnce();
  });

  it("clears on an empty plain box and leaves Control or Meta empty boxes alone", async () => {
    const selected = element("instance-a", 2);
    const initial = setTargetSelected(createInteractionState(), selected, true);
    const pickRegion = vi.fn(() => Promise.resolve([] as readonly InteractionTarget[]));
    const { workbench, render, getInteraction } = harness(undefined, pickRegion, initial);

    await workbench.selectBox(complete());
    expect(selectedKeys(getInteraction())).toEqual([]);
    expect(render).toHaveBeenCalledOnce();

    render.mockClear();
    const preserved = getInteraction();
    await workbench.selectBox(complete({ meta: true }));
    expect(getInteraction()).toBe(preserved);
    expect(render).not.toHaveBeenCalled();
  });

  it("coalesces region work to one active query and the newest queued drag", async () => {
    let resolveFirst: ((targets: readonly InteractionTarget[]) => void) | undefined;
    let resolveSecond: ((targets: readonly InteractionTarget[]) => void) | undefined;
    const first = new Promise<readonly InteractionTarget[]>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<readonly InteractionTarget[]>((resolve) => {
      resolveSecond = resolve;
    });
    const pickRegion = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const { workbench, render, getInteraction } = harness(undefined, pickRegion);

    const firstBox = workbench.selectBox(complete());
    await vi.waitFor(() => {
      expect(pickRegion).toHaveBeenCalledOnce();
    });
    const secondBox = workbench.selectBox(complete({ control: true }));
    const thirdBox = workbench.selectBox(complete({ meta: true }));
    expect(pickRegion).toHaveBeenCalledOnce();
    resolveFirst?.([element("stale", 1)]);
    await vi.waitFor(() => {
      expect(pickRegion).toHaveBeenCalledTimes(2);
    });
    resolveSecond?.([element("current", 3)]);
    await Promise.all([firstBox, secondBox, thirdBox]);

    expect(selectedKeys(getInteraction())).toEqual(["e:current:3"]);
    expect(render).toHaveBeenCalledOnce();
  });

  it("ignores a rejected region query and a result invalidated by a newer click", async () => {
    const rejected = vi.fn(() => Promise.reject(new Error("region failed")));
    const rejectedHarness = harness(undefined, rejected);
    await expect(rejectedHarness.workbench.selectBox(complete())).resolves.toBeUndefined();
    expect(selectedKeys(rejectedHarness.getInteraction())).toEqual([]);
    expect(rejectedHarness.render).not.toHaveBeenCalled();
    expect(rejectedHarness.selectionFeedback).toHaveBeenCalledWith(
      "Box selection failed: GPU pick readback could not be completed",
    );

    let resolveRegion: ((targets: readonly InteractionTarget[]) => void) | undefined;
    const pendingRegion = new Promise<readonly InteractionTarget[]>((resolve) => {
      resolveRegion = resolve;
    });
    const pickRegion = vi.fn(() => pendingRegion);
    const clickPick = vi.fn(() => Promise.resolve(undefined));
    const currentHarness = harness(clickPick, pickRegion);
    const box = currentHarness.workbench.selectBox(complete());
    await vi.waitFor(() => {
      expect(pickRegion).toHaveBeenCalledOnce();
    });
    await currentHarness.workbench.click({ clientX: 100, clientY: 100 } as MouseEvent);
    resolveRegion?.([element("stale", 1)]);
    await box;

    expect(selectedKeys(currentHarness.getInteraction())).toEqual([]);
    expect(currentHarness.selectionFeedback).not.toHaveBeenCalled();
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
