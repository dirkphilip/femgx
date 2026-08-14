import type { ElementBlockId } from "../elements/model";
import type { InstanceId } from "../scene/types";
import {
  isHoveredTarget,
  readInteractionState,
  updateInteractionState,
  type InteractionState,
  type PrimitiveStyleOverride,
  validatePrimitiveStyleOverride,
} from "./state";
import { collectUniqueRefs, sortedNumbers, updateNestedMap, updateNestedSet } from "./mechanics";
import type { ElementBlockRef } from "./refs";

/** Sets or clears one element-block selection without mutating prior state. */
export function setElementBlockSelected(
  state: InteractionState,
  ref: ElementBlockRef,
  selected: boolean,
): InteractionState {
  return updateBlockSet(state, "selectedBlockIds", ref, selected);
}

/** Sets or clears one element-block highlight without mutating prior state. */
export function setElementBlockHighlighted(
  state: InteractionState,
  ref: ElementBlockRef,
  highlighted: boolean,
): InteractionState {
  return updateBlockSet(state, "highlightedBlockIds", ref, highlighted);
}

/** Sets one element block's visibility for one repeated part occurrence. */
export function setElementBlockVisible(
  state: InteractionState,
  ref: ElementBlockRef,
  visible: boolean,
): InteractionState {
  return updateBlockSet(state, "hiddenBlockIds", ref, !visible);
}

/** Returns whether an element block occurrence is visible. */
export function isElementBlockVisible(state: InteractionState, ref: ElementBlockRef): boolean {
  return readInteractionState(state).hiddenBlockIds.get(ref.instanceId)?.has(ref.blockId) !== true;
}

/** Adds or replaces an explicit element-block style override. */
export function setElementBlockOverride(
  state: InteractionState,
  ref: ElementBlockRef,
  override: PrimitiveStyleOverride | undefined,
): InteractionState {
  validatePrimitiveStyleOverride(override);
  const data = readInteractionState(state);
  const blockOverrides = updateNestedMap(
    data.blockOverrides,
    ref.instanceId,
    ref.blockId,
    override,
  );
  if (blockOverrides === data.blockOverrides) return state;
  return updateInteractionState(state, { blockOverrides });
}

/** Returns whether an element block occurrence carries any interaction state. */
export function isElementBlockEmphasized(state: InteractionState, ref: ElementBlockRef): boolean {
  const data = readInteractionState(state);
  return (
    data.hiddenBlockIds.get(ref.instanceId)?.has(ref.blockId) === true ||
    data.highlightedBlockIds.get(ref.instanceId)?.has(ref.blockId) === true ||
    data.selectedBlockIds.get(ref.instanceId)?.has(ref.blockId) === true ||
    data.blockOverrides.get(ref.instanceId)?.has(ref.blockId) === true ||
    isHoveredTarget(state, { kind: "block", ...ref })
  );
}

/** Collects emphasized block occurrences in stable instance/block order. */
export function emphasizedElementBlockRefs(state: InteractionState): readonly ElementBlockRef[] {
  const data = readInteractionState(state);
  return collectUniqueRefs(
    data.hoveredTarget?.kind === "block"
      ? { instanceId: data.hoveredTarget.instanceId, blockId: data.hoveredTarget.blockId }
      : undefined,
    (ref) => `${ref.instanceId}/${ref.blockId}`,
    (push) => {
      const maps: readonly ReadonlyMap<InstanceId, ReadonlySet<ElementBlockId>>[] = [
        data.highlightedBlockIds,
        data.selectedBlockIds,
        data.hiddenBlockIds,
      ];
      for (const map of maps) {
        for (const [instanceId, ids] of sortedMap(map)) {
          for (const blockId of sortedNumbers(ids)) push({ instanceId, blockId });
        }
      }
      for (const [instanceId, overrides] of sortedMap(data.blockOverrides)) {
        for (const blockId of sortedNumbers(overrides.keys())) push({ instanceId, blockId });
      }
    },
  );
}

function updateBlockSet(
  state: InteractionState,
  key: "selectedBlockIds" | "highlightedBlockIds" | "hiddenBlockIds",
  ref: ElementBlockRef,
  enabled: boolean,
): InteractionState {
  const data = readInteractionState(state);
  const next = updateNestedSet(data[key], ref.instanceId, ref.blockId, enabled);
  if (next === data[key]) return state;
  return updateInteractionState(state, { [key]: next });
}

type BlockValues = { readonly keys: () => Iterable<ElementBlockId> };

function sortedMap<V extends BlockValues>(
  map: ReadonlyMap<InstanceId, V>,
): Array<readonly [InstanceId, V]> {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}
