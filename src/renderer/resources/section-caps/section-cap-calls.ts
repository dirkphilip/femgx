import type { DrawCall } from "../draw-resources";

/** Appends revised cap calls without copying retained active-cap call entries. */
export function appendSectionCapCalls(
  previous: readonly DrawCall[] | undefined,
  added: DrawCall[],
): readonly DrawCall[] {
  if (previous === undefined || previous.length === 0) return added;
  if (added.length === 0) return previous;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- frame encoding consumes only length and iteration.
  return new AppendedSectionCapCalls(previous, added) as unknown as readonly DrawCall[];
}

class AppendedSectionCapCalls implements Iterable<DrawCall> {
  public constructor(
    private readonly previous: readonly DrawCall[],
    private readonly added: readonly DrawCall[],
  ) {}

  public get length(): number {
    return this.previous.length + this.added.length;
  }

  public *[Symbol.iterator](): Iterator<DrawCall> {
    yield* this.previous;
    yield* this.added;
  }
}
