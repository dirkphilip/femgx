/**
 * A mutable exact-key view over retained state. Staging records only the keys a
 * part revision owns, while reads continue to see the committed owner.
 */
export class PartRevisionMap<K, V> extends Map<K, V> {
  private readonly removed = new Set<K>();

  public constructor(private readonly source: ReadonlyMap<K, V>) {
    super();
  }

  public override get size(): number {
    let size = this.source.size;
    for (const key of this.removed) if (this.source.has(key)) size -= 1;
    for (const key of super.keys()) if (!this.source.has(key)) size += 1;
    return size;
  }

  public override get(key: K): V | undefined {
    if (super.has(key)) return super.get(key);
    return this.removed.has(key) ? undefined : this.source.get(key);
  }

  public override has(key: K): boolean {
    return super.has(key) || (!this.removed.has(key) && this.source.has(key));
  }

  public override set(key: K, value: V): this {
    this.removed.delete(key);
    return super.set(key, value);
  }

  public override delete(key: K): boolean {
    if (!this.has(key)) return false;
    super.delete(key);
    this.removed.add(key);
    return true;
  }

  public override clear(): void {
    for (const key of this.source.keys()) this.removed.add(key);
    super.clear();
  }

  public override *entries(): MapIterator<[K, V]> {
    for (const [key, value] of this.source) {
      if (!super.has(key) && !this.removed.has(key)) yield [key, value];
    }
    yield* super.entries();
  }

  public override [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  public override *keys(): MapIterator<K> {
    for (const [key] of this) yield key;
  }

  public override *values(): MapIterator<V> {
    for (const [, value] of this) yield value;
  }

  public override forEach(
    callbackfn: (value: V, key: K, map: Map<K, V>) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of this) callbackfn.call(thisArg, value, key, this);
  }

  /** Keys materialized in this overlay, excluding retained source entries. */
  /** @yields {K} Keys owned by the overlay. */
  public *stagedKeys(): IterableIterator<K> {
    yield* super.keys();
  }
}

/** Returns exact overlay-owned keys without traversing retained source entries. */
export function stagedPartRevisionKeys<K, V>(values: Map<K, V>): Iterable<K> {
  return values instanceof PartRevisionMap ? values.stagedKeys() : [];
}

/** A copy-on-write flag array that commits only slots owned by the revision. */
export interface PartRevisionFlags {
  readonly values: boolean[];
  commit(target: boolean[]): void;
}

/** Staged per-slot flags and their exact commit operation. */
export interface PartRevisionFlagSet {
  readonly values: AttachmentFlagState;
  commit(target: AttachmentFlagState): void;
}

/** Stages every attachment-owned flag mirror without copying retained slots. */
export function stagePartRevisionFlagSet(source: AttachmentFlagState): PartRevisionFlagSet {
  const edgeFlags = stagePartRevisionFlags(source.edgeFlags);
  const edgeEmphasisFlags = stagePartRevisionFlags(source.edgeEmphasisFlags);
  const nodeFlags = stagePartRevisionFlags(source.nodeFlags);
  const transparentFlags = stagePartRevisionFlags(source.transparentFlags);
  const selectedNodeFlags = stagePartRevisionFlags(source.selectedNodeFlags);
  return {
    values: {
      edgeFlags: edgeFlags.values,
      edgeEmphasisFlags: edgeEmphasisFlags.values,
      nodeFlags: nodeFlags.values,
      transparentFlags: transparentFlags.values,
      selectedNodeFlags: selectedNodeFlags.values,
    },
    commit(target) {
      edgeFlags.commit(target.edgeFlags);
      edgeEmphasisFlags.commit(target.edgeEmphasisFlags);
      nodeFlags.commit(target.nodeFlags);
      transparentFlags.commit(target.transparentFlags);
      selectedNodeFlags.commit(target.selectedNodeFlags);
    },
  };
}

/** Stages writes to one retained slot-indexed flag mirror. */
export function stagePartRevisionFlags(source: boolean[]): PartRevisionFlags {
  const changes = new Map<number, boolean>();
  const values = new Proxy(source, {
    get(target, key, receiver) {
      const index = arrayIndex(key);
      if (index !== undefined) return changes.get(index) ?? target[index];
      const value: unknown = Reflect.get(target, key, receiver);
      return value;
    },
    set(target, key, value, receiver) {
      const index = arrayIndex(key);
      if (index === undefined) return Reflect.set(target, key, value, receiver);
      changes.set(index, value === true);
      return true;
    },
  });
  return {
    values,
    commit(target) {
      for (const [index, value] of changes) target[index] = value;
    },
  };
}

function arrayIndex(key: PropertyKey): number | undefined {
  if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/.test(key)) return undefined;
  const index = Number(key);
  return Number.isSafeInteger(index) ? index : undefined;
}
import type { AttachmentFlagState } from "./reconciliation";
