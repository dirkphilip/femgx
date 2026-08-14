import type { FieldLocation } from "./fields";
import type { ResultField } from "./fields";

/**
 * A closed value range `[min, max]` from observed finite data.
 * @category Results
 */
export interface ValueRange {
  readonly min: number;
  readonly max: number;
}

/**
 * Returns the min/max of the finite values in `values`. `NaN` and infinities
 * are skipped (they mark missing or invalid data), so a range can be computed
 * even when the field contains missing values. Returns `undefined` when no
 * finite value exists.
 * @category Results
 */
export function finiteRange(values: ArrayLike<number>): ValueRange | undefined {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value !== undefined && Number.isFinite(value)) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  return Number.isFinite(min) ? { min, max } : undefined;
}

/**
 * Returns the observed range of a scalar field, ignoring missing values.
 * @category Results
 */
export function scalarRange<L extends FieldLocation>(
  field: ResultField<"scalar", L>,
): ValueRange | undefined {
  return finiteRange(field.values);
}
