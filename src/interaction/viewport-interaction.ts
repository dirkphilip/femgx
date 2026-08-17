import { clientToCanvasCss } from "../camera/coordinates";
import { boxSelectionFrustum } from "./box-frustum";
import { installBoxSelection, type BoxSelectionEvent } from "./box-selection";
import {
  clearSelection,
  isTargetSelected,
  interactionTargetFromHit,
  setTargetHovered,
  setTargetSelected,
  setTargetsSelected,
} from "./targets";
import type { InteractionState } from "./interaction";
import type { InteractionTarget } from "./target-types";
import type { InteractionGranularity } from "../picking/types";
import type { BoxSelectionFrustum } from "./box-frustum";
import type {
  ViewportInteractionApplyRequest,
  ViewportInteractionBoxEvent,
  ViewportInteractionBoxSelection,
  ViewportInteractionModifiers,
  ViewportInteractionOptions,
  ViewportInteractionPhase,
  ViewportInteractionTouchMode,
} from "./viewport-interaction-types";
export type {
  ViewportInteractionApplyRequest,
  ViewportInteractionApplyResult,
  ViewportInteractionBoxEvent,
  ViewportInteractionBoxSelection,
  ViewportInteractionModifiers,
  ViewportInteractionOptions,
  ViewportInteractionPhase,
  ViewportInteractionTouchMode,
} from "./viewport-interaction-types";

/**
 * Installs opt-in default viewport interaction and returns an idempotent disposer.
 *
 * Mouse and pen hover replace the one hovered target. Plain clicks replace
 * selection, while Control/Meta clicks toggle it. Completed box selections use
 * `Viewport.pickRegion` by default and apply one duplicate-safe immutable
 * transition. Hosts can replace point/region discovery or return their own
 * interaction state from `applyInteraction`; returning `undefined` suppresses
 * the default policy. A completed-box callback receives the normalized CSS
 * rectangle, six inward frustum planes, captured granularity, and candidates.
 * Region queries are serialized: while one is pending, only the newest
 * completed box is retained for the next query.
 * @category Interaction and picking
 */
export function installViewportInteraction(options: ViewportInteractionOptions): () => void {
  return new ViewportInteraction(options).dispose;
}

class ViewportInteraction {
  private readonly abortController = new AbortController();
  private readonly boxDisposer: () => void;
  private generation = 0;
  private disposed = false;
  private boxActive = false;
  private skipNextClick = false;
  private boxQueryActive = false;
  private queuedBox:
    { readonly event: ViewportInteractionBoxEvent; readonly generation: number } | undefined;

  constructor(private readonly options: ViewportInteractionOptions) {
    this.boxDisposer = installBoxSelection({
      canvas: options.canvas,
      touchEnabled: () => this.touchMode() === "box-select",
      onEvent: this.boxEvent,
    });
    const listener = { signal: this.abortController.signal };
    options.canvas.addEventListener("pointerdown", this.pointerDown, listener);
    options.canvas.addEventListener("pointermove", this.pointerMove, listener);
    options.canvas.addEventListener("pointerleave", this.pointerLeave, listener);
    options.canvas.addEventListener("pointerup", this.pointerUp, listener);
    options.canvas.addEventListener("click", this.click, listener);
  }

  dispose = (): void => {
    if (this.disposed) return;
    this.boxDisposer();
    this.disposed = true;
    this.generation += 1;
    this.queuedBox = undefined;
    this.abortController.abort();
  };

