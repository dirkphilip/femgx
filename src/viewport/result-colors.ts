import type { Part, PartId } from "../geometry/part";
import type { ResultColorMap, ResultColorTable } from "../results/colors";
import { scalarAt, type ScalarField } from "../results/fields";
import { mapScalar, type ScalarColorMap } from "../results/mapping";
import type { PackedSceneRuntime } from "../scene-runtime/runtime";
import type { Scene } from "../scene/scene";
import { renderedPartIds } from "./results-roles";
import type {
  ViewportResultField,
  ViewportResultsState,
  ViewportScalarState,
} from "./results-types";

const colorsByState = new WeakMap<ViewportResultsState, ResultColorMap | undefined>();
const partsByState = new WeakMap<ViewportResultsState, ReadonlyMap<PartId, Part> | undefined>();

/** Returns the internal dense GPU color data for a resolved scalar field. */
export function viewportResultColors(state: ViewportResultsState): ResultColorMap | undefined {
  return colorsByState.get(state);
}

/** Derives or reuses one dense color table per reusable rendered part. */
export function resolveViewportResultColors(
  state: ViewportResultsState,
  scalar: ViewportScalarState | undefined,
  scene: Scene,
  runtime: PackedSceneRuntime,
  previous: ViewportResultsState | undefined,
): void {
  const reusable =
    scalar === undefined ? undefined : reusableResultColors(previous, scalar, scene, runtime);
  colorsByState.set(
    state,
    scalar === undefined
      ? undefined
      : (reusable ?? buildResultColors(scalar.field, scalar.colorMap, scene, runtime)),
  );
  partsByState.set(
    state,
    scalar === undefined
      ? undefined
      : reusable === undefined
        ? renderedParts(scene, runtime)
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
): void {
  if (field.location === "nodal") {
    validateNodalCoverage(field, scene, runtime);
    return;
  }
  for (const partId of renderedPartIds(runtime)) {
    for (const element of scene.parts.get(partId)?.elements ?? []) {
      validateElementId(field, partId, element.id);
    }
  }
}

/** Merges one part's node-pick identity coverage across primitive groups. */
export function mergedNodePickIds(part: Part): Uint32Array | undefined {
  const ids = new Set<number>();
  let hasNodeIds = false;
  for (const geometry of part.geometries) {
    if (geometry.nodePickIds !== undefined) hasNodeIds = true;
    for (const pickId of geometry.nodePickIds ?? []) ids.add(pickId);
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
    !sameFieldSource(previous.scalar.field, scalar.field) ||
    !sameRenderedParts(previous, scene, runtime)
  ) {
    return undefined;
  }
  return viewportResultColors(previous);
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

function renderedParts(scene: Scene, runtime: PackedSceneRuntime): ReadonlyMap<PartId, Part> {
  const parts = new Map<PartId, Part>();
  for (const partId of renderedPartIds(runtime)) {
    const part = scene.parts.get(partId);
    if (part !== undefined) parts.set(partId, part);
  }
  return parts;
}

function buildResultColors(
  field: ViewportResultField,
  colorMap: ScalarColorMap,
  scene: Scene,
  runtime: PackedSceneRuntime,
): ResultColorMap {
  return field.location === "nodal"
    ? buildNodalResultColors(field, colorMap, scene, runtime)
    : buildElementalResultColors(field, colorMap, scene, runtime);
}

function buildElementalResultColors(
  field: ScalarField<"elemental">,
  colorMap: ScalarColorMap,
  scene: Scene,
  runtime: PackedSceneRuntime,
): ResultColorMap {
  const colors = new Map<PartId, ResultColorTable>();
  for (const partId of renderedPartIds(runtime)) {
    const elements = scene.parts.get(partId)?.elements;
    if (elements === undefined || elements.length === 0) continue;
    const values = new Float32Array((elements.length + 1) * 4);
    for (const [index, element] of elements.entries()) {
      const color = mapScalar(colorMap, scalarAt(field, element.id));
      const offset = (index + 1) * 4;
      values[offset] = color.r;
      values[offset + 1] = color.g;
      values[offset + 2] = color.b;
      values[offset + 3] = color.a;
    }
    colors.set(partId, { location: "elemental", values });
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
): ResultColorMap {
  const colors = new Map<PartId, ResultColorTable>();
  for (const partId of renderedPartIds(runtime)) {
    const part = scene.parts.get(partId);
    const nodePickIds = part === undefined ? undefined : mergedNodePickIds(part);
    if (nodePickIds === undefined) continue;
    const data = new Float32Array((maxNodePickId(nodePickIds) + 1) * 4);
    for (const pickId of nodePickIds) {
      const color = mapScalar(colorMap, scalarAt(field, pickId - 1));
      const offset = pickId * 4;
      data[offset] = color.r;
      data[offset + 1] = color.g;
      data[offset + 2] = color.b;
      data[offset + 3] = color.a;
    }
    colors.set(partId, { location: "nodal", values: data });
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
): void {
  for (const partId of renderedPartIds(runtime)) {
    const part = scene.parts.get(partId);
    const nodePickIds = part === undefined ? undefined : mergedNodePickIds(part);
    if (part === undefined || nodePickIds === undefined) {
      throw new Error(
        `Viewport nodal results field ${field.id} cannot map part ${partId}: geometry has no nodePickIds`,
      );
    }
    for (const pickId of nodePickIds) {
      if (!Number.isInteger(pickId) || pickId <= 0 || pickId > field.count) {
        throw new Error(
          `Viewport nodal results field ${field.id} (count ${field.count}) has no value for node pick id ${pickId} in part ${partId}`,
        );
      }
    }
  }
}

function maxNodePickId(nodePickIds: Uint32Array): number {
  let max = 0;
  for (const pickId of nodePickIds) max = Math.max(max, pickId);
  return max;
}
