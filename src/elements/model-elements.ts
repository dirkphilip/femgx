import type { Element, ElementId } from "./element";
import type { ElementModel, ElementModelElements } from "./model-contract";

/** Lightweight query facade that creates descriptors only for requested rows. */
export class ModelElements implements ElementModelElements {
  constructor(
    private readonly model: () => ElementModel,
    private readonly ordinalForId: (model: ElementModel, id: ElementId) => number | undefined,
    private readonly elementAt: (model: ElementModel, ordinal: number) => Element | undefined,
  ) {}

  get count(): number {
    return this.model().elementIds.length;
  }

  get(id: ElementId): Element | undefined {
    const model = this.model();
    const ordinal = this.ordinalForId(model, id);
    return ordinal === undefined ? undefined : this.elementAt(model, ordinal);
  }

  at(ordinal: number): Element | undefined {
    const resolved = ordinal < 0 ? this.count + ordinal : ordinal;
    return this.elementAt(this.model(), resolved);
  }

  *entries(): IterableIterator<[number, Element]> {
    for (let ordinal = 0; ordinal < this.count; ordinal += 1) {
      const element = this.elementAt(this.model(), ordinal);
      if (element === undefined) throw new Error(`Element model has invalid row ${ordinal}`);
      yield [ordinal, element];
    }
  }

  *[Symbol.iterator](): IterableIterator<Element> {
    for (const [, element] of this.entries()) yield element;
  }
}
