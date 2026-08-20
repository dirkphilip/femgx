import { geometryUsesPartNodeTable, type Part, type PartId } from "../geometry/part";
import type { ResultColorMap, ResultColorTable } from "../results/colors";
import { elementalResultIndex, scalarAt, type ScalarField } from "../results/fields";
import { mapScalarToColor, type ScalarColorMap } from "../results/mapping";
import { getPartSemanticIndex } from "../geometry/part-semantic-index";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { Scene } from "../scene/scene";
import type { PartOccurrenceId } from "../scene/types";
import { renderedPartIds } from "./results-roles";
import type {
  ViewportResultField,
  ViewportResultsState,
  ViewportScalarState,
} from "./results-types";

const colorsByState = new WeakMap<ViewportResultsState, ResultColorMap | undefined>();
const partsByState = new WeakMap<ViewportResultsState, ReadonlyMap<PartId, Part> | undefined>();

/** One resolved scalar override targeted at a stable placed-part identity. */
export interface OccurrenceScalarBinding {
  readonly partOccurrenceId: PartOccurrenceId;
  readonly partId: PartId;
  readonly scalar: ViewportScalarState;
}

/** Returns the internal dense GPU color data for a resolved scalar field. */
export function viewportResultColors(state: ViewportResultsState): ResultColorMap | undefined {
  return colorsByState.get(state);
}

/** Retains unchanged per-binding table identities across an immutable part revision. */
export function reconcileViewportResultColors(
  state: ViewportResultsState,
  previous: ViewportResultsState,
  runtime: PackedSceneRuntime,
  revisedPartIds: ReadonlySet<PartId>,
): void {
  const current = colorsByState.get(state);
  const prior = colorsByState.get(previous);
  if (current === undefined || prior === undefined) return;
  const colors = new Map(current);
  for (const [bindingId, table] of prior) {
    if (!current.has(bindingId) || bindingUsesRevisedPart(bindingId, runtime, revisedPartIds)) {
      continue;
    }
    colors.set(bindingId, table);
  }
  colorsByState.set(state, colors);
}

/** Moves internal resolved color metadata to an equivalent immutable result state. */
export function transferViewportResultColors(
  source: ViewportResultsState,
  target: ViewportResultsState,
): void {
  colorsByState.set(target, colorsByState.get(source));
  partsByState.set(target, partsByState.get(source));
}

/** Derives or reuses one dense color table per reusable rendered part. */
export function resolveViewportResultColors(
  state: ViewportResultsState,
  scalar: ViewportScalarState | undefined,
  scene: Scene,
  runtime: PackedSceneRuntime,
  options: {
    readonly previous: ViewportResultsState | undefined;
    readonly occurrences: readonly OccurrenceScalarBinding[];
  },
): void {
  const { previous, occurrences } = options;
  const reusable =
    scalar === undefined ? undefined : reusableResultColors(previous, scalar, scene, runtime);
  const colors =
    scalar === undefined
      ? new Map<PartId | PartOccurrenceId, ResultColorTable>()
      : new Map(
          reusable ??
            buildResultColors(scalar.field, scalar.colorMap, scene, runtime, scalar.config.partId),
        );
  for (const occurrence of occurrences) {
    const table = buildResultColors(
      occurrence.scalar.field,
      occurrence.scalar.colorMap,
      scene,
      runtime,
      occurrence.partId,
    ).get(occurrence.partId);
    if (table !== undefined) colors.set(occurrence.partOccurrenceId, table);
  }
  colorsByState.set(state, colors.size === 0 ? undefined : colors);
  partsByState.set(
    state,
    scalar === undefined && occurrences.length === 0
      ? undefined
      : reusable === undefined
        ? renderedParts(scene, runtime, scalar?.config.partId)
        : previous === undefined
          ? undefined
          : partsByState.get(previous),
  );
}

