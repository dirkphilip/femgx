import type { AuthoredResultSequence, AuthoredResultSnapshot } from "../../fixtures/presets";
import type { ValueRange } from "../../../src/entries/root";
import type { WorkbenchModel } from "../models/model";
import type { ResultDisplayMode } from "../types";
import type { WorkbenchShowState } from "../state/show-state";

export interface WorkbenchResultPlaybackSnapshot {
  readonly label: string;
  readonly range: Readonly<{ min: number; max: number }>;
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
  resultMode: ResultDisplayMode;
  resultPlaybackIndex: number;
  resultPlaybackRate: number;
  resultPlaybackPlaying: boolean;
  resultPlaybackActive: boolean;
  resultPlaybackTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  readonly disposed: boolean;
  applyResultMode(render: boolean): void;
  publishSnapshot(): void;
}

/** Creates host-owned controls for one finite authored result sequence. */
export function createResultPlaybackActions(
  owner: ResultPlaybackOwner,
): WorkbenchResultPlaybackActions {
  resetForModel(owner, owner.model);
  return {
    currentStep: () => currentStep(owner),
    snapshot: () => playbackSnapshot(owner),
    resetForModel: (model) => {
      resetForModel(owner, model);
    },
    disable: () => {
      disable(owner);
    },
    setIndex: (value) => {
      setIndex(owner, value);
    },
    previous: () => {
      stepBy(owner, -1);
    },
    next: () => {
      stepBy(owner, 1);
    },
    togglePlaying: () => {
      togglePlaying(owner);
    },
    setRate: (value) => {
      setRate(owner, value);
    },
    stop: () => {
      stop(owner);
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

function sequence(owner: ResultPlaybackOwner): AuthoredResultSequence | undefined {
  return owner.model.resultSequence;
}

function currentStep(owner: ResultPlaybackOwner): WorkbenchResultPlaybackStep | undefined {
  return resultPlaybackStepForState(owner.model, owner);
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

function playbackSnapshot(owner: ResultPlaybackOwner): WorkbenchResultPlaybackSnapshot | undefined {
  const source = sequence(owner);
  const step = source?.steps[owner.resultPlaybackIndex];
  if (source === undefined || step === undefined) return undefined;
  return Object.freeze({
    label: source.label,
    range: Object.freeze({ ...source.range }),
    index: owner.resultPlaybackIndex,
    count: source.steps.length,
    time: step.time,
    stepLabel: step.label,
    active: owner.resultPlaybackActive,
    playing: owner.resultPlaybackPlaying,
    rate: owner.resultPlaybackRate,
    hasPrevious: owner.resultPlaybackIndex > 0,
    hasNext: owner.resultPlaybackIndex < source.steps.length - 1,
  });
}

function resetForModel(owner: ResultPlaybackOwner, model: WorkbenchModel): void {
  clearTimer(owner);
  owner.resultPlaybackIndex = 0;
  owner.resultPlaybackPlaying = false;
  owner.resultPlaybackActive = model.resultSequence !== undefined;
}

function disable(owner: ResultPlaybackOwner): void {
  clearTimer(owner);
  owner.resultPlaybackPlaying = false;
  owner.resultPlaybackActive = false;
}

function setIndex(owner: ResultPlaybackOwner, value: string): void {
  const source = sequence(owner);
  const parsed = Number(value);
  if (
    source === undefined ||
    !Number.isInteger(parsed) ||
    parsed < 0 ||
    parsed >= source.steps.length
  ) {
    return;
  }
  owner.resultPlaybackActive = true;
  owner.resultPlaybackIndex = parsed;
  owner.resultMode = "deformed";
  owner.applyResultMode(true);
}

function stepBy(owner: ResultPlaybackOwner, delta: -1 | 1): void {
  const source = sequence(owner);
  if (source === undefined) return;
  stop(owner);
  const next = Math.min(source.steps.length - 1, Math.max(0, owner.resultPlaybackIndex + delta));
  setIndex(owner, String(next));
}

function togglePlaying(owner: ResultPlaybackOwner): void {
  const source = sequence(owner);
  if (source === undefined) return;
  if (owner.resultPlaybackPlaying) {
    stop(owner);
    return;
  }
  owner.resultPlaybackActive = true;
  owner.resultMode = "deformed";
  if (owner.resultPlaybackIndex >= source.steps.length - 1) owner.resultPlaybackIndex = 0;
  owner.resultPlaybackPlaying = true;
  owner.applyResultMode(true);
  schedule(owner);
}

function setRate(owner: ResultPlaybackOwner, value: string): void {
  const parsed = Number(value);
  if (parsed !== 0.5 && parsed !== 1 && parsed !== 2) return;
  owner.resultPlaybackRate = parsed;
  if (owner.resultPlaybackPlaying) schedule(owner);
  owner.publishSnapshot();
}

function stop(owner: ResultPlaybackOwner): void {
  clearTimer(owner);
  if (!owner.resultPlaybackPlaying) return;
  owner.resultPlaybackPlaying = false;
  owner.publishSnapshot();
}

function schedule(owner: ResultPlaybackOwner): void {
  clearTimer(owner);
  owner.resultPlaybackTimer = globalThis.setTimeout(() => {
    owner.resultPlaybackTimer = undefined;
    if (owner.disposed || !owner.resultPlaybackPlaying) return;
    const source = sequence(owner);
    if (source === undefined || owner.resultPlaybackIndex >= source.steps.length - 1) {
      owner.resultPlaybackPlaying = false;
      owner.publishSnapshot();
      return;
    }
    owner.resultPlaybackIndex += 1;
    owner.applyResultMode(true);
    schedule(owner);
  }, 1000 / owner.resultPlaybackRate);
}

function clearTimer(owner: ResultPlaybackOwner): void {
  if (owner.resultPlaybackTimer === undefined) return;
  globalThis.clearTimeout(owner.resultPlaybackTimer);
  owner.resultPlaybackTimer = undefined;
}
