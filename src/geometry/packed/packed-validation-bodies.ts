import { validateOneBasedId } from "../id-validation";
import type { GeometryBody } from "../types";
import type { PackedSemanticStorage } from "./packed-semantic";

/** Validates typed element body ownership against optional body lists. */
export function validatePackedBodies(
  storage: PackedSemanticStorage,
  bodies: readonly GeometryBody[] | undefined,
): void {
  if (bodies === undefined) {
    for (const bodyId of storage.elementBodyIds ?? []) {
      if (bodyId !== 0)
        throw new Error(`Element references body ${bodyId}, but no bodies are declared`);
    }
    return;
  }
  const ordinalLookup = elementOrdinalLookup(storage);
  const listed = new Map<number, number>();
  const declaredBodies = new Set<number>();
  let previousBody = 0;
  for (const body of bodies) {
    validateOneBasedId(body.id, "Body");
    if (body.id === 0) throw new Error("Body id 0 is not valid");
    if (body.id <= previousBody) throw new Error("Body ids must be strictly ascending");
    previousBody = body.id;
    declaredBodies.add(body.id);
    validateBodyElements(body, storage, ordinalLookup, listed);
  }
  validateBodyColumns(storage, listed);
  for (const bodyId of storage.elementBodyIds ?? []) {
    if (bodyId !== 0) {
      validateOneBasedId(bodyId, "Element body");
      if (!declaredBodies.has(bodyId)) throw new Error(`Element references unknown body ${bodyId}`);
    }
  }
}

function validateBodyElements(
  body: GeometryBody,
  storage: PackedSemanticStorage,
  ordinalLookup: ReadonlyMap<number, number>,
  listed: Map<number, number>,
): void {
  let previousElement = -1;
  for (const elementId of body.elementIds) {
    if (elementId <= previousElement) {
      throw new Error(`Body ${body.id} element ids must be strictly ascending`);
    }
    previousElement = elementId;
    const ordinal = ordinalLookup.get(elementId);
    if (ordinal === undefined)
      throw new Error(`Body ${body.id} references unknown element ${elementId}`);
    if (listed.has(elementId))
      throw new Error(`Element ${elementId} belongs to more than one body`);
    listed.set(elementId, body.id);
    const columnBody = storage.elementBodyIds?.[ordinal] ?? 0;
    if (columnBody !== 0 && columnBody !== body.id) {
      throw new Error(`Element ${elementId} body membership does not match its body metadata`);
    }
  }
}

function validateBodyColumns(
  storage: PackedSemanticStorage,
  listed: ReadonlyMap<number, number>,
): void {
  for (let ordinal = 0; ordinal < storage.elementIds.length; ordinal += 1) {
    const id = storage.elementIds[ordinal] ?? 0;
    const listedBody = listed.get(id) ?? 0;
    const columnBody = storage.elementBodyIds?.[ordinal] ?? 0;
    if (columnBody !== listedBody) {
      throw new Error(`Element ${id} body membership does not match its body metadata`);
    }
  }
}

function elementOrdinalLookup(storage: PackedSemanticStorage): ReadonlyMap<number, number> {
  const ordinals = new Map<number, number>();
  for (let ordinal = 0; ordinal < storage.elementIds.length; ordinal += 1) {
    const elementId = storage.elementIds[ordinal];
    if (elementId !== undefined) ordinals.set(elementId, ordinal);
  }
  return ordinals;
}
