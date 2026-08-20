import type { GeometryBody } from "./types";
import { ordinalForId } from "../elements/model-storage";
import type { PartSemanticGraph } from "./semantic/part-semantic-graph";
import { graphBodyAt } from "./semantic/part-semantic-views";

/** Optional query capability for bodies retained in the Part semantic graph. */
export interface PartBodies extends Iterable<GeometryBody> {
  readonly count: number;
  get(bodyId: number): GeometryBody | undefined;
  at(ordinal: number): GeometryBody | undefined;
  entries(): IterableIterator<[number, GeometryBody]>;
}

/** Creates body inspection without retaining body descriptor arrays. */
export function createPartBodies(graph: PartSemanticGraph): PartBodies {
  return new GraphPartBodies(graph);
}

class GraphPartBodies implements PartBodies {
  constructor(private readonly graph: PartSemanticGraph) {}
  get count(): number {
    return this.graph.bodyIds.length;
  }
  get(bodyId: number): GeometryBody | undefined {
    const ordinal = ordinalForId(this.graph.bodyIds, this.graph.bodyIdOrdinals, bodyId);
    return ordinal === undefined ? undefined : graphBodyAt(this.graph, ordinal);
  }
  at(ordinal: number): GeometryBody | undefined {
    const resolved = ordinal < 0 ? this.count + ordinal : ordinal;
    return resolved < 0 || resolved >= this.count ? undefined : graphBodyAt(this.graph, resolved);
  }
  *entries(): IterableIterator<[number, GeometryBody]> {
    for (let ordinal = 0; ordinal < this.count; ordinal += 1) {
      const body = graphBodyAt(this.graph, ordinal);
      if (body === undefined) throw new Error(`Part graph has invalid body row ${ordinal}`);
      yield [ordinal, body];
    }
  }
  *[Symbol.iterator](): IterableIterator<GeometryBody> {
    for (const [, body] of this.entries()) yield body;
  }
}
