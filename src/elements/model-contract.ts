import type { Element, ElementId } from "./element";
import type { Body, BodyId } from "./model-types";

/** A compact immutable FE model with dense numeric topology columns. */
export interface ElementModel {
  /** Flat xyz coordinates, three values per authored node row. */
  readonly nodes: Float32Array;
  /** Stable node ids aligned with coordinate rows. */
  readonly nodeIds: Uint32Array;
  /** Stable element ids aligned with authored element rows. */
  readonly elementIds: Uint32Array;
  /** CSR offsets into `elementNodeIds`. */
  readonly elementNodeOffsets: Uint32Array;
  /** Stable node ids in canonical element-connectivity order. */
  readonly elementNodeIds: Uint32Array;
  /** Direct body membership by dense element row; zero means absent. */
  readonly elementBodyIds?: Uint32Array;
  /** Optional streaming query capability over packed authored-body columns. */
  readonly bodies?: ElementModelBodies;
  /** Streaming query capability over ephemeral element records. */
  readonly elements: ElementModelElements;
}

/** Query capability over packed authored-element columns. */
export interface ElementModelElements extends Iterable<Element> {
  /** Number of authored element rows. */
  readonly count: number;
  /** Returns a fresh descriptor for one stable element id. */
  get(id: ElementId): Element | undefined;
  /** Returns a fresh descriptor for one dense authored ordinal. */
  at(ordinal: number): Element | undefined;
  /** Iterates dense ordinals and fresh element descriptors in authored order. */
  entries(): IterableIterator<[number, Element]>;
}

/** Query capability over packed authored-body columns. */
export interface ElementModelBodies extends Iterable<Body> {
  /** Number of authored bodies. */
  readonly count: number;
  /** Returns a fresh descriptor for one stable body id. */
  get(id: BodyId): Body | undefined;
  /** Returns a fresh descriptor for one dense authored ordinal. */
  at(ordinal: number): Body | undefined;
  /** Iterates dense ordinals and fresh body descriptors in authored order. */
  entries(): IterableIterator<[number, Body]>;
}