  private readonly pointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "touch" && this.touchMode() !== "navigate") {
      event.preventDefault();
    }
    this.generation += 1;
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    if (!this.isPointPointer(event) || this.boxActive || event.buttons !== 0) return;
    void this.resolvePoint("hover", event);
  };

  private readonly pointerLeave = (event: PointerEvent): void => {
    if (!this.isPointPointer(event)) return;
    this.generation += 1;
    const current = this.options.viewport.interaction;
    const next = setTargetHovered(current, undefined);
    if (next !== current)
      void this.apply(
        {
          phase: "hover",
          granularity: this.options.granularity(),
          target: undefined,
          targets: [],
          modifiers: modifiersOf(event),
          event,
          current,
          defaultInteraction: next,
        },
        this.generation,
      );
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return;
    this.skipNextClick = true;
    if (this.touchMode() !== "hover") return;
    void this.resolvePoint("hover", event);
  };

  private readonly click = (event: MouseEvent): void => {
    if (this.skipNextClick) {
      this.skipNextClick = false;
      return;
    }
    void this.resolvePoint("click", event);
  };

  private readonly boxEvent = (event: BoxSelectionEvent): void => {
    if (event.type === "start" || event.type === "change") this.boxActive = true;
    else this.boxActive = false;
    this.reportBoxEvent(event);
    if (!isCompletedBoxEvent(event)) return;
    this.skipNextClick = true;
    this.resolveBox(event);
  };

  private async resolvePoint(
    phase: "hover" | "click",
    event: PointerEvent | MouseEvent,
  ): Promise<void> {
    const generation = ++this.generation;
    const granularity = this.options.granularity();
    const modifiers = modifiersOf(event);
    const point = clientToCanvasCss(
      event.clientX,
      event.clientY,
      this.options.canvas.getBoundingClientRect(),
    );
    let target: InteractionTarget | undefined;
    try {
      target = this.options.resolvePoint
        ? await this.options.resolvePoint({
            phase,
            x: point.x,
            y: point.y,
            granularity,
            modifiers,
            event,
          })
        : await this.defaultPointTarget(point.x, point.y, granularity);
      assertTarget(target, granularity);
    } catch (error: unknown) {
      if (this.isCurrent(generation)) this.reportError(error, phase);
      return;
    }
    if (!this.isCurrent(generation)) return;
    const current = this.options.viewport.interaction;
    const next =
      phase === "hover"
        ? setTargetHovered(current, target)
        : clickInteraction(current, target, modifiers);
    await this.apply(
      {
        phase,
        granularity,
        current,
        defaultInteraction: next,
        target,
        targets: target === undefined ? [] : [target],
        modifiers,
        event,
      },
      generation,
    );
  }

  private resolveBox(event: ViewportInteractionBoxEvent): void {
    const generation = ++this.generation;
    if (this.boxQueryActive) {
      this.queuedBox = { event, generation };
      return;
    }
    void this.runBoxQuery(event, generation);
  }

  private async runBoxQuery(event: ViewportInteractionBoxEvent, generation: number): Promise<void> {
    this.boxQueryActive = true;
    try {
      await this.queryBox(event, generation);
    } finally {
      this.boxQueryActive = false;
      const queued = this.queuedBox;
      this.queuedBox = undefined;
      if (queued !== undefined && this.isCurrent(queued.generation)) {
        void this.runBoxQuery(queued.event, queued.generation);
      }
    }
  }

  private async queryBox(event: ViewportInteractionBoxEvent, generation: number): Promise<void> {
    const granularity = this.options.granularity();
    let frustum: BoxSelectionFrustum;
    let targets: readonly InteractionTarget[];
    try {
      frustum = boxSelectionFrustum(this.options.viewport.camera, event.rect);
      targets = this.options.resolveRegion
        ? await this.options.resolveRegion({
            rect: event.rect,
            event,
            granularity,
            frustum,
          })
        : await this.options.viewport.pickRegion(event.rect, granularity);
      for (const target of targets) assertTarget(target, granularity);
    } catch (error: unknown) {
      if (this.isCurrent(generation)) this.reportError(error, "box");
      return;
    }
    if (!this.isCurrent(generation)) return;
    const selection = { event, granularity, frustum, targets };
    this.reportBoxSelection(selection);
    const current = this.options.viewport.interaction;
    const next = boxInteraction(current, targets, event.modifiers);
    await this.apply(
      {
        phase: "box",
        granularity,
        current,
        defaultInteraction: next,
        target: undefined,
        targets,
        modifiers: {
          shift: event.modifiers.shift,
          control: event.modifiers.control,
          alt: event.modifiers.alt,
          meta: event.modifiers.meta,
        },
        event,
        frustum,
      },
      generation,
    );
  }

  private async defaultPointTarget(
    x: number,
    y: number,
    granularity: InteractionGranularity,
  ): Promise<InteractionTarget | undefined> {
    const hit = await this.options.viewport.pick(x, y, granularity === "edge" ? "edge" : undefined);
    return hit === undefined ? undefined : interactionTargetFromHit(hit, granularity);
  }

  private async apply(request: ViewportInteractionApplyRequest, generation: number): Promise<void> {
    let result: InteractionState | undefined;
    try {
      result = this.options.applyInteraction
        ? await this.options.applyInteraction(request)
        : request.defaultInteraction;
    } catch (error: unknown) {
      if (this.isCurrent(generation)) this.reportError(error, request.phase);
      return;
    }
    if (!this.isCurrent(generation) || result === undefined) return;
    if (result !== request.current) this.options.viewport.setInteraction(result);
  }

  private isPointPointer(event: PointerEvent): boolean {
    if (event.pointerType === "touch") return this.touchMode() === "hover";
    return event.pointerType === "mouse" || event.pointerType === "pen";
  }

  private touchMode(): ViewportInteractionTouchMode {
    return this.options.touchMode?.() ?? "navigate";
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private reportBoxEvent(event: BoxSelectionEvent): void {
    try {
      this.options.onBoxEvent?.(event);
    } catch (error: unknown) {
      this.reportError(error, "box");
    }
  }

  private reportBoxSelection(selection: ViewportInteractionBoxSelection): void {
    try {
      this.options.onBoxSelection?.(selection);
    } catch (error: unknown) {
      this.reportError(error, "box");
    }
  }

  private reportError(error: unknown, phase: ViewportInteractionPhase): void {
    try {
      this.options.onError?.(error, phase);
    } catch {
      // Error observers must not create an unhandled event-listener rejection.
    }
  }
}

