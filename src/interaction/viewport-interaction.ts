import { clientToCanvasCss } from "../camera/coordinates";
import { elementRegion, resolveBoxRegion, targetList } from "./viewport-interaction-box";
import { installBoxSelection, type BoxSelectionEvent } from "./box-selection";
import { interactionTargetFromHit, setTargetHovered } from "./targets";
import {
  assertTarget,
  boxInteraction,
  clickInteraction,
  elementBoxInteraction,
  isCompletedBoxEvent,
  modifiersOf,
} from "./viewport-interaction-helpers";
import type { InteractionState } from "./interaction";
import type { InteractionTarget } from "./target-types";
import type { InteractionGranularity } from "../picking/types";
import type {
  ViewportInteractionApplyRequest,
  ViewportInteractionBoxEvent,
  ViewportInteractionBoxSelection,
  ViewportInteractionOptions,
  ViewportInteractionPhase,
  ViewportInteractionTouchMode,
} from "./viewport-interaction-types";
export type {
  ViewportInteractionApplyRequest,
  ViewportInteractionApplyResult,
  ViewportInteractionBoxEvent,
  ViewportInteractionBoxSelection,
  ViewportInteractionElementBoxSelection,
  ViewportInteractionModifiers,
  ViewportInteractionOptions,
  ViewportInteractionPhase,
  ViewportInteractionTargetBoxSelection,
  ViewportInteractionTouchMode,
  ViewportElementBoxInteractionApplyRequest,
  ViewportPointInteractionApplyRequest,
  ViewportTargetBoxInteractionApplyRequest,
} from "./viewport-interaction-types";

