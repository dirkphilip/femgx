import type { Element, ElementId } from "./element";
import type { ElementModel, ElementModelElements } from "./model-contract";
import { elementModelStorage, elementShapeForCode, ordinalForId } from "./model-storage";

/** Lightweight query facade that creates descriptors only for requested rows. */
export class ModelElements implements ElementModelElements {
  constructor(private readonly model: () => ElementModel) {}

  get count(): number {
    return this.model().elementIds.length;
  }

  get(id: ElementId): Element | undefined {
    const model = this.model();
    const ordinal = ordinalForId(
      model.elementIds,
      elementModelStorage(model).elementIdOrdinals,
      id,
    );
    return ordinal === undefined ? undefined : elementAt(model, ordinal);
  }

  at(ordinal: number): Element | undefined {
    const resolved = ordinal < 0 ? this.count + ordinal : ordinal;
    return elementAt(this.model(), resolved);
  }

  *entries(): IterableIterator<[number, Element]> {
    for (let ordinal = 0; ordinal < this.count; ordinal += 1) {
      const element = elementAt(this.model(), ordinal);
      if (element === undefined) throw new Error(`Element model has invalid row ${ordinal}`);
      yield [ordinal, element];
    }
  }

  *[Symbol.iterator](): IterableIterator<Element> {
    for (const [, element] of this.entries()) yield element;
  }
}

function elementAt(model: ElementModel, ordinal: number): Element | undefined {
  const id = model.elementIds[ordinal];
  const code = elementModelStorage(model).shapeCodes[ordinal];
  const start = model.elementNodeOffsets[ordinal];
  const end = model.elementNodeOffsets[ordinal + 1];
  if (id === undefined || code === undefined || start === undefined || end === undefined)
    return undefined;
  return Object.freeze({
    id,
    shape: elementShapeForCode(code),
    nodeIds: Object.freeze(Array.from(model.elementNodeIds.subarray(start, end))),
  });
}
