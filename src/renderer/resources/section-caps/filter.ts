import type { Part, PartId } from "../../../geometry/part";
import { getPartSemanticIndex } from "../../../geometry/part-semantic-index";
import type { InteractionState } from "../../../interaction/interaction";
import type { ResultColorTable } from "../../../results/colors";
import type { PackedSceneRuntime } from "../../../scene-runtime/runtime";
import type { DrawResources } from "../draw-resources";
import { registerSectionCapOwner } from "./section-cap-ownership";
import {
  appendCapCall,
  capElementVisible,
  capStyle,
  type CapCallLists,
  type SectionCapFrame,
} from "../../section-caps";
import { instanceAt } from "../../runtime-state";

/** Filters retained cap records when visibility can only remove elements. */
export function filterSectionCapFrame(options: {
  readonly frame: SectionCapFrame;
  readonly runtime: PackedSceneRuntime;
  readonly parts: ReadonlyMap<PartId, Part>;
  readonly interaction: InteractionState;
  readonly draw: DrawResources;
}): SectionCapFrame {
  const next = emptyFrame(options.frame.nextCapId);
  for (const [capId, capPart] of options.frame.parts) {
    const sourcePartId = options.frame.sourcePartIds.get(capId);
    const sourceSlot = options.frame.sourceSlots.get(capId);
    const sourcePart = sourcePartId === undefined ? undefined : options.parts.get(sourcePartId);
    const element = capPart.elements?.at(0);
    if (
      sourcePartId === undefined ||
      sourcePart === undefined ||
      sourceSlot === undefined ||
      element === undefined
    )
      continue;
    const metadata = getPartSemanticIndex(sourcePart);
    const instance = instanceAt(options.runtime, sourceSlot, sourcePart.id);
    if (!capElementVisible(options.interaction, instance.partOccurrenceId, element, metadata))
      continue;
    next.parts.set(capId, capPart);
    next.sourcePartIds.set(capId, sourcePartId);
    registerSectionCapOwner(next.sourceCapIds, sourcePartId, capId);
    next.sourceSlots.set(capId, sourceSlot);
    appendCapCall(
      options.draw,
      capId,
      capStyle(options.interaction, instance, element.id, metadata),
      sourceSlot,
      next.calls,
    );
    const colors = options.frame.resultColors.get(capId);
    if (colors !== undefined) next.resultColors.set(capId, colors);
  }
  return {
    parts: next.parts,
    sourcePartIds: next.sourcePartIds,
    sourceCapIds: next.sourceCapIds,
    sourceSlots: next.sourceSlots,
    calls: next.calls.opaque,
    transparentCalls: next.calls.transparent,
    allCalls: next.calls.all,
    resultColors: next.resultColors,
    nextCapId: options.frame.nextCapId,
  };
}

function emptyFrame(nextCapId: PartId) {
  return {
    parts: new Map<PartId, Part>(),
    sourcePartIds: new Map<PartId, PartId>(),
    sourceCapIds: new Map<PartId, Set<PartId>>(),
    sourceSlots: new Map<PartId, number>(),
    calls: { opaque: [], transparent: [], all: [] } satisfies CapCallLists,
    resultColors: new Map<PartId, ResultColorTable>(),
    nextCapId,
  };
}
