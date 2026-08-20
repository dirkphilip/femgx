import type { Body, BodyId } from "./model-types";
import type { ElementModel, ElementModelBodies } from "./model-contract";
import { elementModelStorage } from "./model-storage";

/** Lightweight query facade that creates bodies only for requested rows. */
export class ModelBodies implements ElementModelBodies {
  constructor(
    private readonly model: () => ElementModel,
    private readonly ordinalForId: (model: ElementModel, id: BodyId) => number | undefined,
    private readonly bodyAt: (model: ElementModel, ordinal: number) => Body | undefined,
  ) {}

  get count(): number {
    return elementModelStorage(this.model()).bodyIds?.length ?? 0;
  }

  get(id: BodyId): Body | undefined {
    const model = this.model();
    const ordinal = this.ordinalForId(model, id);
    return ordinal === undefined ? undefined : this.bodyAt(model, ordinal);
  }

  at(ordinal: number): Body | undefined {
    const resolved = ordinal < 0 ? this.count + ordinal : ordinal;
    return this.bodyAt(this.model(), resolved);
  }

  *entries(): IterableIterator<[number, Body]> {
    for (let ordinal = 0; ordinal < this.count; ordinal += 1) {
      const body = this.bodyAt(this.model(), ordinal);
      if (body === undefined) throw new Error(`Element model has invalid body row ${ordinal}`);
      yield [ordinal, body];
    }
  }

  *[Symbol.iterator](): IterableIterator<Body> {
    for (const [, body] of this.entries()) yield body;
  }
}
