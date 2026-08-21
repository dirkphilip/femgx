import type { PartId } from "../../geometry/part";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";
import type { ViewportOccurrenceResultsConfig, ViewportResultsConfig } from "../results-types";

/** Narrows one retained result snapshot to bindings owned by revised definitions. */
export function scopedPartRevisionConfig(
  config: ViewportResultsConfig,
  runtime: PackedSceneRuntime,
  revisedPartIds: ReadonlySet<PartId>,
): ViewportResultsConfig | undefined {
  const applies = (partId: PartId | undefined): boolean =>
    partId === undefined || revisedPartIds.has(partId);
  const occurrences = revisionOccurrences(config.occurrences, runtime, revisedPartIds);
  const scalar = applies(config.scalar?.partId) ? config.scalar : undefined;
  const orientation =
    config.orientation === undefined ||
    applies(
      config.orientation.glyph === "triad"
        ? config.orientation.field.partId
        : config.orientation.partId,
    )
      ? config.orientation
      : undefined;
  const loads = applies(config.loads?.field.partId) ? config.loads : undefined;
  const shared = {
    ...(config.deformation === undefined ? {} : { deformation: config.deformation }),
    ...(orientation === undefined ? {} : { orientation }),
    ...(loads === undefined ? {} : { loads }),
    ...(occurrences === undefined ? {} : { occurrences }),
  };
  if (scalar !== undefined) return { ...shared, scalar };
  if (config.deformation !== undefined) return { ...shared, deformation: config.deformation };
  if (orientation !== undefined) return { ...shared, orientation };
  if (loads !== undefined) return { ...shared, loads };
  return occurrences === undefined ? undefined : { occurrences };
}

/** Exposes revised slots as a compact runtime without copying the real packed runtime. */
export function partRevisionRuntime(
  runtime: PackedSceneRuntime,
  revisedPartIds: ReadonlySet<PartId>,
): PackedSceneRuntime {
  const slots: number[] = [];
  const slotByInstanceId = new Map<string, number>();
  for (const partId of revisedPartIds) {
    for (const slot of runtime.getPartInstanceSlots(partId)) {
      const instanceId = runtime.getInstanceId(slot);
      if (instanceId !== undefined) slotByInstanceId.set(instanceId, slots.length);
      slots.push(slot);
    }
  }
  return new Proxy(runtime, {
    get(target, key, receiver): unknown {
      if (key === "instanceCount") return slots.length;
      if (key === "getPartId") return (slot: number) => target.getPartId(slots[slot] ?? -1);
      if (key === "getInstanceId") return (slot: number) => target.getInstanceId(slots[slot] ?? -1);
      if (key === "getInstanceSlot") return (id: string) => slotByInstanceId.get(id);
      if (key === "isInstanceVisible")
        return (slot: number) => target.isInstanceVisible(slots[slot] ?? -1);
      if (key === "instancePartIds") {
        return Int32Array.from(slots, (slot) => target.instancePartIds[slot] ?? -1);
      }
      const value: unknown = Reflect.get(target, key, receiver);
      return value;
    },
  });
}

function revisionOccurrences(
  occurrences: readonly ViewportOccurrenceResultsConfig[] | undefined,
  runtime: PackedSceneRuntime,
  revisedPartIds: ReadonlySet<PartId>,
): [ViewportOccurrenceResultsConfig, ...ViewportOccurrenceResultsConfig[]] | undefined {
  if (occurrences === undefined) return undefined;
  const revised = occurrences.filter((occurrence) => {
    const slot = runtime.getInstanceSlot(occurrence.partOccurrenceId);
    const partId = slot === undefined ? undefined : runtime.getPartId(slot);
    return partId !== undefined && revisedPartIds.has(partId);
  });
  const first = revised[0];
  return first === undefined ? undefined : [first, ...revised.slice(1)];
}
