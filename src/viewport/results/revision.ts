import type { PartId } from "../../geometry/part";
import type { DeformationState } from "../../results/deform";
import type { OrientationRecordMap } from "../results-roles";
import { RevisedBindingMap, revisedResultBindings } from "./revision-bindings";
import type { ResultResolutionView } from "./resolution-view";
import type {
  ViewportDeformationConfig,
  ViewportResultsConfig,
  ViewportResultsState,
} from "../results-types";

/** Reuses valid shared deformation arrays when the authored field identity is unchanged. */
export function reusablePartDeformation(
  previous: ViewportResultsState | undefined,
  previousShared: DeformationState | undefined,
  config: ViewportDeformationConfig,
): ReadonlyMap<PartId, Float32Array> | undefined {
  const previousConfig = previous?.config.deformation;
  if (
    previousConfig === undefined ||
    previousShared === undefined ||
    previousConfig.field.count !== config.field.count ||
    previousConfig.field.values !== config.field.values
  ) {
    return undefined;
  }
  return new Map(
    [...previousShared.displacements].filter(
      (entry): entry is [PartId, Float32Array] => typeof entry[0] === "number",
    ),
  );
}

/** Retains untouched result arrays while replacing every revised part binding. */
export function reconcilePartRevisionDeformation(
  current: DeformationState | undefined,
  previous: DeformationState | undefined,
  view: ResultResolutionView,
  revisedPartIds: ReadonlySet<PartId>,
): DeformationState | undefined {
  if (current === undefined || previous === undefined) return current;
  const displacements = new RevisedBindingMap(
    previous.displacements,
    current.displacements,
    revisedResultBindings(view, revisedPartIds),
  );
  return { scale: current.scale, displacements };
}

/** Resolves only the shared deformation arrays affected by the definition revision. */
export function reconcileSharedPartRevisionDeformation(
  current: DeformationState | undefined,
  revisedPartIds: ReadonlySet<PartId>,
  resolve: (partId: PartId) => DeformationState | undefined,
): DeformationState | undefined {
  if (current === undefined) return current;
  const displacements = new Map(current.displacements);
  for (const partId of revisedPartIds) {
    const values = resolve(partId)?.displacements.get(partId);
    if (values !== undefined) displacements.set(partId, values);
  }
  return { scale: current.scale, displacements };
}

/** Replaces shared revised bindings in a state that also has occurrence overrides. */
export function replacePartRevisionDeformation(
  current: DeformationState | undefined,
  shared: DeformationState | undefined,
  config: ViewportResultsConfig,
  revisedPartIds: ReadonlySet<PartId>,
): DeformationState | undefined {
  if (current === undefined || shared === undefined) return current;
  if (!config.occurrences?.some((occurrence) => occurrence.deformation !== undefined))
    return shared;
  const displacements = new Map(current.displacements);
  for (const partId of revisedPartIds) {
    const values = shared.displacements.get(partId);
    if (values !== undefined) displacements.set(partId, scaledValues(values, shared.scale));
  }
  return { scale: current.scale, displacements };
}

/** Retains untouched elemental glyph record tables across one definition revision. */
export function reconcilePartRevisionRecords(
  current: OrientationRecordMap | undefined,
  previous: OrientationRecordMap | undefined,
  view: ResultResolutionView,
  revisedPartIds: ReadonlySet<PartId>,
): OrientationRecordMap | undefined {
  if (current === undefined || previous === undefined) return current;
  const records = new RevisedBindingMap(
    previous,
    current,
    revisedResultBindings(view, revisedPartIds),
  );
  return records;
}

function scaledValues(values: Float32Array, scale: number): Float32Array {
  return scale === 1 ? values : Float32Array.from(values, (value) => value * scale);
}
