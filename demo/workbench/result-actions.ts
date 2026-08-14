import {
  BASE_RESULT_VALUE,
  DEFORMATION_OFF_VALUE,
  parseDeformationScale,
  resultModeForDeformationSelection,
  resultScalarFieldsForModel,
} from "./result-controls";
import type { ResultDisplayMode } from "./types";
import type { WorkbenchModel } from "./model";

interface ResultControlOwner {
  readonly model: WorkbenchModel;
  readonly presentation: { reflectResults: () => void };
  resultMode: ResultDisplayMode;
  scalarFieldId: string;
  deformationScale: number;
  readonly applyResultMode: (render: boolean) => void;
}

/** Applies a validated scalar-field selection to the shared result state. */
export function setResultField(owner: ResultControlOwner, value: string): void {
  const deformation = owner.model.results?.deformation;
  const deformationValue =
    owner.resultMode === "deformed" && deformation !== undefined
      ? deformation.field.id
      : DEFORMATION_OFF_VALUE;
  if (value === BASE_RESULT_VALUE) {
    owner.scalarFieldId = BASE_RESULT_VALUE;
    owner.resultMode = "base";
    owner.applyResultMode(true);
    return;
  }
  const field = resultScalarFieldsForModel(owner.model).find((candidate) => candidate.id === value);
  if (field === undefined) {
    owner.presentation.reflectResults();
    return;
  }
  owner.scalarFieldId = field.id;
  owner.resultMode = deformationValue === DEFORMATION_OFF_VALUE ? "colored" : "deformed";
  owner.applyResultMode(true);
}

/** Applies a validated deformation-field selection to the shared result state. */
export function setDeformationField(owner: ResultControlOwner, value: string): void {
  const mode = resultModeForDeformationSelection(value, owner.model.results, owner.resultMode);
  if (mode === undefined) {
    owner.presentation.reflectResults();
    return;
  }
  owner.resultMode = mode;
  owner.applyResultMode(true);
}

/** Applies a validated deformation scale, re-rendering only when deformation is active. */
export function setDeformationScale(owner: ResultControlOwner, value: string): void {
  const scale = parseDeformationScale(value);
  if (scale === undefined) {
    owner.presentation.reflectResults();
    return;
  }
  if (owner.deformationScale === scale) return;
  owner.deformationScale = scale;
  owner.applyResultMode(owner.resultMode === "deformed");
}
