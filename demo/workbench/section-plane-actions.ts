import type { FemViewport } from "../../src/entries/root";
import type { WorkbenchModel } from "./models/model";
import {
  clampSectionOffset,
  parseSectionAxis,
  sectionAxisMidpoint,
  sectionPlaneFor,
  type SectionAxis,
} from "./section-controls";

/** Controller surface required to apply the shared section-plane presentation. */
export interface SectionPlaneActionOwner {
  readonly model: WorkbenchModel;
  readonly presentation: { reflectSectionPlane: () => void };
  readonly activeViewport: () => FemViewport;
  readonly render: () => void;
  sectionAxis: SectionAxis;
  sectionOffset: number;
}

/** Applies a user-selected axis and resets its offset to the model midpoint. */
export function setSectionAxis(owner: SectionPlaneActionOwner, value: string): void {
  const axis = parseSectionAxis(value);
  if (axis === undefined) {
    owner.presentation.reflectSectionPlane();
    return;
  }
  owner.sectionAxis = axis;
  owner.sectionOffset = sectionAxisMidpoint(owner.model.bounds, axis);
  applySectionPlane(owner, true);
}

/** Applies a bounded slider offset to the active viewport. */
export function setSectionOffset(owner: SectionPlaneActionOwner, value: string): void {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    owner.presentation.reflectSectionPlane();
    return;
  }
  owner.sectionOffset = clampSectionOffset(numeric, owner.model.bounds, owner.sectionAxis);
  applySectionPlane(owner, true);
}

/** Applies the section plane to the active viewport. */
export function applySectionPlane(owner: SectionPlaneActionOwner, render: boolean): void {
  const plane = sectionPlaneFor(owner.sectionAxis, owner.sectionOffset);
  const viewport = owner.activeViewport();
  if (plane === undefined) viewport.clearSectionPlane();
  else viewport.setSectionPlane(plane);
  owner.presentation.reflectSectionPlane();
  if (render) owner.render();
}
