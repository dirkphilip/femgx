import type { AssemblyOccurrenceId, PartOccurrenceId } from "../../../src/entries/root";
import type { InteractionTarget } from "../../../src/entries/interaction";
import type { BodyId } from "../../../src/entries/model";
import type { SceneRuntime } from "../../../src/entries/runtime";

/** Semantic identity carried by one visibility-tree row. */
export type VisibilityRowTarget =
  | { readonly kind: "assembly"; readonly occurrenceId: AssemblyOccurrenceId }
  | { readonly kind: "partOccurrence"; readonly partOccurrenceId: PartOccurrenceId }
  | { readonly kind: "body"; readonly partOccurrenceId: PartOccurrenceId; readonly bodyId: BodyId };

export type WorkbenchVisibilityRowKind = "assembly" | "partOccurrence" | "body";

export interface WorkbenchVisibilityRowSnapshot {
  readonly key: string;
  readonly target: VisibilityRowTarget;
  readonly kind: WorkbenchVisibilityRowKind;
  readonly depth: number;
  readonly label: string;
  readonly badge: "AssemblyDefinition" | "Part" | "Body";
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

/**
 * Projects a visibility row onto the visible ordinary targets it emphasizes.
 * AssemblyDefinition rows stay demo-private and expand through their exact occurrence subtree.
 */
export function interactionTargetsForRow(
  runtime: SceneRuntime,
  row: VisibilityRowTarget,
): readonly InteractionTarget[] {
  if (row.kind !== "assembly") return [row];
  const targets: InteractionTarget[] = [];
  const visit = (occurrenceId: AssemblyOccurrenceId): void => {
    const occurrence = runtime.getOccurrence(occurrenceId);
    if (occurrence === undefined || !occurrence.effectiveVisible) return;
    for (const partOccurrenceId of occurrence.partOccurrenceIds) {
      if (runtime.isPartOccurrenceVisible(partOccurrenceId))
        targets.push({ kind: "partOccurrence", partOccurrenceId });
    }
    for (const childId of occurrence.childIds) visit(childId);
  };
  visit(row.occurrenceId);
  return targets;
}

/** Compares row identity without depending on object identity from snapshots. */
export function visibilityRowTargetsEqual(
  left: VisibilityRowTarget,
  right: VisibilityRowTarget,
): boolean {
  switch (left.kind) {
    case "assembly":
      return right.kind === "assembly" && left.occurrenceId === right.occurrenceId;
    case "partOccurrence":
      return right.kind === "partOccurrence" && left.partOccurrenceId === right.partOccurrenceId;
    case "body": {
      return (
        right.kind === "body" &&
        left.partOccurrenceId === right.partOccurrenceId &&
        left.bodyId === right.bodyId
      );
    }
  }
}
