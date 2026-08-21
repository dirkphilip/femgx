import { type InteractionGranularity, type PickHit } from "@/entries/root";
import {
  type InteractionState,
  type InteractionTarget,
  type ViewportInteractionApplyRequest,
  type ViewportInteractionBoxEvent,
} from "@/entries/interaction";
import type { BoxSelectionResolver } from "../selection/box-selection-resolver";
import type { ElementRegionSelection } from "@/entries/interaction";
import {
  selectTarget,
  targetKey,
  type SelectTarget,
  type SelectionGranularity,
} from "../selection/pick";
import { selectedTargetCount } from "@/interaction/selection-queries";
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
): Promise<{ readonly hit: PickHit | undefined; readonly target: SelectTarget | undefined }> {
  const granularity = request.granularity;
  const hit = await options
    .viewport()
    .interaction.pick(request.x, request.y, granularity === "edge" ? "edge" : undefined);
  const target =
    hit === undefined
      ? undefined
      : selectTarget(hit, granularity, {
          shiftKey: request.modifiers.shift,
          ctrlKey: request.modifiers.control,
          altKey: request.modifiers.alt,
          metaKey: request.modifiers.meta,
        });
  return { hit, target };
}

/** Resolves one completed box through the current workbench strategy. */
export function resolveViewportRegion(
  resolver: BoxSelectionResolver,
  event: ViewportInteractionBoxEvent,
  granularity: InteractionGranularity,
): Promise<ElementRegionSelection | readonly InteractionTarget[]> {
  return resolver({ event, granularity });
}

/** Applies the public installer's state through controller ownership. */
export function applyViewportInteraction(
  options: Pick<
    WorkbenchInteractionOptions,
    | "canvas"
    | "getInteraction"
    | "hoverOwnership"
    | "selectionFeedback"
    | "setInteraction"
    | "render"
  >,
  request: ViewportInteractionApplyRequest,
): InteractionState {
  if (request.phase === "hover") {
    if (request.target === undefined) options.hoverOwnership?.clear();
    else options.hoverOwnership?.mark();
    options.canvas.dataset["hovered"] = targetKey(request.target);
  } else {
    options.hoverOwnership?.clear();
    options.canvas.dataset["hovered"] = "";
  }
  const interaction = request.defaultInteraction;
  if (request.phase === "box") {
    const granularity = request.granularity;
    const selectedCount = selectedTargetCount(interaction, granularity);
    options.selectionFeedback?.(
      `Box selection: ${selectedCount} ${selectionNoun(granularity, selectedCount)}`,
    );
  }
  if (interaction !== request.current) {
    options.setInteraction(interaction);
    options.render();
  }
  return interaction;
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

function selectionNoun(granularity: SelectionGranularity, count: number): string {
  const noun = granularity === "element" ? "FE element" : granularity;
  return `${noun}${count === 1 ? "" : "s"}`;
}