/**
 * Installs opt-in default viewport interaction and returns an idempotent disposer.
 *
 * Mouse and pen hover replace the one hovered target. Plain clicks replace
 * selection, while Control/Meta clicks toggle it. Completed box selections use
 * `viewport.interaction.pickRegion` by default; plain boxes replace selection and
 * Control/Meta boxes append through one duplicate-safe immutable transition.
 * Hosts can replace point/region discovery or return their own
 * interaction state from `applyInteraction`; returning `undefined` suppresses
 * the default policy. A completed-box callback receives the normalized CSS
 * rectangle, six inward frustum planes, captured granularity, and candidates.
 * Buttonless mouse and pen hover is sampled at the animation-frame boundary;
 * only one hover query runs at a time and only its newest queued event is kept.
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
  private hoverFrame: number | undefined;
  private hoverInFlight = false;
  private touchDown:
    { readonly pointerId: number; readonly clientX: number; readonly clientY: number } | undefined;
  private queuedBox:
    { readonly event: ViewportInteractionBoxEvent; readonly generation: number } | undefined;
  private queuedHover: { readonly event: PointerEvent; readonly generation: number } | undefined;

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
    options.canvas.addEventListener("pointercancel", this.pointerCancel, listener);
    options.canvas.addEventListener("click", this.click, listener);
  }

  dispose = (): void => {
    if (this.disposed) return;
    this.boxDisposer();
    this.clearQueuedHover();
    this.disposed = true;
    this.generation += 1;
    this.queuedBox = undefined;
    this.abortController.abort();
  };

  private readonly pointerDown = (event: PointerEvent): void => {
    this.clearQueuedHover();
    this.skipNextClick = false;
    if (event.pointerType === "touch") {
      this.touchDown = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      };
    }
    if (event.pointerType === "touch" && this.touchMode() !== "navigate") {
      event.preventDefault();
    }
    this.generation += 1;
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    if (!this.isPointPointer(event) || this.boxActive || this.boxQueryActive || event.buttons !== 0)
      return;
    const generation = ++this.generation;
    this.queuedHover = { event, generation };
    this.scheduleHover();
  };

  private readonly pointerLeave = (event: PointerEvent): void => {
    if (event.pointerType === "touch") return;
    if (!this.isPointPointer(event)) return;
    this.clearQueuedHover();
    if (this.boxActive || this.boxQueryActive) return;
    this.generation += 1;
    const current = this.options.viewport.interaction.state;
    const next = setTargetHovered(current, undefined);
    if (next !== current)
      void this.apply(
        {
          phase: "hover",
          granularity: this.options.granularity(),
          target: undefined,
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
    const down = this.touchDown;
    this.touchDown = undefined;
    this.skipNextClick = true;
    if (
      down === undefined ||
      down.pointerId !== event.pointerId ||
      Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY) > 10
    ) {
      return;
    }
    this.clearQueuedHover();
    void this.resolvePoint(this.touchMode() === "hover" ? "hover" : "click", event);
  };

  private readonly pointerCancel = (event: PointerEvent): void => {
    if (event.pointerType !== "touch" || this.touchDown?.pointerId !== event.pointerId) return;
    this.touchDown = undefined;
    this.skipNextClick = true;
  };

  private readonly click = (event: MouseEvent): void => {
    if (this.skipNextClick) {
      this.skipNextClick = false;
      return;
    }
    void this.resolvePoint("click", event);
  };

  private readonly boxEvent = (event: BoxSelectionEvent): void => {
    this.clearQueuedHover();
    if (event.type === "start") {
      this.boxActive = true;
      this.generation += 1;
    } else if (event.type === "change") {
      this.boxActive = true;
    } else {
      this.boxActive = false;
      if (event.type === "cancel") this.generation += 1;
    }
    this.reportBoxEvent(event);
    if (event.type === "cancel") this.skipNextClick = true;
    if (!isCompletedBoxEvent(event)) return;
    this.skipNextClick = true;
    this.resolveBox(event);
  };

  private async resolvePoint(
    phase: "hover" | "click",
    event: PointerEvent | MouseEvent,
    generation = ++this.generation,
  ): Promise<void> {
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
      assertTarget(target, granularity, modifiers);
    } catch (error: unknown) {
      if (this.isCurrent(generation)) this.reportError(error, phase);
      return;
    }
    if (!this.isCurrent(generation)) return;
    const current = this.options.viewport.interaction.state;
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
        modifiers,
        event,
      },
      generation,
    );
  }

  private scheduleHover(): void {
    if (
      this.hoverFrame !== undefined ||
      this.hoverInFlight ||
      this.queuedHover === undefined ||
      this.boxActive ||
      this.boxQueryActive ||
      this.disposed
    ) {
      return;
    }
    this.hoverFrame = requestAnimationFrame(this.runScheduledHover);
  }

  private readonly runScheduledHover = (): void => {
    this.hoverFrame = undefined;
    const queued = this.queuedHover;
    this.queuedHover = undefined;
    if (
      queued === undefined ||
      !this.isCurrent(queued.generation) ||
      this.boxActive ||
      this.boxQueryActive
    ) {
      return;
    }
    this.hoverInFlight = true;
    void this.runHover(queued);
  };

  private async runHover(queued: {
    readonly event: PointerEvent;
    readonly generation: number;
  }): Promise<void> {
    try {
      await this.resolvePoint("hover", queued.event, queued.generation);
    } catch (error: unknown) {
      if (this.isCurrent(queued.generation)) this.reportError(error, "hover");
    } finally {
      this.hoverInFlight = false;
      if (this.queuedHover !== undefined) this.scheduleHover();
    }
  }

  private clearQueuedHover(): void {
    this.queuedHover = undefined;
    if (this.hoverFrame === undefined) return;
    cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = undefined;
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
    let resolved: Awaited<ReturnType<typeof resolveBoxRegion>>;
    try {
      resolved = await resolveBoxRegion(this.options, event, granularity);
    } catch (error: unknown) {
      if (this.isCurrent(generation)) this.reportError(error, "box");
      return;
    }
    if (!this.isCurrent(generation)) return;
    const { frustum, result } = resolved;
    const current = this.options.viewport.interaction.state;
    const operation = event.modifiers.control || event.modifiers.meta ? "add" : "replace";
    if (granularity === "element") {
      const selection = elementRegion(result);
      this.reportBoxSelection({ event, granularity, frustum, selection });
      await this.apply(
        {
          phase: "box",
          granularity,
          current,
          defaultInteraction: elementBoxInteraction(current, selection, operation),
          selection,
          operation,
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
      return;
    }
    const targets = targetList(result);
    this.reportBoxSelection({ event, granularity, frustum, targets });
    const next = boxInteraction(current, targets, event.modifiers);
    await this.apply(
      {
        phase: "box",
        granularity,
        current,
        defaultInteraction: next,
        selection: targets,
        operation,
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
    const hit = await this.options.viewport.interaction.pick(
      x,
      y,
      granularity === "edge" ? "edge" : undefined,
    );
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
    if (result !== request.current) this.options.viewport.interaction.set(result);
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