/** Validates that every rendered semantic id is covered by the authored field. */
export function validateResultCoverage(
  field: ViewportResultField,
  scene: Scene,
  runtime: PackedSceneRuntime,
  partId?: PartId,
): void {
  if (field.location === "nodal") {
    validateNodalCoverage(field, scene, runtime, partId);
    return;
  }
  for (const renderedPartId of targetPartIds(runtime, partId)) {
    const part = scene.parts.get(renderedPartId);
    const elements = part?.elements;
    const metadata = part === undefined ? undefined : getPartSemanticIndex(part);
    for (const [ordinal, element] of elements?.entries() ?? []) {
      const privateOrdinal = metadata?.elementOrdinal(element.id);
      const index = elementalResultIndex(
        field,
        element.id,
        privateOrdinal === undefined ? ordinal : privateOrdinal - 1,
        elements?.count ?? 0,
        partId !== undefined,
      );
      if (index === undefined) validateElementId(field, renderedPartId, element.id);
    }
  }
}

/** Merges one part's node-pick identity coverage across primitive groups. */
export function mergedNodePickIds(part: Part): Uint32Array | undefined {
  const ids = new Set<number>();
  let hasNodeIds = false;
  for (const geometry of part.geometries) {
    const nodePickIds = geometry.nodePickIds;
    if (nodePickIds === undefined) continue;
    hasNodeIds = true;
    if (geometryUsesPartNodeTable(part, geometry)) {
      for (const vertex of geometry.indices) {
        const pickId = nodePickIds[vertex] ?? 0;
        if (pickId > 0) ids.add(pickId);
      }
    } else {
      for (const pickId of nodePickIds) if (pickId > 0) ids.add(pickId);
    }
  }
  return hasNodeIds ? Uint32Array.from(ids) : undefined;
}

/** Tests authored scalar storage identity for derived-table reuse. */
export function sameFieldSource(left: ViewportResultField, right: ViewportResultField): boolean {
  return (
    left.location === right.location && left.count === right.count && left.values === right.values
  );
}

function reusableResultColors(
  previous: ViewportResultsState | undefined,
  scalar: ViewportScalarState,
  scene: Scene,
  runtime: PackedSceneRuntime,
): ResultColorMap | undefined {
  if (
    previous?.scalar === undefined ||
    previous.scalar.colorMap !== scalar.colorMap ||
    previous.scalar.config.partId !== scalar.config.partId ||
    !sameFieldSource(previous.scalar.field, scalar.field) ||
    !sameRenderedParts(previous, scene, runtime)
  ) {
    return undefined;
  }
  const previousColors = viewportResultColors(previous);
  return previousColors === undefined
    ? undefined
    : new Map(
        [...previousColors].filter(
          (entry): entry is [PartId, ResultColorTable] => typeof entry[0] === "number",
        ),
      );
}

function sameRenderedParts(
  previous: ViewportResultsState,
  scene: Scene,
  runtime: PackedSceneRuntime,
): boolean {
  const sources = partsByState.get(previous);
  const partIds = renderedPartIds(runtime);
  if (sources === undefined || sources.size !== partIds.size) return false;
  for (const partId of partIds) {
    if (sources.get(partId) !== scene.parts.get(partId)) return false;
  }
  return true;
}

function bindingUsesRevisedPart(
  bindingId: PartId | PartOccurrenceId,
  runtime: PackedSceneRuntime,
  revisedPartIds: ReadonlySet<PartId>,
): boolean {
  if (typeof bindingId === "number") return revisedPartIds.has(bindingId);
  const slot = runtime.getInstanceSlot(bindingId);
  const partId = slot === undefined ? undefined : runtime.getPartId(slot);
  return partId === undefined || revisedPartIds.has(partId);
}

function renderedParts(
  scene: Scene,
  runtime: PackedSceneRuntime,
  partId?: PartId,
): ReadonlyMap<PartId, Part> {
  const parts = new Map<PartId, Part>();
  for (const renderedPartId of targetPartIds(runtime, partId)) {
    const part = scene.parts.get(renderedPartId);
    if (part !== undefined) parts.set(renderedPartId, part);
  }
  return parts;
}

function buildResultColors(
  field: ViewportResultField,
  colorMap: ScalarColorMap,
  scene: Scene,
  runtime: PackedSceneRuntime,
  partId?: PartId,
): ResultColorMap {
  return field.location === "nodal"
    ? buildNodalResultColors(field, colorMap, scene, runtime, partId)
    : buildElementalResultColors(field, colorMap, scene, runtime, partId);
}

