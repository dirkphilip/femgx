/**
 * A growable Uint32Array backing store for compact incremental accumulation of
 * integer streams (cell starts, connectivity, types).
 */
export class Uint32Buffer {
  private values = new Uint32Array(1024);
  private length = 0;

  append(chunk: ArrayLike<number>): void {
    this.ensure(this.length + chunk.length);
    for (let index = 0; index < chunk.length; index++) {
      this.values[this.length + index] = chunk[index] ?? 0;
    }
    this.length += chunk.length;
  }

  /** Appends a single value. */
  push(value: number): void {
    this.ensure(this.length + 1);
    this.values[this.length] = value;
    this.length += 1;
  }

  /** Reads the value at `index`, or `undefined` when it is out of range. */
  at(index: number): number | undefined {
    return index >= 0 && index < this.length ? this.values[index] : undefined;
  }

  /** Copies the closed range `[start, end)` of accumulated values. */
  slice(start: number, end: number): Uint32Array {
    return this.values.slice(Math.max(0, start), Math.min(this.length, end));
  }

  get size(): number {
    return this.length;
  }

  /** Bytes allocated for the backing store; a small multiple of the data size. */
  get byteLength(): number {
    return this.values.byteLength;
  }

  toArray(): Uint32Array {
    return this.values.slice(0, this.length);
  }

  private ensure(capacity: number): void {
    if (capacity <= this.values.length) {
      return;
    }
    let next = this.values.length;
    while (next < capacity) {
      next *= 2;
    }
    const grown = new Uint32Array(next);
    grown.set(this.values);
    this.values = grown;
  }
}

/** A growable Float64Array backing store for compact incremental accumulation of value streams. */
export class Float64Buffer {
  private values = new Float64Array(1024);
  private length = 0;

  append(chunk: ArrayLike<number>): void {
    this.ensure(this.length + chunk.length);
    for (let index = 0; index < chunk.length; index++) {
      this.values[this.length + index] = chunk[index] ?? 0;
    }
    this.length += chunk.length;
  }

  push(value: number): void {
    this.ensure(this.length + 1);
    this.values[this.length] = value;
    this.length += 1;
  }

  /** Copies the closed range `[start, end)` of accumulated values. */
  slice(start: number, end: number): Float64Array {
    return this.values.slice(Math.max(0, start), Math.min(this.length, end));
  }

  get size(): number {
    return this.length;
  }

  /** Bytes allocated for the backing store; a small multiple of the data size. */
  get byteLength(): number {
    return this.values.byteLength;
  }

  toArray(): Float64Array {
    return this.values.slice(0, this.length);
  }

  private ensure(capacity: number): void {
    if (capacity <= this.values.length) {
      return;
    }
    let next = this.values.length;
    while (next < capacity) {
      next *= 2;
    }
    const grown = new Float64Array(next);
    grown.set(this.values);
    this.values = grown;
  }
}
