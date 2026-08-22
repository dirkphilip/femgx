import type { PartId } from "../../geometry/part";
import type { PartOccurrenceId } from "../../scene/types";
import type { ResultResolutionView } from "./resolution-view";

type ResultBindingId = PartId | PartOccurrenceId;

/** Builds the only shared or occurrence result bindings a part revision may replace. */
export function revisedResultBindings(
  view: ResultResolutionView,
  revisedPartIds: ReadonlySet<PartId>,
): ReadonlySet<ResultBindingId> {
  const bindings = new Set<ResultBindingId>(revisedPartIds);
  for (const partId of revisedPartIds) {
    for (const occurrenceId of view.occurrencesForPart(partId)) bindings.add(occurrenceId);
  }
  return bindings;
}

/** Immutable copy-on-write view retaining every untouched result-binding identity. */
export class RevisedBindingMap<K, V> implements ReadonlyMap<K, V> {
  public readonly size: number;

  public constructor(
    private readonly source: ReadonlyMap<K, V>,
    private readonly replacement: ReadonlyMap<K, V>,
    private readonly revised: ReadonlySet<K>,
  ) {
    let size = source.size;
    for (const key of revised) {
      if (source.has(key) === replacement.has(key)) continue;
      size += replacement.has(key) ? 1 : -1;
    }
    this.size = size;
  }

  public get(key: K): V | undefined {
    return this.revised.has(key) ? this.replacement.get(key) : this.source.get(key);
  }

  public has(key: K): boolean {
    return this.revised.has(key) ? this.replacement.has(key) : this.source.has(key);
  }

  public entries(): MapIterator<[K, V]> {
    return this.iterateEntries();
  }

  public keys(): MapIterator<K> {
    return this.iterateKeys();
  }

  public values(): MapIterator<V> {
    return this.iterateValues();
  }

  public forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void): void {
    for (const [key, value] of this) callbackfn(value, key, this);
  }

  public [Symbol.iterator](): MapIterator<[K, V]> {
    return this.iterateEntries();
  }

  private *iterateEntries(): MapIterator<[K, V]> {
    for (const entry of this.source) if (!this.revised.has(entry[0])) yield entry;
    for (const entry of this.replacement) if (this.revised.has(entry[0])) yield entry;
  }

  private *iterateKeys(): MapIterator<K> {
    for (const [key] of this) yield key;
  }

  private *iterateValues(): MapIterator<V> {
    for (const [, value] of this) yield value;
  }
}
