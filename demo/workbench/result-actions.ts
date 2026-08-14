import {
  parseDeformationScale,
  resultModeForDeformationSelection,
  resultModeForScalarSelection,
} from "./result-controls";
import type { ResultDisplayMode } from "./types";
import type { WorkbenchModel } from "./model";

interface ResultControlOwner {
  readonly model: WorkbenchModel;
  readonly view: { deformationField: { value: string } };
  readonly presentation: { reflectResults: () => void };
  resultMode: ResultDisplayMode;
  deformationScale: number;
  readonly applyResultMode: (render: boolean) => void;
}

/** Applies a validated scalar-field selection to the shared result state. */
export function setResultField(owner: ResultControlOwner, value: string): void {
  const mode = resultModeForScalarSelection(
    value,
    owner.model.results,
    owner.view.deformationField.value,
  );
  if (mode === undefined) {
    owner.presentation.reflectResults();
    return;
  }
  owner.resultMode = mode;
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
