import type { Body, BodyId } from "./model-types";
import type { ElementModel, ElementModelBodies } from "./model-contract";
import { elementModelStorage, ordinalForId } from "./model-storage";

/** Lightweight query facade that creates bodies only for requested rows. */
export class ModelBodies implements ElementModelBodies {
  constructor(private readonly model: () => ElementModel) {}

  get count(): number {
    return elementModelStorage(this.model()).bodyIds?.length ?? 0;
  }

  get(id: BodyId): Body | undefined {
    const model = this.model();
    const storage = elementModelStorage(model);
    const ordinal =
      storage.bodyIds === undefined || storage.bodyIdOrdinals === undefined
        ? undefined
        : ordinalForId(storage.bodyIds, storage.bodyIdOrdinals, id);
    return ordinal === undefined ? undefined : bodyAt(model, ordinal);
  }

  at(ordinal: number): Body | undefined {
    const resolved = ordinal < 0 ? this.count + ordinal : ordinal;
    return bodyAt(this.model(), resolved);
  }

  *entries(): IterableIterator<[number, Body]> {
    for (let ordinal = 0; ordinal < this.count; ordinal += 1) {
      const body = bodyAt(this.model(), ordinal);
      if (body === undefined) throw new Error(`Element model has invalid body row ${ordinal}`);
      yield [ordinal, body];
    }
  }

  *[Symbol.iterator](): IterableIterator<Body> {
    for (const [, body] of this.entries()) yield body;
  }
}

function bodyAt(model: ElementModel, ordinal: number): Body | undefined {
  const storage = elementModelStorage(model);
  const ids = storage.bodyIds;
  const names = storage.bodyNameDefined;
  const nameOffsets = storage.bodyNameOffsets;
  const nameText = storage.bodyNameText;
  const elementOffsets = storage.bodyElementOffsets;
  const elementOrdinals = storage.bodyElementOrdinals;
  const id = ids?.[ordinal];
  const start = elementOffsets?.[ordinal];
  const end = elementOffsets?.[ordinal + 1];
  if (
    id === undefined ||
    start === undefined ||
    end === undefined ||
    names === undefined ||
    nameOffsets === undefined ||
    nameText === undefined ||
    elementOrdinals === undefined
  ) {
    return undefined;
  }
  const elementIds = new Array<number>(end - start);
  for (let index = start; index < end; index += 1) {
    const elementOrdinal = elementOrdinals[index];
    const elementId = model.elementIds[elementOrdinal ?? -1];
    if (elementId === undefined) throw new Error(`Body ${id} references invalid element row`);
    elementIds[index - start] = elementId;
  }
  const nameStart = nameOffsets[ordinal] ?? 0;
  const nameEnd = nameOffsets[ordinal + 1] ?? nameStart;
  const name =
    names[ordinal] === 0
      ? undefined
      : String.fromCharCode(...nameText.subarray(nameStart, nameEnd));
  return Object.freeze({
    id,
    ...(name === undefined ? {} : { name }),
    elementIds: Object.freeze(elementIds),
  });
}
