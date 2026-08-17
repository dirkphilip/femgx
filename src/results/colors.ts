import type { PartId } from "../geometry/part";

/** Dense renderer-owned scalar colors keyed by node pick id or private element ordinal. */
export interface ResultColorTable {
  readonly location: "nodal" | "elemental";
  readonly values: Float32Array;
}

/** Per-reusable-part scalar color tables for one resolved viewport result snapshot. */
export type ResultColorMap = ReadonlyMap<PartId, ResultColorTable>;
