import type { AssemblyOccurrenceId, PartOccurrenceId } from "../../../src/entries/root";
import type { InteractionTarget } from "../../../src/entries/interaction";
import type { BodyId } from "../../../src/entries/model";
import type { SceneOccurrences } from "../../../src/entries/root";

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
  /** Zero-based window of at most 1,000 logical rows. */
  readonly page: number;
  /** Number of addressable logical row windows. */
  readonly pageCount: number;
  /** Total logical rows before windowing. */
  readonly rowCount: number;
  /** Rows materialized for this window; bounded independently of hierarchy size. */
  readonly materializedRowCount: number;
}

/**
 * Projects a visibility row onto the visible ordinary targets it emphasizes.
 * AssemblyDefinition rows stay demo-private and expand through their exact occurrence subtree.
 */
export function interactionTargetsForRow(
  runtime: SceneOccurrences,
  row: VisibilityRowTarget,
): readonly InteractionTarget[] {
  if (row.kind !== "assembly") return [row];
  const targets: InteractionTarget[] = [];
  const visit = (occurrenceId: AssemblyOccurrenceId): void => {
    const occurrence = runtime.getAssemblyOccurrence(occurrenceId);
    if (occurrence === undefined || !occurrence.effectiveVisible) return;
    for (let ordinal = 0; ordinal < occurrence.partOccurrenceCount; ordinal += 1) {
      const partOccurrenceId = occurrence.getPartOccurrenceId(ordinal);
      if (partOccurrenceId === undefined) continue;
      if (runtime.isPartOccurrenceVisible(partOccurrenceId))
        targets.push({ kind: "partOccurrence", partOccurrenceId });
    }
    for (let ordinal = 0; ordinal < occurrence.childCount; ordinal += 1) {
      const childId = occurrence.getChildId(ordinal);
      if (childId !== undefined) visit(childId);
    }
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
