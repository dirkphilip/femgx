import type { ViewportBackground } from "../../../src/entries/root";
import type { InteractionState } from "../../../src/entries/interaction";
import type { WorkbenchModel } from "../models/model";
import {
  activeScalarFieldIdForModel,
  resultModeForModel,
  vectorDisplayForModel,
  type VectorDisplayState,
} from "../results/result-controls";
import type { WorkbenchElementDetailSnapshot } from "../results/snapshot";
import { createModelInteraction } from "./preset";
import {
  createDefaultDisplayToggles,
  type DisplayToggles,
  type ResultDisplayMode,
  type TouchInteractionMode,
} from "../types";
import type { SelectionGranularity } from "../selection/pick";
import type { BoxSelectionStrategy } from "../selection/box-selection-resolver";
import type { SectionAxis } from "../section-controls";
import type { ViewportSlotId } from "../viewport/view";
import type { WorkbenchHoverOwner } from "../controllers/controller-hover";

/** Demo-private presentation state owned independently by one viewport slot. */
export interface WorkbenchShowState {
  toggles: DisplayToggles;
  resultMode: ResultDisplayMode;
  interaction: InteractionState;
  continuousEnabled: boolean;
  deformationScale: number;
  vectorDisplay: VectorDisplayState;
  sectionAxis: SectionAxis;
  sectionOffset: number;
  selectionGranularity: SelectionGranularity;
  boxSelectionStrategy: BoxSelectionStrategy;
  elementBoxSelectionStrategy: BoxSelectionStrategy;
  touchInteractionMode: TouchInteractionMode;
  elementDetail: WorkbenchElementDetailSnapshot | undefined;
  scalarFieldId: string;
  background: ViewportBackground;
  inspection: { visible: boolean; text: string };
  resultPlaybackIndex: number;
  resultPlaybackRate: number;
  resultPlaybackPlaying: boolean;
  resultPlaybackActive: boolean;
  resultPlaybackTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
}

/** Installs controller-compatible active-state properties over the slot map. */
export function installWorkbenchShowStateAccessors(
  target: object,
  states: Map<ViewportSlotId, WorkbenchShowState>,
  hoverOwners: Map<ViewportSlotId, WorkbenchHoverOwner | undefined>,
  activeSlot: () => ViewportSlotId,
): void {
  const current = (): WorkbenchShowState => {
    const slotId = activeSlot();
    const state = states.get(slotId);
    if (state === undefined) throw new Error(`Missing show state for ${slotId} viewport`);
    return state;
  };
  const stateProperty = (key: keyof WorkbenchShowState): PropertyDescriptor => ({
    configurable: false,
    enumerable: true,
    get: () => current()[key],
    set: (value: unknown) => Object.assign(current(), { [key]: value }),
  });
  Object.defineProperties(target, {
    toggles: stateProperty("toggles"),
    resultMode: stateProperty("resultMode"),
    interaction: stateProperty("interaction"),
    continuousEnabled: stateProperty("continuousEnabled"),
    deformationScale: stateProperty("deformationScale"),
    vectorDisplay: stateProperty("vectorDisplay"),
    sectionAxis: stateProperty("sectionAxis"),
    sectionOffset: stateProperty("sectionOffset"),
    selectionGranularity: stateProperty("selectionGranularity"),
    boxSelectionStrategy: stateProperty("boxSelectionStrategy"),
    elementBoxSelectionStrategy: stateProperty("elementBoxSelectionStrategy"),
    touchInteractionMode: stateProperty("touchInteractionMode"),
    elementDetail: stateProperty("elementDetail"),
    scalarFieldId: stateProperty("scalarFieldId"),
    background: stateProperty("background"),
    resultPlaybackIndex: stateProperty("resultPlaybackIndex"),
    resultPlaybackRate: stateProperty("resultPlaybackRate"),
    resultPlaybackPlaying: stateProperty("resultPlaybackPlaying"),
    resultPlaybackActive: stateProperty("resultPlaybackActive"),
    resultPlaybackTimer: stateProperty("resultPlaybackTimer"),
    inspection: stateProperty("inspection"),
    hoverOwner: {
      configurable: false,
      enumerable: true,
      get: () => hoverOwners.get(activeSlot()),
      set: (value: WorkbenchHoverOwner | undefined) => {
        hoverOwners.set(activeSlot(), value);
      },
    },
  });
}

/** Returns one required slot state at an ownership boundary. */
export function showStateForSlot(
  states: Map<ViewportSlotId, WorkbenchShowState>,
  slotId: ViewportSlotId,
): WorkbenchShowState {
  const state = states.get(slotId);
  if (state === undefined) throw new Error(`Missing show state for ${slotId} viewport`);
  return state;
}

