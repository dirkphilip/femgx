import { topologyFor, type ElementShape } from "../elements/shapes";
import { IoError } from "./diagnostics";
import {
  FEMGX_FORMAT_VERSION,
  type FemModel,
  type MetadataValue,
  type ModelElementBlock,
  type ModelSetKind,
  type ResultField,
} from "./model";

/** A growable Uint32Array backing store. */
class Uint32Buffer {
  private values = new Uint32Array(1024);
  private length = 0;

  append(chunk: ArrayLike<number>): void {
    this.ensure(this.length + chunk.length);
    for (let index = 0; index < chunk.length; index++) {
      this.values[this.length + index] = chunk[index] ?? 0;
    }
    this.length += chunk.length;
  }

  get size(): number {
    return this.length;
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

/** A growable Float64Array backing store. */
class Float64Buffer {
  private values = new Float64Array(1024);
  private length = 0;

  append(chunk: ArrayLike<number>): void {
    this.ensure(this.length + chunk.length);
    for (let index = 0; index < chunk.length; index++) {
      this.values[this.length + index] = chunk[index] ?? 0;
    }
    this.length += chunk.length;
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

interface PendingBlock {
  readonly shape: ElementShape;
  readonly ids: Uint32Buffer;
  readonly connectivity: Uint32Buffer;
}

interface PendingSet {
  readonly kind: ModelSetKind;
  readonly name: string;
  readonly ids: Uint32Array;
}

/**
 * Chunked, incremental model accumulation. Parsers feed typed-array chunks of
 * nodes and elements into this builder so large models are never materialized
 * as arrays of JavaScript objects; `build()` returns a compact typed model.
 */
export interface FemModelBuilder {
  /** Appends a chunk of nodes; `coordinates` must hold `3 * ids.length` values. */
  appendNodes(ids: ArrayLike<number>, coordinates: ArrayLike<number>): void;
  /**
   * Starts a new element block of the given shape. Any previously open block is
   * finalized first, so blocks never need an explicit close.
   */
  openElementBlock(shape: ElementShape): void;
  /**
   * Appends a chunk of elements to the current block; `connectivity` must hold
   * `ids.length * nodeCount` values for the block's shape.
   */
  appendElements(ids: ArrayLike<number>, connectivity: ArrayLike<number>): void;
  /** Adds a named node or element set; set ids must be non-negative integers. */
  addSet(kind: ModelSetKind, name: string, ids: ArrayLike<number>): void;
  /** Sets a metadata entry, preserving insertion order. */
  setMetadata(key: string, value: MetadataValue): void;
  /** Adds a result field aligned to node or element ids. */
  addResult(result: ResultField): void;
  /** The number of nodes accumulated so far. */
  readonly nodeCount: number;
  /** The number of elements accumulated so far. */
  readonly elementCount: number;
  /** Finalizes open blocks and returns the immutable interchange model. */
  build(): FemModel;
}

class ModelBuilder implements FemModelBuilder {
  private readonly nodeIds = new Uint32Buffer();
  private readonly coordinates = new Float64Buffer();
  private readonly blocks: PendingBlock[] = [];
  private readonly sets: PendingSet[] = [];
  private readonly metadata: Record<string, MetadataValue> = {};
  private readonly results: ResultField[] = [];
  private openBlock: PendingBlock | undefined;

  get nodeCount(): number {
    return this.nodeIds.size;
  }

  get elementCount(): number {
    let count = 0;
    for (const block of this.blocks) {
      count += block.ids.size;
    }
    if (this.openBlock !== undefined) {
      count += this.openBlock.ids.size;
    }
    return count;
  }

  appendNodes(ids: ArrayLike<number>, coords: ArrayLike<number>): void {
    if (coords.length !== ids.length * 3) {
      throw new IoError(
        `appendNodes expected ${ids.length * 3} coordinates but got ${coords.length}`,
      );
    }
    validateIds(ids, "node");
    this.nodeIds.append(ids);
    this.coordinates.append(coords);
  }

  openElementBlock(shape: ElementShape): void {
    this.closeBlock();
    this.openBlock = { shape, ids: new Uint32Buffer(), connectivity: new Uint32Buffer() };
  }

  appendElements(ids: ArrayLike<number>, connectivity: ArrayLike<number>): void {
    const block = this.openBlock;
    if (block === undefined) {
      throw new IoError("appendElements called without openElementBlock");
    }
    const nodeCount = topologyFor(block.shape).nodeCount;
    if (connectivity.length !== ids.length * nodeCount) {
      throw new IoError(
        `appendElements for ${block.shape.family} order ${block.shape.order} expected ` +
          `${ids.length * nodeCount} connectivity values but got ${connectivity.length}`,
      );
    }
    validateIds(ids, "element");
    validateIds(connectivity, "connectivity");
    block.ids.append(ids);
    block.connectivity.append(connectivity);
  }

  addSet(kind: ModelSetKind, name: string, ids: ArrayLike<number>): void {
    if (name.length === 0) {
      throw new IoError("Set names must not be empty");
    }
    validateIds(ids, kind === "node" ? "node" : "element");
    this.sets.push({ kind, name, ids: copyUint32(ids) });
  }

  setMetadata(key: string, value: MetadataValue): void {
    if (key.length === 0) {
      throw new IoError("Metadata keys must not be empty");
    }
    this.metadata[key] = value;
  }

  addResult(result: ResultField): void {
    validateResult(result);
    this.results.push(copyResult(result));
  }

  build(): FemModel {
    this.closeBlock();
    const elementBlocks: ModelElementBlock[] = this.blocks.map((block) => ({
      shape: block.shape,
      count: block.ids.size,
      ids: block.ids.toArray(),
      connectivity: block.connectivity.toArray(),
    }));
    return {
      formatVersion: FEMGX_FORMAT_VERSION,
      nodes: {
        count: this.nodeIds.size,
        ids: this.nodeIds.toArray(),
        coordinates: this.coordinates.toArray(),
      },
      elementBlocks,
      sets: [...this.sets],
      metadata: { ...this.metadata },
      results: [...this.results],
    };
  }

  private closeBlock(): void {
    if (this.openBlock !== undefined) {
      this.blocks.push(this.openBlock);
      this.openBlock = undefined;
    }
  }
}

/** Creates an empty model builder for chunked accumulation. */
export function createModelBuilder(): FemModelBuilder {
  return new ModelBuilder();
}

function validateIds(ids: ArrayLike<number>, kind: string): void {
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index];
    if (typeof id !== "number" || !Number.isInteger(id) || id < 0) {
      throw new IoError(`Invalid ${kind} id ${String(id)}; ids must be non-negative integers`);
    }
  }
}

function copyUint32(ids: ArrayLike<number>): Uint32Array {
  const copy = new Uint32Array(ids.length);
  for (let index = 0; index < ids.length; index++) {
    copy[index] = ids[index] ?? 0;
  }
  return copy;
}

function validateResult(result: ResultField): void {
  if (result.name.length === 0) {
    throw new IoError("Result field names must not be empty");
  }
  if (result.components < 1) {
    throw new IoError(`Result ${result.name} has invalid component count ${result.components}`);
  }
  if (result.values.length !== result.ids.length * result.components) {
    throw new IoError(
      `Result ${result.name} expects ${result.ids.length * result.components} values but got ` +
        `${result.values.length}`,
    );
  }
  validateIds(result.ids, "result");
}

function copyResult(result: ResultField): ResultField {
  const ids = copyUint32(result.ids);
  const values = new Float64Array(result.values.length);
  values.set(result.values);
  return {
    name: result.name,
    location: result.location,
    components: result.components,
    ids,
    values,
  };
}
