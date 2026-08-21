import type { ElementRegionSelection } from "@/entries/interaction";
import type { PartOccurrenceId } from "@/entries/root";

interface ThroughElementRegionGroup {
  readonly partOccurrenceId: PartOccurrenceId;
  elementIds: Uint32Array;
  count: number;
}

/** Builds one exact typed element region without allocating a target per hit. */
export class ThroughElementRegionBuilder {
  private readonly groups: ThroughElementRegionGroup[] = [];
  private current: ThroughElementRegionGroup | undefined;
  private currentOccurrenceId: PartOccurrenceId | undefined;
  private count = 0;
  private growths = 0;

  beginOccurrence(partOccurrenceId: PartOccurrenceId): void {
    this.current = undefined;
    this.currentOccurrenceId = partOccurrenceId;
  }

  append(elementId: number): boolean {
    let group = this.current;
    let created = false;
    if (group === undefined) {
      const partOccurrenceId = this.currentOccurrenceId;
      if (partOccurrenceId === undefined)
        throw new Error("Through element region has no active occurrence");
      group = { partOccurrenceId, elementIds: new Uint32Array(0), count: 0 };
      this.groups.push(group);
      this.current = group;
      created = true;
    }
    if (group.count === group.elementIds.length) {
      const capacity = Math.max(16, group.elementIds.length * 2);
      const next = new Uint32Array(capacity);
      next.set(group.elementIds);
      group.elementIds = next;
      this.growths += 1;
    }
    group.elementIds[group.count] = elementId;
    group.count += 1;
    this.count += 1;
    return created;
  }

  selection(): ElementRegionSelection {
    const groups = this.groups.filter((group) => group.count > 0);
    groups.sort((left, right) =>
      left.partOccurrenceId < right.partOccurrenceId
        ? -1
        : left.partOccurrenceId > right.partOccurrenceId
          ? 1
          : 0,
    );
    const partOccurrenceIds = new Array<PartOccurrenceId>(groups.length);
    const offsets = new Uint32Array(groups.length + 1);
    const elementIds = new Uint32Array(this.count);
    let cursor = 0;
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      if (group === undefined) continue;
      const sorted = group.elementIds.subarray(0, group.count);
      sorted.sort();
      const unique = uniqueCount(sorted);
      partOccurrenceIds[index] = group.partOccurrenceId;
      offsets[index] = cursor;
      elementIds.set(sorted.subarray(0, unique), cursor);
      cursor += unique;
    }
    offsets[groups.length] = cursor;
    return {
      kind: "element",
      count: cursor,
      partOccurrenceIds,
      offsets,
      elementIds: cursor === elementIds.length ? elementIds : elementIds.subarray(0, cursor),
    };
  }

  details(): { readonly groups: number; readonly growths: number; readonly scratchBytes: number } {
    return {
      groups: this.groups.length,
      growths: this.growths,
      scratchBytes: this.groups.reduce((total, group) => total + group.elementIds.byteLength, 0),
    };
  }
}

function uniqueCount(ids: Uint32Array): number {
  if (ids.length < 2) return ids.length;
  let output = 1;
  for (let input = 1; input < ids.length; input += 1) {
    if (ids[input] === ids[output - 1]) continue;
    ids[output] = ids[input] ?? 0;
    output += 1;
  }
  return output;
}
