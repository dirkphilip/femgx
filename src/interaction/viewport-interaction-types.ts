import type { BoxSelectionFrustum } from "./box-frustum";
import type { BoxSelectionEvent, BoxSelectionRect } from "./box-selection";
import type { InteractionState } from "./interaction";
import type { InteractionTarget } from "./target-types";
import type { InteractionGranularity, PickHit } from "../picking/types";
import type { Camera } from "../camera/camera";
import type { CanvasCssPoint } from "../camera/coordinates";

/** Explicitly routed touch behavior for an installed viewport interaction. */
export type ViewportInteractionTouchMode = "navigate" | "hover" | "box-select";

/** Interaction operation currently being resolved or applied. */
export type ViewportInteractionPhase = "hover" | "click" | "box";

/** The completed box event delivered by the default interaction lifecycle. */
export interface ViewportInteractionBoxEvent {
  /** Completion lifecycle discriminator. */
  readonly type: "complete";
  /** Initial pointer position in canvas CSS pixels. */
  readonly anchor: CanvasCssPoint;
  /** Final pointer position in canvas CSS pixels. */
  readonly current: CanvasCssPoint;
  /** Normalized completed selection rectangle. */
  readonly rect: BoxSelectionRect;
  /** Modifier keys captured for the completed gesture. */
  readonly modifiers: ViewportInteractionModifiers;
}

/** Modifier state normalized across pointer and box-selection events. */
export interface ViewportInteractionModifiers {
  /** Whether Shift was held. */
  readonly shift: boolean;
  /** Whether Control was held. */
  readonly control: boolean;
  /** Whether Alt was held. */
  readonly alt: boolean;
  /** Whether Meta was held. */
  readonly meta: boolean;
}

/** A completed box gesture plus its resolved, host-mappable candidates. */
export interface ViewportInteractionBoxSelection {
  /** Completed box lifecycle event. */
  readonly event: ViewportInteractionBoxEvent;
  /** Requested target granularity. */
  readonly granularity: InteractionGranularity;
  /** World-space frustum corresponding to the box. */
  readonly frustum: BoxSelectionFrustum;
  /** Unique candidates returned by region discovery. */
  readonly targets: readonly InteractionTarget[];
}

/**
 * Input passed to the optional interaction-application override.
 *
 * Returning an `InteractionState` installs that state. Returning `undefined`
 * suppresses the default mutation, which lets a host own selection policy while
 * still using the installer's candidate discovery and event ordering.
 */
export interface ViewportInteractionApplyRequest {
  /** Interaction operation being applied. */
  readonly phase: ViewportInteractionPhase;
  /** Requested physical target granularity. */
  readonly granularity: InteractionGranularity;
  /** Snapshot before the default mutation. */
  readonly current: InteractionState;
  /** Snapshot the default policy would install. */
  readonly defaultInteraction: InteractionState;
  /** Point candidate for hover/click phases. */
  readonly target: InteractionTarget | undefined;
  /** Region candidates for box phase, or an empty list for point phases. */
  readonly targets: readonly InteractionTarget[];
  /** Modifier keys captured for this operation. */
  readonly modifiers: ViewportInteractionModifiers;
  /** Original browser or box lifecycle event. */
  readonly event: PointerEvent | MouseEvent | BoxSelectionEvent;
  /** Derived world-space frustum for a box operation. */
  readonly frustum?: BoxSelectionFrustum;
}

/** Result of an interaction-application override. */
export type ViewportInteractionApplyResult =
  InteractionState | undefined | Promise<InteractionState | undefined>;

/**
 * Options for the explicit default hover, click, and box-selection binding.
 *
 * The installer adds point listeners only to `canvas` and composes the
 * existing explicit box-selection lifecycle, including its Escape cancellation
 * handling. A tap selects in Navigate and Box select modes, Highlight routes a
 * tap to hover, and movement beyond the shared tap threshold remains a camera
 * or box gesture.
 */
export interface ViewportInteractionOptions {
  /**
   * Existing viewport capabilities used by the binding. The host owns this
   * object and remains responsible for destroying the viewport after disposing
   * the binding.
   */
  readonly viewport: {
    /** Camera/navigation capability used to derive box-selection frusta. */
    readonly view: {
      /** Camera used to derive box-selection frusta. */
      readonly camera: Camera;
    };
    /** Interaction and picking capabilities used by the binding. */
    readonly interaction: {
      /** Current immutable interaction snapshot. */
      readonly state: InteractionState;
      /** Reads the physical target under canvas CSS coordinates. */
      pick(x: number, y: number, granularity?: "edge"): Promise<PickHit | undefined>;
      /** Resolves unique targets intersecting a canvas-space rectangle. */
      pickRegion(
        rect: BoxSelectionRect,
        granularity: InteractionGranularity,
      ): Promise<readonly InteractionTarget[]>;
      /** Installs the next immutable interaction snapshot. */
      set(interaction: InteractionState): void;
    };
  };
  /** Canvas receiving the installer's point and composed box listeners. */
  readonly canvas: HTMLCanvasElement;
  /** Reads the active target granularity when each pointer operation starts. */
  readonly granularity: () => InteractionGranularity;
  /** Returns the host's current touch routing decision (default: navigate). */
  readonly touchMode?: () => ViewportInteractionTouchMode;
  /**
   * Replaces point candidate discovery for hover and click. It runs after the
   * pointer coordinates are converted to canvas CSS pixels and before the
   * default immutable hover or selection transition is built.
   */
  readonly resolvePoint?: (request: {
    readonly phase: "hover" | "click";
    /** Canvas-local x coordinate. */
    readonly x: number;
    /** Canvas-local y coordinate. */
    readonly y: number;
    /** Requested target granularity. */
    readonly granularity: InteractionGranularity;
    /** Modifier keys captured for the event. */
    readonly modifiers: ViewportInteractionModifiers;
    /** Original pointer or mouse event. */
    readonly event: PointerEvent | MouseEvent;
  }) => Promise<InteractionTarget | undefined>;
  /**
   * Replaces visible-region candidate discovery for a completed box. It runs
   * after {@link boxSelectionFrustum} derives the six world-space planes and
   * may use those planes for an authoritative Through query. Calls are
   * serialized, with only the newest completed box queued while one is pending.
   */
  readonly resolveRegion?: (request: {
    /** Normalized canvas-local selection rectangle. */
    readonly rect: BoxSelectionRect;
    /** Completed box lifecycle event. */
    readonly event: ViewportInteractionBoxEvent;
    /** Requested target granularity. */
    readonly granularity: InteractionGranularity;
    /** World-space frustum derived from the rectangle. */
    readonly frustum: BoxSelectionFrustum;
  }) => Promise<readonly InteractionTarget[]>;
  /**
   * Replaces or suppresses the default immutable interaction transition. The
   * callback runs after candidate discovery; return `undefined` to leave the
   * viewport unchanged, or return a state (possibly asynchronously) to install.
   */
  readonly applyInteraction?: (
    request: ViewportInteractionApplyRequest,
  ) => ViewportInteractionApplyResult;
  /** Observes every box lifecycle event, including start/change/cancel. */
  readonly onBoxEvent?: (event: BoxSelectionEvent) => void;
  /** Observes a completed box after candidate discovery and validation. */
  readonly onBoxSelection?: (selection: ViewportInteractionBoxSelection) => void;
  /** Receives resolver and application failures without mutating valid state. */
  readonly onError?: (error: unknown, phase: ViewportInteractionPhase) => void;
}
