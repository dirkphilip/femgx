import {
  type InteractionGranularity,
  type InteractionTarget,
  type ViewportInteractionApplyRequest,
  type ViewportInteractionBoxEvent,
} from "../../../src/entries/root";
import type { BoxSelectionResolver } from "../selection/box-selection-resolver";
import {
  selectTarget,
  targetKey,
  type SelectTarget,
  type SelectionGranularity,
} from "../selection/pick";
import { selectedTargetCount } from "../../../src/interaction/selection-queries";
import type { WorkbenchInteractionOptions } from "./interaction";

/** Resolves one point with the workbench's modifier-aware target policy. */
export async function resolveViewportPoint(
  options: Pick<WorkbenchInteractionOptions, "viewport">,
  request: {
    readonly x: number;
    readonly y: number;
    readonly granularity: InteractionGranularity;
    readonly modifiers: {
      readonly shift: boolean;
      readonly control: boolean;
      readonly alt: boolean;
      readonly meta: boolean;
    };
  },
): Promise<SelectTarget | undefined> {
  const granularity = selectionGranularity(request.granularity);
  const hit = await options
    .viewport()
    .pick(request.x, request.y, granularity === "edge" ? "edge" : undefined);
  return hit === undefined
    ? undefined
    : selectTarget(hit, granularity, {
        shiftKey: request.modifiers.shift,
        ctrlKey: request.modifiers.control,
        altKey: request.modifiers.alt,
        metaKey: request.modifiers.meta,
      });
}

/** Resolves one completed box through the current workbench strategy. */
export function resolveViewportRegion(
  resolver: BoxSelectionResolver,
  event: ViewportInteractionBoxEvent,
  granularity: InteractionGranularity,
): Promise<readonly InteractionTarget[]> {
  return resolver({ event, granularity: selectionGranularity(granularity) });
}

/** Applies the public installer's state through controller ownership. */
export function applyViewportInteraction(
  options: Pick<
    WorkbenchInteractionOptions,
    "canvas" | "hoverOwnership" | "selectionFeedback" | "setInteraction" | "render"
  >,
  request: ViewportInteractionApplyRequest,
): undefined {
  if (request.phase === "hover") {
    if (request.target === undefined) options.hoverOwnership?.clear();
    else options.hoverOwnership?.mark();
    options.canvas.dataset["hovered"] = targetKey(request.target);
  }
  if (request.phase === "box") {
    const granularity = selectionGranularity(request.granularity);
    const selectedCount = selectedTargetCount(request.defaultInteraction, granularity);
    options.selectionFeedback?.(
      `Box selection: ${selectedCount} ${selectionNoun(granularity, selectedCount)}`,
    );
  }
  options.setInteraction(request.defaultInteraction);
  options.render();
  return undefined;
}

/** Reports a binding failure through the workbench's existing feedback surface. */
export function reportViewportInteractionError(
  options: Pick<WorkbenchInteractionOptions, "selectionFeedback">,
  error: unknown,
  phase: string,
): void {
  const detail = error instanceof Error ? error.message : String(error);
  options.selectionFeedback?.(`Viewport ${phase} interaction failed: ${detail}`);
}

function selectionGranularity(value: InteractionGranularity): SelectionGranularity {
  if (
    value === "body" ||
    value === "element" ||
    value === "face" ||
    value === "node" ||
    value === "edge"
  ) {
    return value;
  }
  throw new TypeError(`Workbench interaction does not support ${value} granularity`);
}

function selectionNoun(granularity: SelectionGranularity, count: number): string {
  const noun = granularity === "element" ? "FE element" : granularity;
  return `${noun}${count === 1 ? "" : "s"}`;
}
