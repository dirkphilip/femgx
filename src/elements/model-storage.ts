import type { ElementModel } from "./model-contract";
import { ElementShape } from "./shapes";
import type { ElementShape as ElementShapeValue } from "./shapes";

const shapes = Object.values(ElementShape) as readonly ElementShapeValue[];
const codeByShape = new Map(shapes.map((shape, code) => [shape, code]));

/** Private dense columns derived with a model snapshot. */
interface ElementModelStorage {
  readonly shapeCodes: Uint8Array;
  readonly nodeIdOrdinals: Uint32Array;
  readonly elementIdOrdinals: Uint32Array;
  readonly bodyIds?: Uint32Array;
  readonly bodyIdOrdinals?: Uint32Array;
  readonly bodyNameDefined?: Uint8Array;
  readonly bodyNameOffsets?: Uint32Array;
  readonly bodyNameText?: Uint16Array;
  readonly bodyElementOffsets?: Uint32Array;
  readonly bodyElementOrdinals?: Uint32Array;
}

const storageByModel = new WeakMap<ElementModel, ElementModelStorage>();

/** Associates one validated model with its non-public dense lookup columns. */
export function registerElementModelStorage(
  model: ElementModel,
  storage: ElementModelStorage,
): void {
  storageByModel.set(model, storage);
}

/** Returns private lookup columns for a model created by this module. */
export function elementModelStorage(model: ElementModel): ElementModelStorage {
  const storage = storageByModel.get(model);
  if (storage === undefined) throw new Error("ElementModel was not created by femgx");
  return storage;
}

/** Builds a stable typed ordinal sort without retaining JavaScript number arrays. */
export function sortedOrdinals(
  ids: Uint32Array,
  label: string,
  rejectDuplicates = true,
): Uint32Array {
  const result = new Uint32Array(ids.length);
  const scratch = new Uint32Array(ids.length);
  for (let index = 0; index < result.length; index += 1) result[index] = index;
  for (let width = 1; width < result.length; width *= 2) {
    for (let start = 0; start < result.length; start += width * 2) {
      merge(ids, result, scratch, {
        start,
        middle: Math.min(start + width, result.length),
        end: Math.min(start + width * 2, result.length),
      });
    }
    result.set(scratch);
  }
  if (rejectDuplicates) {
    for (let index = 1; index < result.length; index += 1) {
      if (ids[result[index - 1] ?? 0] === ids[result[index] ?? 0]) {
        throw new Error(`${label} ids must be unique`);
      }
    }
  }
  return result;
}

/** Resolves a stable sparse id through a compact sorted ordinal column. */
export function ordinalForId(
  ids: Uint32Array,
  ordinals: Uint32Array,
  id: number,
): number | undefined {
  let low = 0;
  let high = ordinals.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const ordinal = ordinals[middle] ?? 0;
    const candidate = ids[ordinal] ?? 0;
    if (candidate === id) return ordinal;
    if (candidate < id) low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
}

/** Encodes a public element shape in a deliberately private storage domain. */
export function shapeCodeForElement(shape: ElementShapeValue): number {
  const code = codeByShape.get(shape);
  if (code === undefined) throw new Error(`Unsupported element shape ${shape}`);
  return code;
}

/** Resolves a private shape code without coupling it to public enum ordinals. */
export function elementShapeForCode(code: number): ElementShapeValue {
  const shape = shapes[code];
  if (shape === undefined) throw new Error(`Unknown internal element shape code ${code}`);
  return shape;
}

function merge(
  ids: Uint32Array,
  source: Uint32Array,
  target: Uint32Array,
  range: { readonly start: number; readonly middle: number; readonly end: number },
): void {
  const { start, middle, end } = range;
  let left = start;
  let right = middle;
  for (let output = start; output < end; output += 1) {
    const leftOrdinal = source[left];
    const rightOrdinal = source[right];
    if (
      left < middle &&
      (right >= end || (ids[leftOrdinal ?? 0] ?? 0) <= (ids[rightOrdinal ?? 0] ?? 0))
    ) {
      target[output] = leftOrdinal ?? 0;
      left += 1;
    } else {
      target[output] = rightOrdinal ?? 0;
      right += 1;
    }
  }
}
