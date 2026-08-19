import type { PartId } from "../geometry/part";

/** Private renderer addressing for shared part data and occurrence overrides. */
export type ResultBindingId = PartId | string;

/** Resolves an occurrence override before the reusable part's shared value. */
export function resultBindingValue<Value>(
  values: ReadonlyMap<ResultBindingId, Value>,
  partId: PartId,
  partOccurrenceId: string,
): Value | undefined {
  return values.get(partOccurrenceId) ?? values.get(partId);
}