function buildElementalResultColors(
  field: ScalarField<"elemental">,
  colorMap: ScalarColorMap,
  scene: Scene,
  runtime: PackedSceneRuntime,
  partId?: PartId,
): ResultColorMap {
  const colors = new Map<PartId, ResultColorTable>();
  for (const renderedPartId of targetPartIds(runtime, partId)) {
    const part = scene.parts.get(renderedPartId);
    if (part === undefined || part.elements === undefined || part.elements.count === 0) continue;
    const elements = part.elements;
    const metadata = getPartSemanticIndex(part);
    const values = new Float32Array((elements.count + 1) * 4);
    for (const [index, element] of elements.entries()) {
      const privateOrdinal = metadata.elementOrdinal(element.id);
      const fieldIndex = elementalResultIndex(
        field,
        element.id,
        privateOrdinal === undefined ? index : privateOrdinal - 1,
        elements.count,
        partId !== undefined,
      );
      const color = mapScalarToColor(
        colorMap,
        fieldIndex === undefined ? NaN : scalarAt(field, fieldIndex),
      );
      const offset = (index + 1) * 4;
      values[offset] = color.r;
      values[offset + 1] = color.g;
      values[offset + 2] = color.b;
      values[offset + 3] = color.a;
    }
    colors.set(renderedPartId, { location: "elemental", values });
  }
  if (colors.size === 0) {
    throw new Error(`Viewport results field ${field.id} has no element-bearing part in the scene`);
  }
  return colors;
}

function buildNodalResultColors(
  field: ScalarField<"nodal">,
  colorMap: ScalarColorMap,
  scene: Scene,
  runtime: PackedSceneRuntime,
  partId?: PartId,
): ResultColorMap {
  const colors = new Map<PartId, ResultColorTable>();
  for (const renderedPartId of targetPartIds(runtime, partId)) {
    const part = scene.parts.get(renderedPartId);
    const nodePickIds = part === undefined ? undefined : mergedNodePickIds(part);
    if (nodePickIds === undefined) continue;
    const data = new Float32Array((maxNodePickId(nodePickIds) + 1) * 4);
    for (const pickId of nodePickIds) {
      const color = mapScalarToColor(colorMap, scalarAt(field, pickId - 1));
      const offset = pickId * 4;
      data[offset] = color.r;
      data[offset + 1] = color.g;
      data[offset + 2] = color.b;
      data[offset + 3] = color.a;
    }
    colors.set(renderedPartId, { location: "nodal", values: data });
  }
  return colors;
}

function validateElementId(
  field: ScalarField<"elemental">,
  partId: PartId,
  elementId: number,
): void {
  if (!Number.isInteger(elementId) || elementId < 0 || elementId >= field.count) {
    throw new Error(
      `Viewport results field ${field.id} (count ${field.count}) has no value for element ${elementId} in part ${partId}`,
    );
  }
}

function validateNodalCoverage(
  field: ScalarField<"nodal">,
  scene: Scene,
  runtime: PackedSceneRuntime,
  partId?: PartId,
): void {
  for (const renderedPartId of targetPartIds(runtime, partId)) {
    const part = scene.parts.get(renderedPartId);
    const nodePickIds = part === undefined ? undefined : mergedNodePickIds(part);
    if (part === undefined || nodePickIds === undefined) {
      throw new Error(
        `Viewport nodal results field ${field.id} cannot map part ${renderedPartId}: geometry has no nodePickIds`,
      );
    }
    for (const pickId of nodePickIds) {
      if (!Number.isInteger(pickId) || pickId <= 0 || pickId > field.count) {
        throw new Error(
          `Viewport nodal results field ${field.id} (count ${field.count}) has no value for node pick id ${pickId} in part ${renderedPartId}`,
        );
      }
    }
  }
}

function targetPartIds(runtime: PackedSceneRuntime, partId?: PartId): ReadonlySet<PartId> {
  const rendered = renderedPartIds(runtime);
  if (partId === undefined) return rendered;
  if (!rendered.has(partId)) {
    throw new Error(`Viewport scalar part ${partId} is not rendered by the current runtime`);
  }
  return new Set([partId]);
}

function maxNodePickId(nodePickIds: Uint32Array): number {
  let max = 0;
  for (const pickId of nodePickIds) max = Math.max(max, pickId);
  return max;
}
