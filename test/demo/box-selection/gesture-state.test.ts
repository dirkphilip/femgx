import { describe, expect, it, vi } from "vitest";
import {
  FakeOverlay,
  WorkbenchBoxPreview,
  hoveredTarget,
  setTargetSelected,
  setTargetHovered,
  selectedKeys,
  rect,
  harness,
  element,
  nodeHit,
  createInteractionState,
  complete,
} from "./support";
import type {
  BoxSelectionResolver,
  ViewportInteractionBoxEvent,
  BoxSelectionFrustum,
} from "./support";

describe("workbench gesture-state", () => {
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

  it("uses a touch tap as transient hover in mobile Highlight mode", async () => {
    const pick = vi.fn(() => Promise.resolve(nodeHit));
    const { workbench, getInteraction } = harness(pick, undefined, undefined, "element", {
      touchInteractionMode: () => "hover",
    });
    const touch = { pointerType: "touch", clientX: 100, clientY: 100 } as PointerEvent;

    workbench.pointerDown(touch);
    workbench.pointerUp(touch);
    await vi.waitFor(() => {
      expect(hoveredTarget(getInteraction())).toEqual({
        kind: "element",
        partOccurrenceId: "instance-a",
        elementId: 2,
      });
    });
    await workbench.click(touch);

    expect(selectedKeys(getInteraction())).toEqual([]);
  });

  it("exposes workbench-owned point, region, application, and error bindings", async () => {
    const resolver = vi.fn<BoxSelectionResolver>(() => Promise.resolve([element("instance-a", 2)]));
    const pick = vi.fn(() => Promise.resolve(nodeHit));
    const { workbench, getInteraction, render, selectionFeedback } = harness(
      pick,
      undefined,
      createInteractionState(),
      "node",
      { boxSelectionResolver: resolver },
    );
    const bindings = workbench.viewportInteractionOptions();
    const modifiers = { shift: false, control: false, alt: false, meta: false } as const;
    const point = await bindings.resolvePoint?.({
      phase: "click",
      x: 10,
      y: 20,
      granularity: "node",
      modifiers,
      event: {} as MouseEvent,
    });
    expect(point?.kind).toBe("node");

    const event: ViewportInteractionBoxEvent = {
      type: "complete",
      anchor: { x: 20, y: 30 },
      current: { x: 120, y: 90 },
      rect: rect(),
      modifiers,
    };
    const region = await bindings.resolveRegion?.({
      event,
      rect: event.rect,
      granularity: "element",
      frustum: {} as BoxSelectionFrustum,
    });
    expect(region).toEqual([element("instance-a", 2)]);

    const target = element("instance-a", 2);
    const current = getInteraction();
    const next = setTargetSelected(current, target, true);
    await bindings.applyInteraction?.({
      phase: "click",
      granularity: "element",
      current,
      defaultInteraction: next,
      target,
      targets: [target],
      modifiers,
      event: {} as MouseEvent,
    });
    bindings.onError?.(new Error("test failure"), "click");

    expect(selectedKeys(getInteraction())).toEqual(["e:instance-a:2"]);
    expect(render).toHaveBeenCalledOnce();
    expect(selectionFeedback).toHaveBeenLastCalledWith(
      "Viewport click interaction failed: test failure",
    );
  });

  it("keeps the exact resolved hover for inspection and clears it after a box", async () => {
    const pick = vi.fn(() => Promise.resolve(nodeHit));
    const { workbench, canvas, getInteraction, inspectionPanel } = harness(
      pick,
      undefined,
      createInteractionState(),
      "node",
    );
    const bindings = workbench.viewportInteractionOptions();
    const modifiers = { shift: false, control: false, alt: false, meta: false } as const;
    const hoverEvent = {} as PointerEvent;
    const hovered = await bindings.resolvePoint?.({
      phase: "hover",
      x: 10,
      y: 20,
      granularity: "node",
      modifiers,
      event: hoverEvent,
    });
    const current = getInteraction();
    await bindings.applyInteraction?.({
      phase: "hover",
      granularity: "node",
      current,
      defaultInteraction: setTargetHovered(current, hovered),
      target: hovered,
      targets: hovered === undefined ? [] : [hovered],
      modifiers,
      event: hoverEvent,
    });

    expect(inspectionPanel.textContent).toContain("Node 3");
    expect(canvas.dataset).toMatchObject({ hovered: "n:instance-a:3", pick: "n:instance-a:3" });

    const beforeBox = getInteraction();
    const boxEvent = complete();
    if (hovered === undefined) throw new Error("node hover did not resolve");
    await bindings.applyInteraction?.({
      phase: "box",
      granularity: "node",
      current: beforeBox,
      defaultInteraction: setTargetSelected(setTargetHovered(beforeBox, undefined), hovered, true),
      target: undefined,
      targets: [hovered],
      modifiers,
      event: boxEvent,
      frustum: {} as BoxSelectionFrustum,
    });

    expect(hoveredTarget(getInteraction())).toBeUndefined();
    expect(selectedKeys(getInteraction())).toEqual(["n:instance-a:3"]);
    expect(canvas.dataset).toMatchObject({ hovered: "", pick: "" });

    const nextHoverEvent = {} as PointerEvent;
    const nextHover = await bindings.resolvePoint?.({
      phase: "hover",
      x: 10,
      y: 20,
      granularity: "node",
      modifiers,
      event: nextHoverEvent,
    });
    const staleViewportState = createInteractionState();
    await bindings.applyInteraction?.({
      phase: "hover",
      granularity: "node",
      current: staleViewportState,
      defaultInteraction: setTargetHovered(staleViewportState, nextHover),
      target: nextHover,
      targets: nextHover === undefined ? [] : [nextHover],
      modifiers,
      event: nextHoverEvent,
    });

    expect(selectedKeys(getInteraction())).toEqual(["n:instance-a:3"]);
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
});
