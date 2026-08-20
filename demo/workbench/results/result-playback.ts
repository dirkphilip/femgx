import type { AuthoredResultSequence, AuthoredResultSnapshot } from "../../fixtures/presets";
import type { ValueRange } from "@/entries/results";
import type { WorkbenchModel } from "../models/model";
import type { WorkbenchShowState } from "../state/show-state";
import type { ViewportSlotId } from "../viewport/view";

export interface WorkbenchResultPlaybackSnapshot {
  readonly label: string;
  readonly range: Readonly<{ min: number; max: number }>;
  readonly scalar: WorkbenchResultPlaybackField;
  readonly deformation: WorkbenchResultPlaybackField;
  readonly index: number;
  readonly count: number;
  readonly time: number;
  readonly stepLabel: string;
  readonly active: boolean;
  readonly playing: boolean;
  readonly rate: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

export interface WorkbenchResultPlaybackField {
  readonly id: string;
  readonly name: string;
  readonly location: "nodal" | "elemental";
  readonly unit: string;
}

export interface WorkbenchResultPlaybackStep {
  readonly snapshot: AuthoredResultSnapshot;
  readonly range: ValueRange;
}

export interface WorkbenchResultPlaybackActions {
  readonly currentStep: () => WorkbenchResultPlaybackStep | undefined;
  readonly snapshot: () => WorkbenchResultPlaybackSnapshot | undefined;
  readonly resetForModel: (model: WorkbenchModel) => void;
  readonly disable: () => void;
  readonly setIndex: (value: string) => void;
  readonly previous: () => void;
  readonly next: () => void;
  readonly togglePlaying: () => void;
  readonly setRate: (value: string) => void;
  readonly stop: () => void;
}

interface ResultPlaybackOwner {
  readonly model: WorkbenchModel;
  readonly activeSlot: () => { readonly id: ViewportSlotId };
  readonly showState: (slotId: ViewportSlotId) => WorkbenchShowState;
  readonly applyResultModeForSlot: (slotId: ViewportSlotId, render: boolean) => void;
  readonly disposed: boolean;
  publishSnapshot(): void;
}

interface ResultPlaybackSlot {
  readonly owner: ResultPlaybackOwner;
  readonly id: ViewportSlotId;
  readonly state: WorkbenchShowState;
}

/** Creates host-owned controls for one finite authored result sequence. */
export function createResultPlaybackActions(
  owner: ResultPlaybackOwner,
): WorkbenchResultPlaybackActions {
  resetForModel(playbackSlot(owner), owner.model);
  return {
    currentStep: () => currentStep(playbackSlot(owner)),
    snapshot: () => playbackSnapshot(playbackSlot(owner)),
    resetForModel: (model) => {
      resetForModel(playbackSlot(owner), model);
    },
    disable: () => {
      disable(playbackSlot(owner));
    },
    setIndex: (value) => {
      setIndex(playbackSlot(owner), value);
    },
    previous: () => {
      stepBy(playbackSlot(owner), -1);
    },
    next: () => {
      stepBy(playbackSlot(owner), 1);
    },
    togglePlaying: () => {
      togglePlaying(playbackSlot(owner));
    },
    setRate: (value) => {
      setRate(playbackSlot(owner), value);
    },
    stop: () => {
      stop(playbackSlot(owner));
    },
  };
}

/** Stops playback when the document is backgrounded without coupling the controller to the DOM. */
export function installResultPlaybackVisibility(
  actions: Pick<WorkbenchResultPlaybackActions, "stop">,
  signal: AbortSignal,
): void {
  globalThis.document.addEventListener(
    "visibilitychange",
    () => {
      if (globalThis.document.hidden) actions.stop();
    },
    { signal },
  );
}

function playbackSlot(owner: ResultPlaybackOwner): ResultPlaybackSlot {
  const id = owner.activeSlot().id;
  return { owner, id, state: owner.showState(id) };
}

function sequence(slot: ResultPlaybackSlot): AuthoredResultSequence | undefined {
  return slot.owner.model.resultSequence;
}

function currentStep(slot: ResultPlaybackSlot): WorkbenchResultPlaybackStep | undefined {
  return resultPlaybackStepForState(slot.owner.model, slot.state);
}

/** Resolves one slot's current authored playback step without reading another slot. */
export function resultPlaybackStepForState(
  model: WorkbenchModel,
  state: Pick<WorkbenchShowState, "resultPlaybackActive" | "resultPlaybackIndex">,
): WorkbenchResultPlaybackStep | undefined {
  if (!state.resultPlaybackActive) return undefined;
  const source = model.resultSequence;
  const snapshot = source?.steps[state.resultPlaybackIndex];
  return source === undefined || snapshot === undefined
    ? undefined
    : { snapshot, range: source.range };
}

function playbackSnapshot(slot: ResultPlaybackSlot): WorkbenchResultPlaybackSnapshot | undefined {
  const source = sequence(slot);
  const state = slot.state;
  const step = source?.steps[state.resultPlaybackIndex];
  if (source === undefined || step === undefined) return undefined;
  return Object.freeze({
    label: source.label,
    range: Object.freeze({ ...source.range }),
    scalar: playbackField(step.scalar),
    deformation: playbackField(step.deformation),
    index: state.resultPlaybackIndex,
    count: source.steps.length,
    time: step.time,
    stepLabel: step.label,
    active: state.resultPlaybackActive,
    playing: state.resultPlaybackPlaying,
    rate: state.resultPlaybackRate,
    hasPrevious: state.resultPlaybackIndex > 0,
    hasNext: state.resultPlaybackIndex < source.steps.length - 1,
  });
}

function resetForModel(slot: ResultPlaybackSlot, _model: WorkbenchModel): void {
  clearTimer(slot);
  slot.state.resultPlaybackIndex = 0;
  slot.state.resultPlaybackPlaying = false;
  slot.state.resultPlaybackActive = false;
}

function playbackField(
  field: AuthoredResultSnapshot["scalar"] | AuthoredResultSnapshot["deformation"],
): WorkbenchResultPlaybackField {
  return Object.freeze({
    id: field.id,
    name: field.name,
    location: field.location,
    unit: field.unit,
  });
}

function disable(slot: ResultPlaybackSlot): void {
  clearTimer(slot);
  slot.state.resultPlaybackPlaying = false;
  slot.state.resultPlaybackActive = false;
}

function setIndex(slot: ResultPlaybackSlot, value: string): void {
  const source = sequence(slot);
  const parsed = Number(value);
  if (
    source === undefined ||
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    parsed >= source.steps.length
  ) {
    return;
  }
  slot.state.resultPlaybackActive = true;
  slot.state.resultPlaybackIndex = parsed;
  slot.state.resultMode = "deformed";
  applyResultMode(slot);
}

function stepBy(slot: ResultPlaybackSlot, delta: -1 | 1): void {
  const source = sequence(slot);
  if (source === undefined) return;
  const next = Math.min(
    source.steps.length - 1,
    Math.max(0, slot.state.resultPlaybackIndex + delta),
  );
  if (next === slot.state.resultPlaybackIndex) return;
  clearTimer(slot);
  slot.state.resultPlaybackPlaying = false;
  slot.state.resultPlaybackActive = true;
  slot.state.resultPlaybackIndex = next;
  slot.state.resultMode = "deformed";
  applyResultMode(slot);
}

function togglePlaying(slot: ResultPlaybackSlot): void {
  const source = sequence(slot);
  if (source === undefined) return;
  if (slot.state.resultPlaybackPlaying) {
    stop(slot);
    return;
  }
  slot.state.resultPlaybackActive = true;
  slot.state.resultMode = "deformed";
  if (slot.state.resultPlaybackIndex >= source.steps.length - 1) slot.state.resultPlaybackIndex = 0;
  slot.state.resultPlaybackPlaying = true;
  const firstDueAt = Date.now() + 1000 / slot.state.resultPlaybackRate;
  applyResultMode(slot);
  schedule(slot, firstDueAt);
}

function setRate(slot: ResultPlaybackSlot, value: string): void {
  const parsed = Number(value);
  if (parsed !== 0.5 && parsed !== 1 && parsed !== 2) return;
  slot.state.resultPlaybackRate = parsed;
  if (slot.state.resultPlaybackPlaying) {
    schedule(slot, Date.now() + 1000 / slot.state.resultPlaybackRate);
  }
  publishIfActive(slot);
}

function stop(slot: ResultPlaybackSlot): void {
  clearTimer(slot);
  if (!slot.state.resultPlaybackPlaying) return;
  slot.state.resultPlaybackPlaying = false;
  publishIfActive(slot);
}

function schedule(slot: ResultPlaybackSlot, dueAt: number): void {
  clearTimer(slot);
  const delay = Math.max(0, dueAt - Date.now());
  slot.state.resultPlaybackTimer = globalThis.setTimeout(() => {
    slot.state.resultPlaybackTimer = undefined;
    if (slot.owner.disposed || !slot.state.resultPlaybackPlaying) return;
    const source = sequence(slot);
    if (source === undefined || slot.state.resultPlaybackIndex >= source.steps.length - 1) {
      slot.state.resultPlaybackPlaying = false;
      publishIfActive(slot);
      return;
    }
    const interval = 1000 / slot.state.resultPlaybackRate;
    const elapsedIntervals = Math.max(0, Math.floor((Date.now() - dueAt) / interval));
    const advance = elapsedIntervals + 1;
    slot.state.resultPlaybackIndex = Math.min(
      source.steps.length - 1,
      slot.state.resultPlaybackIndex + advance,
    );
    if (slot.state.resultPlaybackIndex === source.steps.length - 1) {
      slot.state.resultPlaybackPlaying = false;
    }
    applyResultMode(slot);
    if (slot.state.resultPlaybackPlaying) {
      const nextDueAt = dueAt + advance * interval;
      schedule(slot, nextDueAt <= Date.now() ? Date.now() + interval : nextDueAt);
    }
  }, delay);
}

function applyResultMode(slot: ResultPlaybackSlot): void {
  slot.owner.applyResultModeForSlot(slot.id, true);
}

function publishIfActive(slot: ResultPlaybackSlot): void {
  if (slot.owner.activeSlot().id === slot.id) slot.owner.publishSnapshot();
}

function clearTimer(slot: ResultPlaybackSlot): void {
  if (slot.state.resultPlaybackTimer === undefined) return;
  globalThis.clearTimeout(slot.state.resultPlaybackTimer);
  slot.state.resultPlaybackTimer = undefined;
}
