import {
  parseVectorGlyph,
  parseVectorLengthScale,
  parseVectorTransform,
  resultVectorFieldsForModel,
  VECTOR_OFF_VALUE,
  type VectorDisplayState,
} from "./result-controls";
import type { WorkbenchModel } from "./model";

interface VectorControlOwner {
  readonly model: WorkbenchModel;
  vectorDisplay: VectorDisplayState;
  readonly presentation: { reflectResults: () => void };
  readonly applyResultMode: (render: boolean) => void;
}

/** Applies one validated vector-field selector transition. */
export function setVectorField(owner: VectorControlOwner, value: string): void {
  const valid =
    value === VECTOR_OFF_VALUE ||
    resultVectorFieldsForModel(owner.model).some((field) => field.id === value);
  if (!valid) {
    owner.presentation.reflectResults();
    return;
  }
  if (owner.vectorDisplay.fieldId === value) return;
  owner.vectorDisplay = { ...owner.vectorDisplay, fieldId: value };
  owner.applyResultMode(true);
}

/** Applies one validated renderer-owned glyph transition. */
export function setVectorGlyph(owner: VectorControlOwner, value: string): void {
  const glyph = parseVectorGlyph(value);
  if (glyph === undefined) {
    owner.presentation.reflectResults();
    return;
  }
  if (owner.vectorDisplay.glyph === glyph) return;
  owner.vectorDisplay = { ...owner.vectorDisplay, glyph };
  owner.applyResultMode(owner.vectorDisplay.fieldId !== VECTOR_OFF_VALUE);
}

/** Applies one validated occurrence-transform transition. */
export function setVectorTransform(owner: VectorControlOwner, value: string): void {
  const transform = parseVectorTransform(value);
  if (transform === undefined) {
    owner.presentation.reflectResults();
    return;
  }
  if (owner.vectorDisplay.transform === transform) return;
  owner.vectorDisplay = { ...owner.vectorDisplay, transform };
  owner.applyResultMode(owner.vectorDisplay.fieldId !== VECTOR_OFF_VALUE);
}

/** Applies one validated positive-length transition. */
export function setVectorLengthScale(owner: VectorControlOwner, value: string): void {
  const scale = parseVectorLengthScale(value);
  if (scale === undefined) {
    owner.presentation.reflectResults();
    return;
  }
  if (owner.vectorDisplay.lengthScale === scale) return;
  owner.vectorDisplay = { ...owner.vectorDisplay, lengthScale: scale };
  owner.applyResultMode(owner.vectorDisplay.fieldId !== VECTOR_OFF_VALUE);
}
