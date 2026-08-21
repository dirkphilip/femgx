import { vi } from "vitest";
import { type Viewport, type PickHit } from "@/entries/root";
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
  type InteractionTarget,
  type ViewportInteractionBoxEvent,
  type BoxSelectionFrustum,
  type InteractionState,
  createElementRegionSelection,
} from "@/entries/interaction";
import { WorkbenchBoxPreview } from "../../../demo/workbench/selection/box-preview";
import { WorkbenchInteraction } from "../../../demo/workbench/interaction/interaction";
import type { BoxSelectionResolver } from "../../../demo/workbench/selection/box-selection-resolver";
import { selectedKeys } from "../../../demo/workbench/selection/selection";
import type { SelectionGranularity } from "../../../demo/workbench/selection/pick";
import type { WorkbenchMenu } from "../../../demo/workbench/interaction/menu";
import type { TouchInteractionMode } from "../../../demo/workbench/types";
import type { BoxSelectionRect } from "@/entries/interaction";

/** Minimal style surface used by the box-preview unit fixture. */
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

/** DOM-like overlay fixture that records preview visibility and geometry. */
class FakeOverlay {
  hidden = true;
  readonly style = new FakeStyle();
  /** Mirrors the index.html default; the preview must never flip it. */
  readonly attributes = new Map<string, string>([["aria-hidden", "true"]]);

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

/** DOM-like canvas fixture for workbench interaction event tests. */
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

function createViewportFixture(
  interaction: () => InteractionState,
  pick: ReturnType<typeof vi.fn>,
  pickRegion: ReturnType<typeof vi.fn>,
  setInteraction: (next: InteractionState) => void,
): Viewport {
  return {
    view: { camera: { width: 300, height: 200 } },
    interaction: { state: interaction(), pick, pickRegion, set: setInteraction },
    results: { state: undefined },
    presentation: { sectionPlane: undefined },
  } as unknown as Viewport;
}

/** Builds an interaction controller with deterministic pick and render spies. */
function harness(
  pick: ReturnType<typeof vi.fn> = vi.fn(() => Promise.resolve(undefined)),
  pickRegion: ReturnType<typeof vi.fn> = vi.fn(() =>
    Promise.resolve([] as readonly InteractionTarget[]),
  ),
  initialInteraction = createInteractionState(),
  selectionGranularity: SelectionGranularity = "element",
  options: {
    readonly boxSelectionResolver?: BoxSelectionResolver;
    readonly hoverOwnership?: {
      readonly canClear: () => boolean;
      readonly mark: () => void;
      readonly clear: () => void;
    };
    readonly touchInteractionMode?: () => TouchInteractionMode;
  } = {},
) {
  const canvas = new FakeElement();
  let interaction = initialInteraction;
  const render = vi.fn();
  const selectionFeedback = vi.fn();
  const inspectionPanel = { textContent: "" };
  const setCurrentInteraction = (next: InteractionState): void => {
    interaction = next;
  };
  const workbench = new WorkbenchInteraction({
    canvas: canvas as unknown as HTMLCanvasElement,
    setInspection: (text) => {
      inspectionPanel.textContent = text;
    },
    viewport: () =>
      createViewportFixture(() => interaction, pick, pickRegion, setCurrentInteraction),
    getInteraction: () => interaction,
    setInteraction: setCurrentInteraction,
    partName: () => undefined,
    menu: { hide: vi.fn() } as unknown as WorkbenchMenu,
    render,
    selectionGranularity: () => selectionGranularity,
    ...(options.touchInteractionMode === undefined
      ? {}
      : { touchMode: options.touchInteractionMode }),
    ...(options.boxSelectionResolver === undefined
      ? {}
      : { boxSelectionResolver: options.boxSelectionResolver }),
    selectionFeedback,
    ...(options.hoverOwnership === undefined ? {} : { hoverOwnership: options.hoverOwnership }),
  });
  return {
    workbench,
    canvas,
    pick,
    pickRegion,
    render,
    selectionFeedback,
    inspectionPanel,
    getInteraction: () => interaction,
  };
}

const element = (partOccurrenceId: string, elementId: number): InteractionTarget => ({
  kind: "element",
  partOccurrenceId,
  elementId,
});

const elementSelection = (...targets: readonly InteractionTarget[]) => {
  const groups = new Map<string, number[]>();
  for (const target of targets) {
    if (target.kind !== "element") continue;
    const values = groups.get(target.partOccurrenceId);
    if (values === undefined) groups.set(target.partOccurrenceId, [target.elementId]);
    else values.push(target.elementId);
  }
  return createElementRegionSelection(groups);
};

const nodeHit: PickHit = {
  kind: "node",
  partId: 1,
  partOccurrenceId: "instance-a",
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
  partOccurrenceId: "instance-a",
  elementId: 2,
  faceIndex: 1,
  key: "1:0:1:2",
  nodeIds: [1, 2, 3],
  worldPosition: [0, 0, 0],
  normal: [0, 0, 1],
  neighborElementIds: [],
};

const edgeHit: PickHit = {
  kind: "edge",
  partId: 1,
  partOccurrenceId: "instance-a",
  key: "1,2",
  nodeIds: [1, 2],
  incidentElementIds: [2],
  faceRefs: [],
  worldPosition: [0, 0, 0],
  tangent: [1, 0, 0],
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

export {
  createInteractionState,
  FakeStyle,
  FakeOverlay,
  FakeElement,
  WorkbenchBoxPreview,
  WorkbenchInteraction,
  hoveredTarget,
  isTargetHighlighted,
  isTargetSelected,
  setTargetHighlighted,
  setTargetSelected,
  setTargetHovered,
  selectedKeys,
  rect,
  harness,
  element,
  elementSelection,
  nodeHit,
  faceHit,
  edgeHit,
  complete,
};
export type {
  BoxSelectionResolver,
  BoxSelectionModifiers,
  BoxSelectionEvent,
  Viewport,
  InteractionTarget,
  PickHit,
  ViewportInteractionBoxEvent,
  BoxSelectionFrustum,
  SelectionGranularity,
  WorkbenchMenu,
  TouchInteractionMode,
  BoxSelectionRect,
};
