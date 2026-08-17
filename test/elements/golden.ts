/**
 * Canonical element conventions assembled from owning family fixtures.
 * The individual modules keep each element family discoverable without duplicating the reference data.
 */
import type { GoldenElementConvention } from "./golden/types";
import { pointLineConventions } from "./golden/point-line";
import { surfaceConventions } from "./golden/surface";
import { solidLinearConventions } from "./golden/solid-linear";
import { solidQuadraticConventions } from "./golden/solid-quadratic";

export type { GoldenBounds, GoldenElementConvention } from "./golden/types";

export const GOLDEN_ELEMENT_CONVENTIONS: readonly GoldenElementConvention[] = [
  ...solidLinearConventions.slice(0, 2),
  ...pointLineConventions,
  ...surfaceConventions,
  ...solidLinearConventions.slice(2, 3),
  ...solidQuadraticConventions.slice(0, 1),
  ...solidLinearConventions.slice(3, 4),
  ...solidQuadraticConventions.slice(1),
];
