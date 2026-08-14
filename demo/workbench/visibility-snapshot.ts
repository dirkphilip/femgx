import type { VisibilityRowTarget } from "./tree-hover";

export type WorkbenchVisibilityRowKind = "assembly" | "instance" | "body";

export interface WorkbenchVisibilityRowSnapshot {
  readonly key: string;
  readonly target: VisibilityRowTarget;
  readonly kind: WorkbenchVisibilityRowKind;
  readonly depth: number;
  readonly label: string;
  readonly badge: "Assembly" | "Part" | "Body";
  readonly ariaLabel: string | undefined;
  readonly testId: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly expanded: boolean;
  readonly expandable: boolean;
  readonly highlighted: boolean;
  readonly hidden: boolean;
  readonly position: number;
  readonly setSize: number;
}

export interface WorkbenchVisibilitySnapshot {
  readonly context: string;
  readonly rows: readonly WorkbenchVisibilityRowSnapshot[];
}
