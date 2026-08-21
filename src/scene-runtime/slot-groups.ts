/** Mutable one-group-per-slot index with constant-time membership changes. */
export class SlotGroups {
  private readonly groups = new Map<number, number[]>();
  private positions: Int32Array;
  private journal: SlotGroupJournal | undefined;

  constructor(keys: ArrayLike<number>) {
    this.positions = new Int32Array(keys.length).fill(-1);
    for (let slot = 0; slot < keys.length; slot += 1) {
      const key = keys[slot];
      if (key !== undefined) this.add(key, slot);
    }
  }

  add(key: number, slot: number): void {
    this.capture(key, slot);
    this.reserve(slot + 1);
    if ((this.positions[slot] ?? -1) >= 0) throw new Error(`Slot ${slot} already has a group`);
    const group = this.groups.get(key) ?? [];
    this.positions[slot] = group.length;
    group.push(slot);
    this.groups.set(key, group);
  }

  remove(key: number, slot: number): void {
    this.capture(key, slot);
    const group = this.groups.get(key);
    const position = this.positions[slot] ?? -1;
    if (group === undefined || position < 0 || group[position] !== slot) {
      throw new Error(`Slot ${slot} is not in group ${key}`);
    }
    const last = group.pop();
    if (last !== undefined && last !== slot) {
      group[position] = last;
      this.positions[last] = position;
    }
    this.positions[slot] = -1;
    if (group.length === 0) this.groups.delete(key);
  }

  slots(key: number): readonly number[] {
    return this.groups.get(key) ?? EMPTY_SLOTS;
  }

  /** Starts one sparse rollback journal for changed group keys. */
  beginJournal(): void {
    if (this.journal !== undefined) throw new Error("A slot-group journal is already active");
    this.journal = { positions: this.positions, groups: new Map() };
  }

  /** Keeps mutations recorded since {@link beginJournal}. */
  commitJournal(): void {
    if (this.journal === undefined) throw new Error("No slot-group journal is active");
    this.journal = undefined;
  }

  /** Restores exact group membership and ordering recorded since {@link beginJournal}. */
  rollbackJournal(): void {
    const journal = this.journal;
    if (journal === undefined) throw new Error("No slot-group journal is active");
    for (const [key, before] of journal.groups) {
      for (const slot of this.groups.get(key) ?? []) this.positions[slot] = -1;
      if (before === undefined) this.groups.delete(key);
      else this.groups.set(key, [...before]);
    }
    this.positions = journal.positions;
    for (const before of journal.groups.values()) {
      if (before === undefined) continue;
      for (let index = 0; index < before.length; index += 1) {
        const slot = before[index];
        if (slot !== undefined) this.positions[slot] = index;
      }
    }
    this.journal = undefined;
  }

  private capture(key: number, slot: number): void {
    const journal = this.journal;
    if (journal === undefined || journal.groups.has(key)) return;
    const group = this.groups.get(key);
    journal.groups.set(key, group === undefined ? undefined : [...group]);
    if (slot >= journal.positions.length) return;
  }

  private reserve(required: number): void {
    if (required <= this.positions.length) return;
    let capacity = Math.max(1, this.positions.length);
    while (capacity < required) capacity *= 2;
    const positions = new Int32Array(capacity).fill(-1);
    positions.set(this.positions);
    this.positions = positions;
  }
}

interface SlotGroupJournal {
  readonly positions: Int32Array;
  readonly groups: Map<number, readonly number[] | undefined>;
}

const EMPTY_SLOTS: readonly number[] = [];
