import { describe, expect, it, vi } from "vitest";
import { setControllerViewport } from "../../../demo/workbench/controllers/controller-viewport";
import { applyActiveStateForOwner } from "../../../demo/workbench/controllers/controller-display";
import type { WorkbenchViewportOwner } from "../../../demo/workbench/controllers/controller-viewport";
import type { WorkbenchModel } from "../../../demo/workbench/models/model";
import { WorkbenchViewportSlots } from "../../../demo/workbench/viewport/viewport-slots";
import type { WorkbenchPane, ViewportSlotId } from "../../../demo/workbench/viewport/view";
import type { WorkbenchOptions } from "../../../demo/workbench/types";
import type { WorkbenchInteraction } from "../../../demo/workbench/interaction/interaction";
import type { WorkbenchBoxPreview } from "../../../demo/workbench/selection/box-preview";
import type { WorkbenchMenu } from "../../../demo/workbench/interaction/menu";
import {
  createInteractionState,
  type Viewport,
  type ViewportBackground,
} from "../../../src/entries/root";

vi.mock("../../../demo/workbench/lifecycle", () => ({
  installWorkbenchPaneLifecycle: vi.fn(() => vi.fn()),
}));

describe("workbench viewport lifecycle ownership", () => {
  it("applies the replacement viewport state once", () => {
    const oldViewport = viewport();
    const nextViewport = viewport();
    const owner = replacementOwner(oldViewport);
    const activeState = applyActiveStateForOwner.bind(null, owner);
    owner.viewportSlots.setPrimaryViewport = vi.fn((next: Viewport) => {
      owner.activeSlot().viewport = next;
      activeState();
      owner.visibilityPanel.rebuild();
    });

    setControllerViewport(owner, nextViewport);

    expect(owner.applyResultMode).toHaveBeenCalledOnce();
    expect(owner.applyCurrentDisplayState).toHaveBeenCalledOnce();
    expect(nextViewport.presentation.setBackground).toHaveBeenCalledOnce();
    expect(owner.visibilityPanel.rebuild).toHaveBeenCalledOnce();
    expect(owner.render).toHaveBeenCalledOnce();
    const [resultCall = 0] = vi.mocked(owner.applyResultMode).mock.invocationCallOrder;
    const [displayCall = 0] = vi.mocked(owner.applyCurrentDisplayState).mock.invocationCallOrder;
    const [rebuildCall = 0] = vi.mocked(owner.visibilityPanel.rebuild).mock.invocationCallOrder;
    const [renderCall = 0] = vi.mocked(owner.render).mock.invocationCallOrder;
    expect(resultCall).toBeLessThan(displayCall);
    expect(displayCall).toBeLessThan(rebuildCall);
    expect(rebuildCall).toBeLessThan(renderCall);
  });

  it("reports a replacement background failure and completes recovery", () => {
    const owner = replacementOwner(viewport());
    const nextViewport = viewport();
    nextViewport.presentation.setBackground = vi.fn(() => {
      throw new Error("background failed");
    });
    owner.viewportSlots.setPrimaryViewport = vi.fn((next: Viewport) => {
      owner.activeSlot().viewport = next;
      applyActiveStateForOwner(owner);
      owner.visibilityPanel.rebuild();
    });

    expect(() => setControllerViewport(owner, nextViewport)).not.toThrow();

    expect(owner.presentation.setFeedback).toHaveBeenCalledWith(
      "Background could not be restored: background failed",
      "error",
    );
    expect(owner.activeSlot().renderLoop.setEnabled).toHaveBeenCalledOnce();
    expect(owner.render).toHaveBeenCalledOnce();
  });

  it("does not reapply active state or publish the secondary opening twice", async () => {
    const primaryViewport = viewport();
    const secondaryViewport = viewport();
    const applyActiveState = vi.fn();
    const rebuildVisibility = vi.fn();
    const render = vi.fn();
    const slots = new WorkbenchViewportSlots({
      view: { primaryPane: pane("primary"), secondaryPane: pane("secondary") },
      primaryViewport,
      primaryInteraction: {} as WorkbenchInteraction,
      primaryBoxPreview: {} as WorkbenchBoxPreview,
      createViewport: vi.fn(
        async () => secondaryViewport,
      ) as unknown as WorkbenchOptions["createViewport"],
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

function replacementOwner(oldViewport: Viewport): ReplacementOwner {
  const primarySlot = {
    id: "primary" as const,
    viewport: oldViewport,
    renderLoop: { setEnabled: vi.fn() },
  };
  const presentation = {
    reflectSectionPlane: vi.fn(),
    reflectResults: vi.fn(),
    setFeedback: vi.fn(),
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
    applyResultMode: vi.fn(),
    applyCurrentDisplayState: vi.fn(),
    visibilityPanel: { rebuild: vi.fn() },
    resetHoverOwner: vi.fn(),
    render: vi.fn(),
  } as unknown as ReplacementOwner;
  return owner;
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

function viewport(): Viewport {
  return {
    presentation: {
      setBackground: vi.fn(),
      clearSectionPlane: vi.fn(),
      setSectionPlane: vi.fn(),
    },
    interaction: { state: createInteractionState() },
    render: vi.fn(),
    destroy: vi.fn(),
  } as unknown as Viewport;
}