function clickInteraction(
  current: InteractionState,
  target: InteractionTarget | undefined,
  modifiers: ViewportInteractionModifiers,
): InteractionState {
  const withoutHover = setTargetHovered(current, undefined);
  if (modifiers.control || modifiers.meta) {
    if (target === undefined) return withoutHover;
    return setTargetSelected(withoutHover, target, !isTargetSelected(current, target));
  }
  return setTargetsSelected(
    clearSelection(withoutHover),
    target === undefined ? [] : [target],
    true,
  );
}

function boxInteraction(
  current: InteractionState,
  targets: readonly InteractionTarget[],
  modifiers: { readonly control: boolean; readonly meta: boolean },
): InteractionState {
  const withoutHover = setTargetHovered(current, undefined);
  if (!modifiers.control && !modifiers.meta) {
    return setTargetsSelected(clearSelection(withoutHover), targets, true);
  }
  const selected: InteractionTarget[] = [];
  const cleared: InteractionTarget[] = [];
  for (const target of uniqueTargets(targets)) {
    (isTargetSelected(current, target) ? cleared : selected).push(target);
  }
  return setTargetsSelected(setTargetsSelected(withoutHover, cleared, false), selected, true);
}

function uniqueTargets(targets: readonly InteractionTarget[]): InteractionTarget[] {
  const seen = new Set<string>();
  const unique: InteractionTarget[] = [];
  for (const target of targets) {
    const key = targetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }
  return unique;
}

function targetKey(target: InteractionTarget): string {
  switch (target.kind) {
    case "part":
      return `part:${target.partId}`;
    case "instance":
      return `instance:${target.instanceId}`;
    case "body":
      return `body:${target.instanceId}:${target.bodyId}`;
    case "element":
      return `element:${target.instanceId}:${target.elementId}`;
    case "face":
      return `face:${target.instanceId}:${target.elementId}:${target.faceIndex}`;
    case "node":
      return `node:${target.instanceId}:${target.nodeId}`;
    case "edge":
      return `edge:${target.instanceId}:${target.key}`;
  }
}

function modifiersOf(event: {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}): ViewportInteractionModifiers {
  return {
    shift: event.shiftKey,
    control: event.ctrlKey,
    alt: event.altKey,
    meta: event.metaKey,
  };
}

function assertTarget(
  target: InteractionTarget | undefined,
  granularity: InteractionGranularity,
): void {
  if (target !== undefined && target.kind !== granularity) {
    throw new TypeError(
      `Viewport interaction resolver returned ${target.kind} target; expected ${granularity} target`,
    );
  }
}

function isCompletedBoxEvent(event: BoxSelectionEvent): event is ViewportInteractionBoxEvent {
  return event.type === "complete";
}
