import type { PartId } from "../../../geometry/part";
import { resultBindingValue } from "../../../results/bindings";

/** Resolves a shared or occurrence-specific cap result binding. */
export function sectionCapOccurrenceValue<Value>(
  source: ReadonlyMap<number | string, Value> | undefined,
  partId: PartId,
  occurrenceId: string,
): Value | undefined {
  return source === undefined ? undefined : resultBindingValue(source, partId, occurrenceId);
}
