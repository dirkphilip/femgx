import type {
  AssemblyOccurrenceId,
  BodyId,
  ElementBlockId,
  InstanceId,
  InteractionTarget,
} from "../../../src/index";

/** Semantic identity carried by one visibility-tree row. */
export type VisibilityRowTarget =
  | { readonly kind: "assembly"; readonly occurrenceId: AssemblyOccurrenceId }
  | { readonly kind: "instance"; readonly instanceId: InstanceId }
  | { readonly kind: "body"; readonly instanceId: InstanceId; readonly bodyId: BodyId }
  | { readonly kind: "block"; readonly instanceId: InstanceId; readonly blockId: ElementBlockId };

export type WorkbenchVisibilityRowKind = "assembly" | "instance" | "body" | "block";

export interface WorkbenchVisibilityRowSnapshot {
  readonly key: string;
  readonly target: VisibilityRowTarget;
  readonly kind: WorkbenchVisibilityRowKind;
  readonly depth: number;
  readonly label: string;
  readonly badge: "Assembly" | "Part" | "Body" | "Block";
  readonly ariaLabel: string | undefined;
  readonly testId: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly expanded: boolean;
  readonly expandable: boolean;
  readonly highlighted: boolean;
  /** Number of authored FE elements available in this body detail view. */
  readonly elementCount?: number;
  readonly hidden: boolean;
  readonly position: number;
  readonly setSize: number;
}

export interface WorkbenchVisibilitySnapshot {
  readonly context: string;
  readonly rows: readonly WorkbenchVisibilityRowSnapshot[];
}

/** Returns the scene target represented by a row, if the row has scene identity. */
export function interactionTargetForRow(row: VisibilityRowTarget): InteractionTarget | undefined {
  return row.kind === "assembly" ? undefined : row;
}

/** Compares row identity without depending on object identity from snapshots. */
export function visibilityRowTargetsEqual(
  left: VisibilityRowTarget,
  right: VisibilityRowTarget,
): boolean {
  switch (left.kind) {
    case "assembly":
      return right.kind === "assembly" && left.occurrenceId === right.occurrenceId;
    case "instance":
      return right.kind === "instance" && left.instanceId === right.instanceId;
    case "body": {
      return (
        right.kind === "body" &&
        left.instanceId === right.instanceId &&
        left.bodyId === right.bodyId
      );
    }
    case "block":
      return (
        right.kind === "block" &&
        left.instanceId === right.instanceId &&
        left.blockId === right.blockId
      );
  }
}
