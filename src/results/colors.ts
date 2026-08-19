import type { ResultBindingId } from "./bindings";

/** Dense renderer-owned scalar colors keyed by node pick id or private element ordinal. */
export interface ResultColorTable {
  readonly location: "nodal" | "elemental";
  readonly values: Float32Array;
}

/** Shared per-part tables plus optional occurrence overrides for one result snapshot. */
export type ResultColorMap = ReadonlyMap<ResultBindingId, ResultColorTable>;
