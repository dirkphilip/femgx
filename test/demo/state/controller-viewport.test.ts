import { describe, expect, it, vi, type Mock } from "vitest";
import { setControllerViewport } from "../../../demo/workbench/controllers/controller-viewport";
import { applyActiveStateForOwner } from "../../../demo/workbench/controllers/controller-display";
import type { WorkbenchViewportOwner } from "../../../demo/workbench/controllers/controller-viewport";
import type { WorkbenchModel } from "../../../demo/workbench/models/model";
import { WorkbenchViewportSlots } from "../../../demo/workbench/viewport/viewport-slots";
import type { WorkbenchPane, ViewportSlotId } from "../../../demo/workbench/viewport/view";
import type { WorkbenchInteraction } from "../../../demo/workbench/interaction/interaction";
import type { WorkbenchBoxPreview } from "../../../demo/workbench/selection/box-preview";
import type { WorkbenchMenu } from "../../../demo/workbench/interaction/menu";
import { type Viewport, type ViewportBackground } from "../../../src/entries/root";
import { createInteractionState } from "../../../src/entries/interaction";

vi.mock("../../../demo/workbench/lifecycle", () => ({
  installWorkbenchPaneLifecycle: vi.fn(() => vi.fn()),
}));

describe("workbench viewport lifecycle ownership", () => {
  it("applies the replacement viewport state once", () => {
    const oldViewport = viewport();
    const nextViewport = viewport();
    const fixture = replacementOwner(oldViewport.viewport);
    const { owner, applyResultMode, applyCurrentDisplayState, rebuildVisibility, render } = fixture;
    const activeState = (): void => {
      applyActiveStateForOwner(owner);
    };
    owner.viewportSlots.setPrimaryViewport = vi.fn((next: Viewport) => {
      owner.activeSlot().viewport = next;
      activeState();
      rebuildVisibility();
    });

    setControllerViewport(owner, nextViewport.viewport);

    expect(applyResultMode).toHaveBeenCalledOnce();
    expect(applyCurrentDisplayState).toHaveBeenCalledOnce();
    expect(nextViewport.setBackground).toHaveBeenCalledOnce();
    expect(rebuildVisibility).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
    const [resultCall = 0] = applyResultMode.mock.invocationCallOrder;
    const [displayCall = 0] = applyCurrentDisplayState.mock.invocationCallOrder;
    const [rebuildCall = 0] = rebuildVisibility.mock.invocationCallOrder;
    const [renderCall = 0] = render.mock.invocationCallOrder;
    expect(resultCall).toBeLessThan(displayCall);
    expect(displayCall).toBeLessThan(rebuildCall);
    expect(rebuildCall).toBeLessThan(renderCall);
  });

  it("reports a replacement background failure and completes recovery", () => {
    const fixture = replacementOwner(viewport().viewport);
    const { owner, setEnabled, setFeedback, render, rebuildVisibility } = fixture;
    const nextViewport = viewport();
    nextViewport.setBackground.mockImplementation(() => {
      throw new Error("background failed");
    });
    owner.viewportSlots.setPrimaryViewport = vi.fn((next: Viewport) => {
      owner.activeSlot().viewport = next;
      applyActiveStateForOwner(owner);
      rebuildVisibility();
    });

    let thrown: unknown;
    try {
      setControllerViewport(owner, nextViewport.viewport);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeUndefined();
    expect(setFeedback).toHaveBeenCalledWith(
      "Background could not be restored: background failed",
      "error",
    );
    expect(setEnabled).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
  });

  it("does not reapply active state or publish the secondary opening twice", async () => {
    const primaryViewport = viewport();
    const secondaryViewport = viewport();
    const applyActiveState = vi.fn();
    const rebuildVisibility = vi.fn();
    const render = vi.fn();
    const slots = new WorkbenchViewportSlots({
      view: { primaryPane: pane("primary"), secondaryPane: pane("secondary") },
      primaryViewport: primaryViewport.viewport,
      primaryInteraction: {} as WorkbenchInteraction,
      primaryBoxPreview: {} as WorkbenchBoxPreview,
      createViewport: vi.fn(() => Promise.resolve(secondaryViewport.viewport)),
      getModel: () => ({ partNames: new Map() }) as unknown as WorkbenchModel,
      getInteraction: () => createInteractionState(),
      setInteraction: vi.fn(),
      canClearCanvasHover: () => true,
      markCanvasHover: vi.fn(),
      clearCanvasHover: vi.fn(),
      selectionGranularity: () => "element",
      touchInteractionMode: () => "navigate",
      menu: {} as WorkbenchMenu,
      render,
      applyActiveState,
      applyState: vi.fn(),
      cloneShowState: vi.fn(),
      removeShowState: vi.fn(),
      rebuildVisibility,
      feedback: vi.fn(),
      setInspection: vi.fn(),
      selectionFeedback: vi.fn(),
      onActiveSlotChanged: () => {
        applyActiveState();
        rebuildVisibility();
      },
    });

    await slots.toggleSecondaryViewport();

    expect(applyActiveState).toHaveBeenCalledOnce();
    expect(rebuildVisibility).toHaveBeenCalledOnce();
    expect(secondaryViewport.render).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("clears secondary opening after a late open failure", async () => {
    const primaryViewport = viewport();
    const failedSecondaryViewport = viewport();
    const recoveredSecondaryViewport = viewport();
    failedSecondaryViewport.render.mockImplementationOnce(() => {
      throw new Error("secondary render failed");
    });
    const createViewport = vi
      .fn()
      .mockResolvedValueOnce(failedSecondaryViewport.viewport)
      .mockResolvedValueOnce(recoveredSecondaryViewport.viewport);
    const render = vi.fn();
    const slots = new WorkbenchViewportSlots({
      view: { primaryPane: pane("primary"), secondaryPane: pane("secondary") },
      primaryViewport: primaryViewport.viewport,
      primaryInteraction: {} as WorkbenchInteraction,
      primaryBoxPreview: {} as WorkbenchBoxPreview,
      createViewport,
      getModel: () => ({ partNames: new Map() }) as unknown as WorkbenchModel,
      getInteraction: () => createInteractionState(),
      setInteraction: vi.fn(),
      canClearCanvasHover: () => true,
      markCanvasHover: vi.fn(),
      clearCanvasHover: vi.fn(),
      selectionGranularity: () => "element",
      touchInteractionMode: () => "navigate",
      menu: { hide: vi.fn() } as unknown as WorkbenchMenu,
      render,
      applyActiveState: vi.fn(),
      applyState: vi.fn(),
      cloneShowState: vi.fn(),
      removeShowState: vi.fn(),
      rebuildVisibility: vi.fn(),
      feedback: vi.fn(),
      setInspection: vi.fn(),
      selectionFeedback: vi.fn(),
      onActiveSlotChanged: vi.fn(),
    });

    await slots.toggleSecondaryViewport();

    expect(slots.isSecondaryVisible()).toBe(false);
    expect(slots.isSecondaryOpening()).toBe(false);
    expect(failedSecondaryViewport.viewport.destroy).toHaveBeenCalledOnce();

    await slots.toggleSecondaryViewport();

    expect(createViewport).toHaveBeenCalledTimes(2);
    expect(slots.isSecondaryVisible()).toBe(true);
    expect(slots.isSecondaryOpening()).toBe(false);
    expect(recoveredSecondaryViewport.render).toHaveBeenCalledOnce();
  });

  it("invalidates a pending secondary creation during teardown", async () => {
    const primaryViewport = viewport();
    const pendingSecondaryViewport = viewport();
    let resolveCreate!: (value: Viewport) => void;
    const createViewport = vi.fn(
      () =>
        new Promise<Viewport>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const slots = new WorkbenchViewportSlots({
      view: { primaryPane: pane("primary"), secondaryPane: pane("secondary") },
      primaryViewport: primaryViewport.viewport,
      primaryInteraction: { destroy: vi.fn() } as unknown as WorkbenchInteraction,
      primaryBoxPreview: { dispose: vi.fn() } as unknown as WorkbenchBoxPreview,
      createViewport,
      getModel: () => ({ partNames: new Map() }) as unknown as WorkbenchModel,
      getInteraction: () => createInteractionState(),
      setInteraction: vi.fn(),
      canClearCanvasHover: () => true,
      markCanvasHover: vi.fn(),
      clearCanvasHover: vi.fn(),
      selectionGranularity: () => "element",
      touchInteractionMode: () => "navigate",
      menu: {} as WorkbenchMenu,
      render: vi.fn(),
      applyActiveState: vi.fn(),
      applyState: vi.fn(),
      cloneShowState: vi.fn(),
      removeShowState: vi.fn(),
      rebuildVisibility: vi.fn(),
      feedback: vi.fn(),
      setInspection: vi.fn(),
      selectionFeedback: vi.fn(),
      onActiveSlotChanged: vi.fn(),
    });
    const opening = slots.toggleSecondaryViewport();
    await Promise.resolve();

    slots.destroy();
    expect(slots.isSecondaryOpening()).toBe(false);

    resolveCreate(pendingSecondaryViewport.viewport);
    await opening;

    expect(pendingSecondaryViewport.viewport.destroy).toHaveBeenCalledOnce();
    expect(slots.get("secondary")).toBeUndefined();
    expect(slots.isSecondaryVisible()).toBe(false);
  });

  it("does not let a stale rejection clean up a retried secondary", async () => {
    const primaryViewport = viewport();
    const retriedSecondaryViewport = viewport();
    let rejectCreate!: (reason: unknown) => void;
    const createViewport = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Viewport>((_, reject) => {
            rejectCreate = reject;
          }),
      )
      .mockResolvedValueOnce(retriedSecondaryViewport.viewport);
    const removeShowState = vi.fn();
    const slots = new WorkbenchViewportSlots({
      view: { primaryPane: pane("primary"), secondaryPane: pane("secondary") },
      primaryViewport: primaryViewport.viewport,
      primaryInteraction: { destroy: vi.fn() } as unknown as WorkbenchInteraction,
      primaryBoxPreview: { dispose: vi.fn() } as unknown as WorkbenchBoxPreview,
      createViewport,
      getModel: () => ({ partNames: new Map() }) as unknown as WorkbenchModel,
      getInteraction: () => createInteractionState(),
      setInteraction: vi.fn(),
      canClearCanvasHover: () => true,
      markCanvasHover: vi.fn(),
      clearCanvasHover: vi.fn(),
      selectionGranularity: () => "element",
      touchInteractionMode: () => "navigate",
      menu: { hide: vi.fn() } as unknown as WorkbenchMenu,
      render: vi.fn(),
      applyActiveState: vi.fn(),
      applyState: vi.fn(),
      cloneShowState: vi.fn(),
      removeShowState,
      rebuildVisibility: vi.fn(),
      feedback: vi.fn(),
      setInspection: vi.fn(),
      selectionFeedback: vi.fn(),
      onActiveSlotChanged: vi.fn(),
    });
    const opening = slots.toggleSecondaryViewport();
    await Promise.resolve();

    slots.handleSecondaryViewportError(new Error("early secondary error"));
    expect(slots.isSecondaryOpening()).toBe(false);
    expect(removeShowState).toHaveBeenCalledOnce();

    const retry = slots.toggleSecondaryViewport();
    await retry;
    expect(slots.get("secondary")?.viewport).toBe(retriedSecondaryViewport.viewport);

    rejectCreate(new Error("stale secondary rejection"));
    await opening;

    expect(slots.get("secondary")?.viewport).toBe(retriedSecondaryViewport.viewport);
    expect(retriedSecondaryViewport.viewport.destroy).not.toHaveBeenCalled();
    expect(removeShowState).toHaveBeenCalledOnce();
  });
});

type ReplacementOwner = WorkbenchViewportOwner & Parameters<typeof applyActiveStateForOwner>[0];

type MockFunction = Mock<() => void>;

interface ReplacementFixture {
  readonly owner: ReplacementOwner;
  readonly applyResultMode: MockFunction;
  readonly applyCurrentDisplayState: MockFunction;
  readonly rebuildVisibility: MockFunction;
  readonly render: MockFunction;
  readonly setFeedback: MockFunction;
  readonly setEnabled: MockFunction;
}

function replacementOwner(oldViewport: Viewport): ReplacementFixture {
  const applyResultMode = vi.fn();
  const applyCurrentDisplayState = vi.fn();
  const rebuildVisibility = vi.fn();
  const render = vi.fn();
  const setFeedback = vi.fn();
  const setEnabled = vi.fn();
  const primarySlot = {
    id: "primary" as const,
    viewport: oldViewport,
    renderLoop: { setEnabled },
  };
  const presentation = {
    reflectSectionPlane: vi.fn(),
    reflectResults: vi.fn(),
    setFeedback,
  };
  const owner = {
    disposed: false,
    viewport: oldViewport,
    viewportSlots: {
      activeSlot: () => primarySlot,
      activeViewport: () => primarySlot.viewport,
      setPrimaryViewport: vi.fn(),
      invalidateInteraction: vi.fn(),
    },
    activeSlot: () => primarySlot,
    activeViewport: () => primarySlot.viewport,
    model: { bounds: { min: [0, 0, 0], max: [1, 1, 1] } } as unknown as WorkbenchModel,
    presentation,
    background: "studio" as ViewportBackground,
    sectionAxis: "off" as const,
    sectionOffset: 0,
    applyResultMode,
    applyCurrentDisplayState,
    visibilityPanel: { rebuild: rebuildVisibility },
    resetHoverOwner: vi.fn(),
    render,
  } as unknown as ReplacementOwner;
  return {
    owner,
    applyResultMode,
    applyCurrentDisplayState,
    rebuildVisibility,
    render,
    setFeedback,
    setEnabled,
  };
}

function pane(id: ViewportSlotId): WorkbenchPane {
  return {
    id,
    scene: { dataset: {} } as unknown as HTMLElement,
    canvas: { dataset: {} } as unknown as HTMLCanvasElement,
    boxSelectionOverlay: {
      hidden: true,
      style: { removeProperty: vi.fn() },
    } as unknown as HTMLElement,
  };
}

interface ViewportFixture {
  readonly viewport: Viewport;
  readonly setBackground: MockFunction;
  readonly render: MockFunction;
}

function viewport(): ViewportFixture {
  const setBackground = vi.fn();
  const render = vi.fn();
  const clearSectionPlane = vi.fn();
  const setSectionPlane = vi.fn();
  return {
    viewport: {
      presentation: {
        setBackground,
        clearSectionPlane,
        setSectionPlane,
      },
      interaction: { state: createInteractionState() },
      render,
      destroy: vi.fn(),
    } as unknown as Viewport,
    setBackground,
    render,
  };
}
