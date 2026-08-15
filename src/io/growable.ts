type GrowableArray = Uint32Array | Float64Array;
type GrowableArrayConstructor<T extends GrowableArray> = new (length: number) => T;

/** Shared growable typed-array storage for the narrow VTK accumulation buffers. */
class GrowableBuffer<T extends GrowableArray> {
  private values: T;
  private length = 0;

  constructor(private readonly createArray: GrowableArrayConstructor<T>) {
    this.values = new createArray(1024);
  }

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

  /** Copies the closed range `[start, end)` of accumulated values. */
  slice(start: number, end: number): T {
    return this.values.slice(Math.max(0, start), Math.min(this.length, end)) as T;
  }

  get size(): number {
    return this.length;
  }

  /** Bytes allocated for the backing store; a small multiple of the data size. */
  get byteLength(): number {
    return this.values.byteLength;
  }

  toArray(): T {
    return this.values.slice(0, this.length) as T;
  }

  protected valueAt(index: number): number | undefined {
    return index >= 0 && index < this.length ? this.values[index] : undefined;
  }

  private ensure(capacity: number): void {
    if (capacity <= this.values.length) return;
    let next = this.values.length;
    while (next < capacity) next *= 2;
    const grown = new this.createArray(next);
    grown.set(this.values);
    this.values = grown;
  }
}

/** A growable Uint32Array backing store for compact VTK accumulation. */
export class Uint32Buffer extends GrowableBuffer<Uint32Array> {
  constructor() {
    super(Uint32Array);
  }

  /** Reads the value at `index`, or `undefined` when it is out of range. */
  at(index: number): number | undefined {
    return this.valueAt(index);
  }
}

/** A growable Float64Array backing store for compact VTK accumulation. */
export class Float64Buffer extends GrowableBuffer<Float64Array> {
  constructor() {
    super(Float64Array);
  }
}
