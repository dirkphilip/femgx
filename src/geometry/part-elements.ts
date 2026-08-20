import { ordinalForId } from "../elements/model-storage";
import type { ElementTessellation } from "./types";
import type { PartSemanticGraph } from "./semantic/part-semantic-graph";
import { graphElementAt } from "./semantic/part-semantic-views";

/**
 * Optional query-only FE semantics for one Part.
 *
 * Iteration creates fresh immutable descriptors and never retains a descriptor
 * array. The canonical columns remain private to the Part semantic graph.
 */
export interface PartElements extends Iterable<ElementTessellation> {
  /** Number of finite-element rows retained by the Part. */
  readonly count: number;
  /** Returns a fresh tessellation descriptor for one stable element id. */
  get(elementId: number): ElementTessellation | undefined;
  /** Returns a fresh tessellation descriptor by retained ordinal. */
  at(ordinal: number): ElementTessellation | undefined;
  /** Iterates retained ordinals and fresh tessellation descriptors. */
  entries(): IterableIterator<[number, ElementTessellation]>;
}

/** Creates the public query facade over one already-validated semantic graph. */
export function createPartElements(graph: PartSemanticGraph): PartElements {
  return new GraphPartElements(graph);
}

class GraphPartElements implements PartElements {
  constructor(private readonly graph: PartSemanticGraph) {}
  get count(): number {
    return this.graph.elementIds.length;
  }
  get(elementId: number): ElementTessellation | undefined {
    const ordinal = ordinalForId(this.graph.elementIds, this.graph.elementIdOrdinals, elementId);
    return ordinal === undefined ? undefined : graphElementAt(this.graph, ordinal);
  }
  at(ordinal: number): ElementTessellation | undefined {
    const resolved = ordinal < 0 ? this.count + ordinal : ordinal;
    return resolved < 0 || resolved >= this.count
      ? undefined
      : graphElementAt(this.graph, resolved);
  }
  *entries(): IterableIterator<[number, ElementTessellation]> {
    for (let ordinal = 0; ordinal < this.count; ordinal += 1) {
      const element = graphElementAt(this.graph, ordinal);
      if (element === undefined) throw new Error(`Part graph has invalid element row ${ordinal}`);
      yield [ordinal, element];
    }
  }
  *[Symbol.iterator](): IterableIterator<ElementTessellation> {
    for (const [, element] of this.entries()) yield element;
  }
}
