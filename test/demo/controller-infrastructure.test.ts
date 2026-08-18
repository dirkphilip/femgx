import { describe, expect, it, vi } from "vitest";
import {
  createInteractionState,
  isTargetSelected,
  setTargetSelected,
  type InteractionState,
  type PickHit,
  type Viewport,
} from "../../src/entries/root";
import type { SceneRuntime } from "../../src/entries/runtime";
import type { WorkbenchModel } from "../../demo/workbench/models/model";
import {
  createWorkbenchInfrastructure,
  type WorkbenchInfrastructureOptions,
} from "../../demo/workbench/controllers/controller-infrastructure";
import type { ViewportSlotId } from "../../demo/workbench/viewport/view";

describe("workbench controller infrastructure", () => {
  it("keeps primary picking and state scoped to primary when secondary is active", async () => {
    const primaryHit = faceHit("primary-occurrence");
    const primaryPick = vi.fn(() => Promise.resolve(primaryHit));
    const secondaryPick = vi.fn(() => Promise.resolve(undefined));
    const primaryViewport = viewport(primaryPick);
    const secondaryViewport = viewport(secondaryPick);
    const states = new Map<ViewportSlotId, InteractionState>([
      ["primary", createInteractionState()],
      ["secondary", createInteractionState()],
    ]);
    const inspections = new Map<ViewportSlotId, { visible: boolean; text: string }>([
      ["primary", { visible: false, text: "" }],
      ["secondary", { visible: false, text: "" }],
    ]);
    const options = infrastructureOptions(primaryViewport, secondaryViewport, states, inspections);
    const infrastructure = createWorkbenchInfrastructure(options);
    const bindings = infrastructure.features.interactionController.viewportInteractionOptions();
    const event = {} as MouseEvent;
    const modifiers = { shift: false, control: false, alt: false, meta: false } as const;
    const target = await bindings.resolvePoint?.({
      phase: "click",
      x: 10,
      y: 20,
      granularity: "element",
      modifiers,
      event,
    });

    expect(primaryPick).toHaveBeenCalledOnce();
    expect(secondaryPick).not.toHaveBeenCalled();
    expect(target).toEqual({
      kind: "element",
      partOccurrenceId: "primary-occurrence",
      elementId: 4,
    });

    const current = states.get("primary");
    if (current === undefined || target === undefined) throw new Error("missing primary state");
    await bindings.applyInteraction?.({
      phase: "click",
      granularity: "element",
      current,
      defaultInteraction: setTargetSelected(current, target, true),
      target,
      targets: [target],
      modifiers,
      event,
    });

    expect(isTargetSelected(states.get("primary") as InteractionState, target)).toBe(true);
    expect(isTargetSelected(states.get("secondary") as InteractionState, target)).toBe(false);
    expect(vi.mocked(primaryViewport.interaction.set)).toHaveBeenCalledWith(states.get("primary"));
    expect(inspections.get("primary")?.visible).toBe(true);
    expect(inspections.get("secondary")?.visible).toBe(false);
  });
});

function infrastructureOptions(
  primaryViewport: Viewport,
  secondaryViewport: Viewport,
  states: Map<ViewportSlotId, InteractionState>,
  inspections: Map<ViewportSlotId, { visible: boolean; text: string }>,
): WorkbenchInfrastructureOptions {
  const primaryPane = pane("primary");
  const secondaryPane = pane("secondary");
  let activeSlot: ViewportSlotId = "secondary";
  const interactionForSlot = (slotId: ViewportSlotId): InteractionState => {
    const state = states.get(slotId);
    if (state === undefined) throw new Error(`Missing ${slotId} interaction`);
    return state;
  };
  const setInteractionForSlot = (slotId: ViewportSlotId, value: InteractionState): void => {
    states.set(slotId, value);
  };
  const activeInspection = (): { visible: boolean; text: string } => {
    const value = inspections.get(activeSlot);
    if (value === undefined) throw new Error(`Missing ${activeSlot} inspection`);
    return value;
  };
  return {
    view: { primaryPane, secondaryPane },
    canvas: primaryPane.canvas,
    rendererName: "test",
    viewport: primaryViewport,
    primaryViewport: () => primaryViewport,
    createViewport: vi.fn(),
    model: () => ({ partNames: new Map() }) as unknown as WorkbenchModel,
    toggles: () => ({ edges: false, nodes: false, diagnostics: false }),
    resultMode: () => "base",
    vectorFieldId: () => "off",
    vectorGlyph: () => "arrow",
    vectorTransform: () => "direction",
    continuous: () => false,
    selectionGranularity: () => "element",
    selectionGranularityForSlot: () => "element",
    touchInteractionMode: () => "navigate",
    touchInteractionModeForSlot: () => "navigate",
    sectionAxis: () => "off",
    sectionOffset: () => 0,
    interaction: () => interactionForSlot(activeSlot),
    setInteraction: (value) => {
      setInteractionForSlot(activeSlot, value);
    },
    getInspection: activeInspection,
    setInspection: (value) => {
      inspections.set(activeSlot, { ...value });
    },
    setInspectionForSlot: (slotId, value) => {
      inspections.set(slotId, { ...value });
    },
    interactionForSlot,
    setInteractionForSlot,
    canClearCanvasHover: () => true,
    markCanvasHover: vi.fn(),
    clearCanvasHover: vi.fn(),
    activeSlot: () =>
      ({
        id: activeSlot,
        viewport: activeSlot === "primary" ? primaryViewport : secondaryViewport,
      }) as never,
    activeViewport: () => (activeSlot === "primary" ? primaryViewport : secondaryViewport),
    viewports: () => [primaryViewport, secondaryViewport],
    runtime: () => ({}) as SceneRuntime,
    applyDisplayedInteraction: vi.fn(),
    render: vi.fn(),
    publishSnapshot: vi.fn(),
    setEdges: vi.fn(),
    setDiagnostics: vi.fn(),
    fitSelection: vi.fn(),
    reset: vi.fn(),
    applyActiveState: vi.fn(),
    applyState: vi.fn(),
    cloneShowState: vi.fn(),
    removeShowState: vi.fn(),
    rebuildVisibility: vi.fn(),
    feedback: vi.fn(),
    onActiveSlotChanged: vi.fn((slotId: ViewportSlotId) => {
      activeSlot = slotId;
    }),
  };
}

function pane(id: ViewportSlotId): {
  readonly id: ViewportSlotId;
  readonly scene: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly boxSelectionOverlay: HTMLElement;
} {
  const canvas = {
    dataset: {} as DOMStringMap,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 200 }) as DOMRect,
  } as unknown as HTMLCanvasElement;
  return {
    id,
    scene: { dataset: {} } as unknown as HTMLElement,
    canvas,
    boxSelectionOverlay: {
      hidden: true,
      style: { removeProperty: vi.fn() },
    } as unknown as HTMLElement,
  };
}

function viewport(pick: (x: number, y: number) => Promise<PickHit | undefined>): Viewport {
  return {
    interaction: {
      pick,
      state: createInteractionState(),
      set: vi.fn(),
    },
    results: { state: undefined },
    render: vi.fn(),
  } as unknown as Viewport;
}

function faceHit(partOccurrenceId: string): PickHit {
  return {
    kind: "face",
    partId: 1,
    partOccurrenceId,
    elementId: 4,
    faceIndex: 0,
    key: "0:0:1:2",
    nodeIds: [0, 1, 2],
    worldPosition: [0, 0, 0],
    normal: [0, 0, 1],
    neighborElementIds: [],
  };
}
