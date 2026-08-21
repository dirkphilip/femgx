import type { PartId } from "../../geometry/part";
import type { ResultBindingId } from "../../results/bindings";
import type { PackedSceneRuntime } from "../../scene-runtime/runtime";

/** Stable part-local occurrence addressing needed to pack result tables. */
export interface ResultBindingLayout {
  readonly slotPartLocal: Int32Array;
  readonly partLocalSlots: ReadonlyMap<PartId, Int32Array>;
}

/** One part's effective shared/overridden value at every retained local slot. */
export interface PartResultBindings<Value> {
  readonly partId: PartId;
  readonly values: readonly (Value | undefined)[];
}

/** Resolves stable occurrence overrides into dense part-local slots. */
export function partResultBindings<Value>(
  source: ReadonlyMap<ResultBindingId, Value>,
  runtime: PackedSceneRuntime,
  layout: ResultBindingLayout,
  partScope?: ReadonlySet<PartId>,
): readonly PartResultBindings<Value>[] {
  const overrides = occurrenceOverrides(source, runtime, layout, partScope);
  const partIds = new Set<PartId>(partScope ?? runtime.sortedPartIds);
  for (const binding of source.keys()) {
    if (typeof binding === "number" && (partScope === undefined || partScope.has(binding))) {
      partIds.add(binding);
    }
  }
  for (const partId of overrides.keys()) partIds.add(partId);
  const bindings: PartResultBindings<Value>[] = [];
  for (const partId of [...partIds].sort((left, right) => left - right)) {
    const slots = layout.partLocalSlots.get(partId);
    const shared = source.get(partId);
    const localOverrides = overrides.get(partId);
    if (shared === undefined && localOverrides === undefined) continue;
    const values = new Array<Value | undefined>(slots?.length ?? 1).fill(shared);
    for (const [local, value] of localOverrides ?? []) values[local] = value;
    bindings.push({ partId, values });
  }
  return bindings;
}

function occurrenceOverrides<Value>(
  source: ReadonlyMap<ResultBindingId, Value>,
  runtime: PackedSceneRuntime,
  layout: ResultBindingLayout,
  partScope: ReadonlySet<PartId> | undefined,
): ReadonlyMap<PartId, ReadonlyMap<number, Value>> {
  const byPart = new Map<PartId, Map<number, Value>>();
  for (const [binding, value] of source) {
    if (typeof binding !== "string") continue;
    const slot = runtime.getInstanceSlot(binding);
    const partId = slot === undefined ? undefined : runtime.getPartId(slot);
    const local = slot === undefined ? undefined : layout.slotPartLocal[slot];
    if (
      partId === undefined ||
      local === undefined ||
      local < 0 ||
      (partScope !== undefined && !partScope.has(partId))
    )
      continue;
    let part = byPart.get(partId);
    if (part === undefined) {
      part = new Map();
      byPart.set(partId, part);
    }
    part.set(local, value);
  }
  return byPart;
}
