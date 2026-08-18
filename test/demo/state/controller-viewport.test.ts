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
