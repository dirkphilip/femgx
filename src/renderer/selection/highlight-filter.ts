import type { Part, PartId } from "../../geometry/part";
import { getPartSemanticIndex } from "../../geometry/part-semantic-index";
import type { InteractionState } from "../../interaction/interaction";
import { readInteractionState } from "../../interaction/state";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { EmphasisUpdate } from "../resources/element-resources";
import type { DenseElementLayout, DenseElementSelection } from "./element-selection";
import { denseSelectionContains } from "./element-selection";

interface SparseUpdateOptions {
  readonly partId: PartId;
  readonly updates: readonly EmphasisUpdate[];
  readonly selection: DenseElementSelection | undefined;
  readonly runtime: PackedSceneRuntime;
  readonly layout: DenseElementLayout;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly interaction: InteractionState;
}

/** Omits sparse selected records already represented by dense membership. */
export function sparseUpdatesForPart(options: SparseUpdateOptions): readonly EmphasisUpdate[] {
  if (options.selection === undefined) return options.updates;
  const part = options.parts.get(options.partId);
  if (part === undefined) return options.updates;
  const metadata = getPartSemanticIndex(part);
  const data = readInteractionState(options.interaction);
  const globalSlots = options.layout.partLocalSlots.get(options.partId);
  return options.updates.filter((update) => {
    if (update.selected !== true || update.elementPickId === 0) return true;
    const elementId = update.elementPickId - 1;
    const ordinal = metadata.elementOrdinalById.get(elementId);
    if (ordinal === undefined || !denseSelectionContains(options.selection, update.slot, ordinal)) {
      return true;
    }
    const globalSlot = globalSlots?.[update.slot];
    const instanceId =
      globalSlot === undefined || globalSlot < 0
        ? undefined
        : options.runtime.getInstanceId(globalSlot);
    if (instanceId === undefined) return true;
    return (
      update.hidden === true ||
      data.highlightedElementIds.get(instanceId)?.has(elementId) === true ||
      data.hiddenElementIds.get(instanceId)?.has(elementId) === true ||
      data.elementOverrides.get(instanceId)?.has(elementId) === true ||
      (data.hoveredTarget?.kind === "element" &&
        data.hoveredTarget.partOccurrenceId === instanceId &&
        data.hoveredTarget.elementId === elementId)
    );
  });
}
