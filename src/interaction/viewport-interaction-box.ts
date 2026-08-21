import { boxSelectionFrustum, type BoxSelectionFrustum } from "./box-frustum";
import { assertTarget } from "./viewport-interaction-helpers";
import {
  assertElementRegionSelection,
  type ElementRegionSelection,
} from "./element-region-selection";
import type { InteractionTarget } from "./target-types";
import type { InteractionGranularity } from "../picking/types";
import type {
  ViewportInteractionBoxEvent,
  ViewportInteractionOptions,
} from "./viewport-interaction-types";

/** Resolves and validates one completed region query at the host boundary. */
export async function resolveBoxRegion(
  options: ViewportInteractionOptions,
  event: ViewportInteractionBoxEvent,
  granularity: InteractionGranularity,
): Promise<{
  readonly frustum: BoxSelectionFrustum;
  readonly result: ElementRegionSelection | readonly InteractionTarget[];
}> {
  const frustum = boxSelectionFrustum(options.viewport.view.camera, event.rect);
  const result = options.resolveRegion
    ? await options.resolveRegion({ rect: event.rect, event, granularity, frustum })
    : await options.viewport.interaction.pickRegion(event.rect, granularity);
  if (granularity === "element") assertElementRegionSelection(elementRegion(result));
  else for (const target of targetList(result)) assertTarget(target, granularity);
  return { frustum, result };
}

/** Narrows the optimized element result after validating its public discriminator. */
export function elementRegion(
  result: ElementRegionSelection | readonly InteractionTarget[],
): ElementRegionSelection {
  if (isTargetList(result))
    throw new TypeError("Element region resolver must return an ElementRegionSelection");
  return result;
}

/** Narrows a descriptor-region result for non-element granularities. */
export function targetList(
  result: ElementRegionSelection | readonly InteractionTarget[],
): readonly InteractionTarget[] {
  if (!isTargetList(result))
    throw new TypeError("Non-element region resolver must return interaction targets");
  return result;
}

/** Narrows non-element discovery to its retained descriptor list. */
function isTargetList(
  result: ElementRegionSelection | readonly InteractionTarget[],
): result is readonly InteractionTarget[] {
  return Array.isArray(result);
}
