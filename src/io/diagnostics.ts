/** How severe an issue is; errors make the result untrustworthy. */
export type IssueSeverity = "error" | "warning" | "info";

/** A position within a source document. Lines are 1-based. */
export interface SourcePosition {
  readonly line: number;
  readonly column?: number;
}

/**
 * A typed diagnostic produced during import, export, or model validation.
 * `code` is a stable machine-readable identifier (e.g. `"cell-type-count-mismatch"`)
 * and `message` is a human-readable, actionable description.
 */
export interface Issue {
  readonly code: IssueCode;
  readonly severity: IssueSeverity;
  readonly message: string;
  readonly position?: SourcePosition;
}

/** A stable, machine-readable diagnostic code. */
export type IssueCode = string;

/**
 * Error thrown when an import or model validation fails. Carries the typed
 * issues that caused the failure so callers can react programmatically.
 */
export class IoError extends Error {
  readonly issues: readonly Issue[];
  constructor(message: string, issues?: readonly Issue[]) {
    super(message);
    this.name = "IoError";
    this.issues = issues ?? [];
  }
}

/** Stable failure categories emitted by the VTK writer boundary. */
export type VtkWriteErrorCode =
  | "invalid-model"
  | "incomplete-result-coverage"
  | "duplicate-result-identity"
  | "unsupported-writer-state";

/** Typed error thrown when a FemModel cannot be represented safely as VTK. */
export class VtkWriteError extends IoError {
  readonly code: VtkWriteErrorCode;

  constructor(code: VtkWriteErrorCode, message: string, issues?: readonly Issue[]) {
    super(message, issues ?? [{ code, severity: "error", message }]);
    this.name = "VtkWriteError";
    this.code = code;
  }
}
