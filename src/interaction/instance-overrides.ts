import type { InstanceId } from "../scene/types";
import {
  readInteractionState,
  updateInteractionState,
  validateStyleOverride,
  type InteractionState,
  type StyleOverride,
} from "./state";

/**
 * Applies instance style overrides in one immutable state transition.
 * Duplicate ids use the last supplied value; `undefined` clears an override.
 * @category Interaction and picking
 */
export function setInstanceOverrides(
  state: InteractionState,
  overrides: Iterable<readonly [InstanceId, StyleOverride | undefined]>,
): InteractionState {
  const requested = new Map<InstanceId, StyleOverride | undefined>();
  for (const [instanceId, override] of overrides) {
    validateStyleOverride(override);
    requested.set(instanceId, override);
  }
  const data = readInteractionState(state);
  let changed = false;
  for (const [instanceId, override] of requested) {
    if (
      (override === undefined && data.instanceOverrides.has(instanceId)) ||
      (override !== undefined && data.instanceOverrides.get(instanceId) !== override)
    ) {
      changed = true;
      break;
    }
  }
  if (!changed) return state;
  const instanceOverrides = new Map(data.instanceOverrides);
  for (const [instanceId, override] of requested) {
    if (override === undefined) instanceOverrides.delete(instanceId);
    else instanceOverrides.set(instanceId, override);
  }
  return updateInteractionState(state, { instanceOverrides });
}
