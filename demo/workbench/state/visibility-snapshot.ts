import type { AssemblyOccurrenceId, PartOccurrenceId } from "@/entries/root";
import type { BodyId } from "@/entries/model";

/** Semantic identity carried by one visibility-tree row. */
export type VisibilityRowTarget =
  | { readonly kind: "assemblyOccurrence"; readonly assemblyOccurrenceId: AssemblyOccurrenceId }
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
  readonly selected: boolean;
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

/** Compares row identity without depending on object identity from snapshots. */
export function visibilityRowTargetsEqual(
  left: VisibilityRowTarget,
  right: VisibilityRowTarget,
): boolean {
  switch (left.kind) {
    case "assemblyOccurrence":
      return (
        right.kind === "assemblyOccurrence" &&
        left.assemblyOccurrenceId === right.assemblyOccurrenceId
      );
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
