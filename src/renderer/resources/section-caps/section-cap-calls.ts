import type { PartId } from "../../../geometry/part";
import type { DrawCall } from "../draw-resources";

/** Appends revised cap calls while keeping one bounded sparse overlay. */
export function appendSectionCapCalls(
  previous: readonly DrawCall[] | undefined,
  added: readonly DrawCall[],
): readonly DrawCall[] {
  if (previous === undefined || previous.length === 0) return added;
  if (added.length === 0) return previous;
  return callOverlay(previous).append(added).values;
}

/** Removes exact cap calls while keeping one bounded sparse overlay. */
export function removeSectionCapCalls(
  previous: readonly DrawCall[],
  removed: ReadonlySet<PartId>,
): readonly DrawCall[] {
  if (removed.size === 0) return previous;
  return callOverlay(previous).remove(removed).values;
}

/** Returns retained sparse mutations for scaling regressions. */
export function sectionCapCallOverlaySize(calls: readonly DrawCall[]): number {
  return calls instanceof SectionCapCallOverlay ? calls.mutationCount : 0;
}

function callOverlay(previous: readonly DrawCall[]): SectionCapCallOverlay {
  return previous instanceof SectionCapCallOverlay
    ? previous.clone()
    : new SectionCapCallOverlay(previous);
}

class SectionCapCallOverlay implements Iterable<DrawCall> {
  private readonly removed = new Set<PartId>();
  private readonly added = new Map<PartId, DrawCall>();
  private measuredLength: number | undefined;

  public constructor(private readonly source: readonly DrawCall[]) {}

  public clone(): SectionCapCallOverlay {
    const next = new SectionCapCallOverlay(this.source);
    for (const id of this.removed) next.removed.add(id);
    for (const [id, call] of this.added) next.added.set(id, call);
    return next;
  }

  public append(calls: readonly DrawCall[]): this {
    for (const call of calls) {
      this.removed.delete(call.partId);
      this.added.set(call.partId, call);
    }
    return this;
  }

  public remove(ids: ReadonlySet<PartId>): this {
    for (const id of ids) {
      if (!this.added.delete(id)) this.removed.add(id);
    }
    return this;
  }

  public get mutationCount(): number {
    return this.removed.size + this.added.size;
  }

  public get values(): readonly DrawCall[] {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- consumers use only length and iteration.
    return this as unknown as readonly DrawCall[];
  }

  public get length(): number {
    this.measuredLength ??= this.measure();
    return this.measuredLength;
  }

  public *[Symbol.iterator](): Iterator<DrawCall> {
    for (const call of this.source) {
      if (!this.removed.has(call.partId) && !this.added.has(call.partId)) yield call;
    }
    yield* this.added.values();
  }

  private measure(): number {
    let count = 0;
    for (const _call of this) count += 1;
    return count;
  }
}
