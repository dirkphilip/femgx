/** Mutable one-group-per-slot index with constant-time membership changes. */
export class SlotGroups {
  private readonly groups = new Map<number, number[]>();
  private positions: Int32Array;

  constructor(keys: ArrayLike<number>) {
    this.positions = new Int32Array(keys.length).fill(-1);
    for (let slot = 0; slot < keys.length; slot += 1) {
      const key = keys[slot];
      if (key !== undefined) this.add(key, slot);
    }
  }

  add(key: number, slot: number): void {
    this.reserve(slot + 1);
    if ((this.positions[slot] ?? -1) >= 0) throw new Error(`Slot ${slot} already has a group`);
    const group = this.groups.get(key) ?? [];
    this.positions[slot] = group.length;
    group.push(slot);
    this.groups.set(key, group);
  }

  remove(key: number, slot: number): void {
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

  private reserve(required: number): void {
    if (required <= this.positions.length) return;
    let capacity = Math.max(1, this.positions.length);
    while (capacity < required) capacity *= 2;
    const positions = new Int32Array(capacity).fill(-1);
    positions.set(this.positions);
    this.positions = positions;
  }
}

const EMPTY_SLOTS: readonly number[] = [];