/** Clones presentation state when a secondary slot is created. */
export function cloneShowStateForSlot(
  states: Map<ViewportSlotId, WorkbenchShowState>,
  hoverOwners: Map<ViewportSlotId, WorkbenchHoverOwner | undefined>,
  from: ViewportSlotId,
  to: ViewportSlotId,
): WorkbenchShowState {
  const clone = cloneWorkbenchShowState(showStateForSlot(states, from));
  states.set(to, clone);
  hoverOwners.set(to, undefined);
  return clone;
}

/** Removes a destroyed secondary slot and its pending playback timer. */
export function removeShowStateForSlot(
  states: Map<ViewportSlotId, WorkbenchShowState>,
  hoverOwners: Map<ViewportSlotId, WorkbenchHoverOwner | undefined>,
  slotId: ViewportSlotId,
): boolean {
  if (slotId === "primary") return false;
  const state = states.get(slotId);
  if (state?.resultPlaybackTimer !== undefined) globalThis.clearTimeout(state.resultPlaybackTimer);
  states.delete(slotId);
  return hoverOwners.delete(slotId);
}

/** Clears pending playback timers for every slot during controller teardown. */
export function clearResultPlaybackTimers(
  states: ReadonlyMap<ViewportSlotId, WorkbenchShowState>,
): void {
  for (const state of states.values()) {
    if (state.resultPlaybackTimer === undefined) continue;
    globalThis.clearTimeout(state.resultPlaybackTimer);
    state.resultPlaybackTimer = undefined;
  }
}

/** Resets model-dependent state while preserving each slot's presentation background. */
export function resetShowStatesForModel(
  states: Map<ViewportSlotId, WorkbenchShowState>,
  hoverOwners: Map<ViewportSlotId, WorkbenchHoverOwner | undefined>,
  model: WorkbenchModel,
): number {
  for (const [slotId, state] of states) {
    if (state.resultPlaybackTimer !== undefined) globalThis.clearTimeout(state.resultPlaybackTimer);
    states.set(slotId, { ...createWorkbenchShowState(model), background: state.background });
    hoverOwners.set(slotId, undefined);
  }
  return states.size;
}

/** Writes one slot's inspection state and reports whether it is currently active. */
export function setInspectionForSlot(
  states: Map<ViewportSlotId, WorkbenchShowState>,
  activeSlot: ViewportSlotId,
  slotId: ViewportSlotId,
  value: { readonly visible: boolean; readonly text: string },
  publish: () => void,
): boolean {
  showStateForSlot(states, slotId).inspection = { ...value };
  const active = slotId === activeSlot;
  if (active) publish();
  return active;
}

/** Creates the initial show state for a model without copying model-owned arrays. */
export function createWorkbenchShowState(model: WorkbenchModel): WorkbenchShowState {
  return {
    toggles: createDefaultDisplayToggles(model),
    resultMode: resultModeForModel(model),
    interaction: createModelInteraction(model, true, true),
    continuousEnabled: false,
    deformationScale: model.results?.deformation?.scale ?? 1,
    vectorDisplay: vectorDisplayForModel(model),
    sectionAxis: "off",
    sectionOffset: 0,
    selectionGranularity: "element",
    boxSelectionStrategy: "through-intersection",
    elementBoxSelectionStrategy: "through-intersection",
    touchInteractionMode: "navigate",
    elementDetail: undefined,
    scalarFieldId: activeScalarFieldIdForModel(model),
    background: "studio",
    inspection: {
      visible: false,
      text: "Click or right-click a visible element, face, node, or authored edge to inspect it.",
    },
    resultPlaybackIndex: 0,
    resultPlaybackRate: 1,
    resultPlaybackPlaying: false,
    resultPlaybackActive: false,
    resultPlaybackTimer: undefined,
  };
}

/** Clones mutable demo presentation values while retaining immutable model interactions. */
export function cloneWorkbenchShowState(state: WorkbenchShowState): WorkbenchShowState {
  return {
    ...state,
    toggles: { ...state.toggles },
    vectorDisplay: { ...state.vectorDisplay },
    ...(state.elementDetail === undefined
      ? { elementDetail: undefined }
      : { elementDetail: { ...state.elementDetail } }),
    inspection: { ...state.inspection },
    resultPlaybackActive: false,
    resultPlaybackPlaying: false,
    resultPlaybackTimer: undefined,
  };
}
